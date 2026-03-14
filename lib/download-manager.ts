import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type {
  DownloadEvent,
  DownloadJob,
  DownloadRequest,
  DownloadSnapshot,
} from "@/lib/types";
import {
  ensureDownloadDirectory,
  ensureOutputDirectory,
  assertSystemReady,
  resolveOutputDirectory,
} from "@/lib/system";
import { buildYtDlpArguments, getMetadata } from "@/lib/yt-dlp";
import { loadJobs, saveJobs } from "@/lib/store";

type Listener = (event: DownloadEvent) => void;

function createProgress() {
  return {
    percent: 0,
    percentLabel: "0.0%",
    speed: null,
    eta: null,
    downloaded: null,
    total: null,
  };
}

function cleanField(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizeOutputName(value: string | undefined, fallback: string) {
  const candidate = value?.trim() || fallback;
  const sanitized = candidate.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ");
  return sanitized.replace(/\s+/g, " ").trim() || fallback;
}

function resolveCompletedFilePath(job: DownloadJob) {
  if (job.filePath && existsSync(job.filePath)) {
    return job.filePath;
  }

  try {
    const outputDirectory = resolveOutputDirectory(job.outputDirectory);
    const prefix = `${job.outputName}.`;
    const matches = readdirSync(outputDirectory)
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => join(outputDirectory, entry))
      .filter((candidate) => existsSync(candidate))
      .sort((left, right) => {
        return statSync(right).mtimeMs - statSync(left).mtimeMs;
      });

    const preferred = matches.find((candidate) =>
      candidate.endsWith(`.${job.outputContainer}`),
    );
    return preferred ?? matches[0] ?? null;
  } catch {
    return null;
  }
}

/** Throttle progress SSE emit (ms). Keeps UI responsive without blocking pipe read. */
const PROGRESS_EMIT_INTERVAL_MS = 300;

const DEBUG = process.env.CAPTURETHIS_DEBUG === "1" || process.env.CAPTURETHIS_PROFILE === "1";

function debugLog(jobId: string, phase: string, detail?: Record<string, unknown>) {
  if (!DEBUG) return;
  const ts = Date.now();
  const msg = detail ? `${phase} ${JSON.stringify(detail)}` : phase;
  console.log(`[CaptureThis ${jobId.slice(0, 8)}] ${new Date(ts).toISOString()} ${msg}`);
}

class DownloadManager {
  private jobs: Map<string, DownloadJob>;
  private queue: string[] = [];
  private listeners = new Set<Listener>();
  private activeJobId: string | null = null;
  private processing = false;
  private activeProcesses = new Map<string, ChildProcess>();
  private progressEmitTimers = new Map<string, NodeJS.Timeout>();
  private lastEmittedProgress = new Map<string, number>();

  constructor() {
    ensureDownloadDirectory();
    this.jobs = loadJobs();

    // Re-queue any jobs that were in-progress when the server last shut down
    for (const job of this.jobs.values()) {
      if (job.status === "queued") {
        this.queue.push(job.id);
      }
    }

    if (this.queue.length > 0) {
      void this.processQueue();
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener({
      type: "snapshot",
      snapshot: this.snapshot(),
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): DownloadSnapshot {
    return {
      jobs: [...this.jobs.values()].sort((left, right) => {
        return (
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
      }),
      activeJobId: this.activeJobId,
    };
  }

  private emit(type: DownloadEvent["type"]) {
    const event: DownloadEvent = {
      type,
      snapshot: this.snapshot(),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private persist() {
    saveJobs(this.jobs);
  }

  async enqueue(request: DownloadRequest) {
    assertSystemReady();
    ensureDownloadDirectory();

    // Use pre-fetched metadata if available, otherwise extract fresh
    let title = request.title?.trim() || "Untitled";
    let thumbnail = request.thumbnail ?? null;

    if (request.metadata) {
      title = request.title?.trim() || request.metadata.title;
      thumbnail = request.thumbnail ?? request.metadata.thumbnail ?? null;
    } else {
      const metadata = await getMetadata(request.url);
      title = request.title?.trim() || metadata.title;
      thumbnail = request.thumbnail ?? metadata.thumbnail ?? null;
    }

    const outputDirectory = ensureOutputDirectory(request.outputDirectory);
    const outputName = normalizeOutputName(request.outputName, title);

    const now = new Date().toISOString();
    const job: DownloadJob = {
      id: randomUUID(),
      url: request.url,
      title,
      thumbnail,
      status: "queued",
      quality: request.quality,
      mode: request.mode,
      audioFormat: request.audioFormat,
      outputContainer: request.outputContainer,
      videoProfile: request.videoProfile,
      threads: request.threads,
      outputDirectory,
      outputName,
      progress: createProgress(),
      filePath: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.persist();
    this.emit("job-added");
    void this.processQueue();

    return job;
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    // If the job is queued but not yet started, just remove from queue
    if (job.status === "queued") {
      this.queue = this.queue.filter((id) => id !== jobId);
      this.updateJob(jobId, { status: "cancelled" });
      this.emit("job-cancelled");
      return;
    }

    // If actively downloading, kill the child process
    if (job.status === "downloading") {
      this.clearProgressThrottles(jobId);
      const child = this.activeProcesses.get(jobId);

      if (child && !child.killed) {
        child.kill("SIGTERM");

        // Fallback: force kill after 5 seconds if still alive
        const killTimeout = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);

        child.once("close", () => {
          clearTimeout(killTimeout);
        });
      }

      this.updateJob(jobId, { status: "cancelled" });
      this.emit("job-cancelled");
    }
  }

  private updateJob(jobId: string, partial: Partial<DownloadJob>) {
    const current = this.jobs.get(jobId);

    if (!current) {
      return;
    }

    this.jobs.set(jobId, {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    });

    this.persist();
    this.emit("job-updated");
  }

  /**
   * Updates only progress fields. No persist during download — sync disk I/O
   * blocks the event loop, which blocks reading from yt-dlp's stdout pipe,
   * which blocks yt-dlp. Persist only on status change (completion/fail/cancel).
   */
  private updateJobProgress(jobId: string, progress: Partial<DownloadJob["progress"]>) {
    const current = this.jobs.get(jobId);
    if (!current) return;

    this.jobs.set(jobId, {
      ...current,
      progress: { ...current.progress, ...progress },
      updatedAt: new Date().toISOString(),
    });

    const now = Date.now();

    // Throttle emit: push to SSE at most every PROGRESS_EMIT_INTERVAL_MS
    const lastEmit = this.lastEmittedProgress.get(jobId) ?? 0;
    if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS) {
      this.lastEmittedProgress.set(jobId, now);
      this.emit("job-updated");
    } else {
      const existingEmit = this.progressEmitTimers.get(jobId);
      if (!existingEmit) {
        this.progressEmitTimers.set(
          jobId,
          setTimeout(() => {
            this.progressEmitTimers.delete(jobId);
            this.lastEmittedProgress.set(jobId, Date.now());
            this.emit("job-updated");
          }, PROGRESS_EMIT_INTERVAL_MS - (now - lastEmit)),
        );
      }
    }
  }

  private clearProgressThrottles(jobId: string) {
    const emitTimer = this.progressEmitTimers.get(jobId);
    if (emitTimer) {
      clearTimeout(emitTimer);
      this.progressEmitTimers.delete(jobId);
    }
    this.lastEmittedProgress.delete(jobId);
  }

  private async processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) {
          continue;
        }

        const job = this.jobs.get(jobId);
        if (!job || job.status !== "queued") {
          continue;
        }

        this.activeJobId = jobId;
        this.emit("job-updated");
        await this.run(jobId);
      }
    } finally {
      this.activeJobId = null;
      this.processing = false;
      this.emit("job-updated");
    }
  }

  private async run(jobId: string) {
    const current = this.jobs.get(jobId);
    if (!current) {
      return;
    }

    const runStart = Date.now();
    debugLog(jobId, "run_start", { url: current.url.slice(0, 50) });

    this.updateJob(jobId, {
      status: "downloading",
      error: null,
      progress: createProgress(),
    });

    const args = buildYtDlpArguments(
      {
        url: current.url,
        title: current.title,
        thumbnail: current.thumbnail,
        mode: current.mode,
        quality: current.quality,
        audioFormat: current.audioFormat,
        outputContainer: current.outputContainer,
        videoProfile: current.videoProfile,
        threads: current.threads,
        outputDirectory: resolveOutputDirectory(current.outputDirectory),
        outputName: current.outputName,
      },
    );

    await new Promise<void>((resolve) => {
      const child = spawn("yt-dlp", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Track the process for cancellation
      this.activeProcesses.set(jobId, child);

      let remainder = "";
      let firstProgressAt: number | null = null;

      const flushLine = (line: string) => {
        if (!line) {
          return;
        }

        if (line.startsWith("PROGRESS::")) {
          if (firstProgressAt === null) {
            firstProgressAt = Date.now();
            debugLog(jobId, "first_byte", {
              ms_since_start: firstProgressAt - runStart,
            });
          }
          const [, downloaded, total, estimated, percent, speed, eta] = line.split("::");
          const totalValue = cleanField(total) ?? cleanField(estimated);
          const percentLabel = cleanField(percent) ?? "0.0%";
          const percentValue =
            Number.parseFloat(percentLabel.replace("%", "")) || 0;

          this.updateJobProgress(jobId, {
            percent: percentValue,
            percentLabel,
            speed: cleanField(speed),
            eta: cleanField(eta),
            downloaded: cleanField(downloaded),
            total: totalValue,
          });
          return;
        }

        if (line.includes("Destination:")) {
          const filePath = line.split("Destination:")[1]?.trim();
          if (filePath) {
            debugLog(jobId, "destination", {
              ms_since_start: Date.now() - runStart,
            });
            this.updateJob(jobId, { filePath });
          }
          return;
        }

        if (line.includes("Merging formats into")) {
          debugLog(jobId, "merge_start", {
            ms_since_start: Date.now() - runStart,
          });
          const filePath = line
            .split("Merging formats into")[1]
            ?.trim()
            .replace(/^"/, "")
            .replace(/"$/, "");
          if (filePath) {
            this.updateJob(jobId, { filePath });
          }
        }
      };

      const consume = (chunk: string) => {
        const combined = remainder + chunk;
        const lines = combined.split(/\r?\n/);
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          flushLine(line.trim());
        }
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", consume);
      child.stderr.on("data", consume);

      child.on("error", (error) => {
        this.activeProcesses.delete(jobId);
        this.clearProgressThrottles(jobId);

        // Don't overwrite a cancellation
        const currentJob = this.jobs.get(jobId);
        if (currentJob?.status === "cancelled") {
          resolve();
          return;
        }

        this.updateJob(jobId, {
          status: "failed",
          error: error.message,
        });
        resolve();
      });

      child.on("close", (code) => {
        this.activeProcesses.delete(jobId);
        this.clearProgressThrottles(jobId);

        if (remainder) {
          flushLine(remainder.trim());
        }

        // Don't overwrite a cancellation
        const currentJob = this.jobs.get(jobId);
        if (currentJob?.status === "cancelled") {
          resolve();
          return;
        }

        if (code === 0) {
          const elapsed = Date.now() - runStart;
          debugLog(jobId, "completed", {
            ms_total: elapsed,
            status: "success",
          });
          const job = this.jobs.get(jobId);
          const completedFilePath = job ? resolveCompletedFilePath(job) : null;

          if (!completedFilePath) {
            this.updateJob(jobId, {
              status: "failed",
              error: "yt-dlp finished without producing a saved output file.",
            });
            resolve();
            return;
          }

          this.updateJob(jobId, {
            status: "completed",
            filePath: completedFilePath,
            progress: {
              ...(job?.progress ?? createProgress()),
              percent: 100,
              percentLabel: "100%",
              eta: "0s",
            },
          });
        } else {
          debugLog(jobId, "completed", {
            ms_total: Date.now() - runStart,
            status: "failed",
            code,
          });
          this.updateJob(jobId, {
            status: "failed",
            error: `yt-dlp exited with code ${code ?? "unknown"}.`,
          });
        }

        resolve();
      });
    });
  }

  heartbeat() {
    this.emit("heartbeat");
  }
}

declare global {
  var __captureThisManager__: DownloadManager | undefined;
}

export const downloadManager =
  globalThis.__captureThisManager__ ?? new DownloadManager();

if (!globalThis.__captureThisManager__) {
  globalThis.__captureThisManager__ = downloadManager;
}

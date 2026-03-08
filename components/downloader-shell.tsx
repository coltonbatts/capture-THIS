"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  CopyPlus,
  FileVideo2,
  FolderOpen,
  Layers3,
  LoaderCircle,
  RadioTower,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import { useDeferredValue, useEffect, useState, useTransition } from "react";

import { DEFAULT_DOWNLOAD_QUALITY } from "@/lib/download-preset";
import type {
  DownloadJob,
  DownloadSnapshot,
  MetadataResponse,
  SystemStatus,
} from "@/lib/types";
import { isLikelyUrl } from "@/lib/url";

import styles from "./downloader-shell.module.css";

function humanStatus(status: DownloadJob["status"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "completed":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function formatBytes(value: number | null) {
  if (!value || !Number.isFinite(value)) return "Variable size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function toneClass(status: DownloadJob["status"]) {
  switch (status) {
    case "downloading":
      return "toneLive";
    case "failed":
    case "cancelled":
      return "toneDanger";
    default:
      return "toneNeutral";
  }
}

export function DownloaderShell() {
  const [url, setUrl] = useState("");
  const deferredUrl = useDeferredValue(url);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [outputName, setOutputName] = useState("");
  const [hasEditedOutputDirectory, setHasEditedOutputDirectory] = useState(false);
  const [hasEditedOutputName, setHasEditedOutputName] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [snapshot, setSnapshot] = useState<DownloadSnapshot>({
    jobs: [],
    activeJobId: null,
  });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isMetadataPending, startMetadataTransition] = useTransition();
  const [, startSnapshotTransition] = useTransition();

  useEffect(() => {
    let mounted = true;
    fetch("/api/system", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to inspect system binaries.");
        return (await response.json()) as SystemStatus;
      })
      .then((result) => {
        if (!mounted) return;
        setSystemStatus(result);
        setOutputDirectory((current) => {
          if (hasEditedOutputDirectory && current.trim()) return current;
          return result.downloadDirectory;
        });
      })
      .catch((error: Error) => {
        if (mounted) setQueueError(error.message);
      });
    return () => {
      mounted = false;
    };
  }, [hasEditedOutputDirectory]);

  useEffect(() => {
    const source = new EventSource("/api/download");
    const updateSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { snapshot: DownloadSnapshot };
      startSnapshotTransition(() => {
        setSnapshot(payload.snapshot);
      });
    };
    source.addEventListener("snapshot", updateSnapshot);
    source.addEventListener("job-added", updateSnapshot);
    source.addEventListener("job-updated", updateSnapshot);
    source.addEventListener("job-cancelled", updateSnapshot);
    source.onerror = () => {
      setQueueError("Live queue channel disconnected. Refresh to reattach.");
      source.close();
    };
    return () => {
      source.close();
    };
  }, [startSnapshotTransition]);

  useEffect(() => {
    const candidate = deferredUrl.trim();
    if (!isLikelyUrl(candidate)) {
      startMetadataTransition(() => {
        setMetadata(null);
        setMetadataError(null);
      });
      return;
    }

    const timeout = window.setTimeout(() => {
      fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidate }),
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Metadata lookup failed.");
          return payload as MetadataResponse;
        })
        .then((payload) => {
          startMetadataTransition(() => {
            setMetadata(payload);
            setMetadataError(null);
            setOutputName((current) => {
              if (hasEditedOutputName && current.trim()) return current;
              return payload.title;
            });
          });
        })
        .catch((error: Error) => {
          startMetadataTransition(() => {
            setMetadata(null);
            setMetadataError(error.message);
          });
        });
    }, 420);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [deferredUrl, hasEditedOutputName, startMetadataTransition]);

  async function handlePaste() {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (clipboard.trim()) {
        setUrl(clipboard.trim());
      }
    } catch {
      setQueueError("Clipboard access was blocked by the browser.");
    }
  }

  async function handleQueue() {
    const candidate = url.trim();
    if (!candidate) {
      setQueueError("Paste a media URL before downloading.");
      return;
    }

    if (!isLikelyUrl(candidate)) {
      setQueueError("Provide a valid URL before queueing.");
      return;
    }

    if (!outputDirectory.trim()) {
      setQueueError("Choose a destination folder before downloading.");
      return;
    }

    setQueueError(null);
    setIsQueueing(true);

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: candidate,
          title: metadata?.title,
          thumbnail: metadata?.thumbnail,
          outputDirectory,
          outputName,
          metadata: metadata ?? undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setQueueError(payload.error ?? "Unable to add download.");
        return;
      }

      setSnapshot(payload.snapshot as DownloadSnapshot);
      setSelectedJobId((payload.job as DownloadJob).id);
      setUrl("");
      setMetadata(null);
      setOutputName("");
      setHasEditedOutputName(false);
    } finally {
      setIsQueueing(false);
    }
  }

  async function handleCancel(jobId: string) {
    setIsCancelling(true);
    try {
      await fetch("/api/download", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
    } catch {
      setQueueError("Failed to cancel download.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleReveal(filePath: string) {
    try {
      const response = await fetch("/api/download/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      if (!response.ok) {
        const payload = await response.json();
        setQueueError(payload.error ?? "Could not reveal file.");
      }
    } catch {
      setQueueError("Failed to open Finder.");
    }
  }

  const activeJob =
    snapshot.jobs.find((job) => job.id === snapshot.activeJobId) ??
    snapshot.jobs.find((job) => job.status === "downloading") ??
    null;

  const historyJobs = [...snapshot.jobs].reverse().filter((job) => job.id !== activeJob?.id);
  const selectedJob =
    snapshot.jobs.find((job) => job.id === selectedJobId) ??
    activeJob ??
    historyJobs[0] ??
    null;

  const isYtdlpReady =
    systemStatus?.checks.find((check) => check.name === "yt-dlp")?.available ?? false;

  const sourceEstimate = metadata?.formats.reduce<number | null>((largest, format) => {
    if (!format.filesize) return largest;
    if (!largest) return format.filesize;
    return Math.max(largest, format.filesize);
  }, null);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <motion.section
          className={styles.stage}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.topBar}>
            <p className={styles.brandMark}>Capture This</p>
            <div
              className={`${styles.engineBadge} ${isYtdlpReady ? "" : styles.engineBadgeOffline}`}
              title={isYtdlpReady ? "Engine ready" : "System initializing"}
            >
              <span className={`${styles.statusDot} ${isYtdlpReady ? "" : styles.offline}`} />
              <span>Engine {isYtdlpReady ? "Ready" : "Offline"}</span>
            </div>
          </div>

          <div className={styles.layout}>
            <section className={styles.commandDeck}>
              <div className={styles.hero}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="CaptureTHIS" className={styles.heroLogo} />
                <h1 className={styles.heroTitle}>Capture This</h1>
                <p className={styles.eyebrow}>
                  Paste a link, set the destination folder, name the file, and queue the download.
                </p>
              </div>

              <form
                className={styles.inputPanel}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleQueue();
                }}
              >
                <label className={styles.inputLabel} htmlFor="media-url">
                  Source Link
                </label>
                <div className={styles.inputRow}>
                  <input
                    id="media-url"
                    className={styles.input}
                    type="url"
                    placeholder="Paste YouTube or media URL"
                    autoComplete="off"
                    spellCheck={false}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>
                <div className={styles.inputMeta}>
                  <span>
                    {isMetadataPending
                      ? "Scanning source profile..."
                      : url.trim() && metadata
                        ? "Source ready. Confirm folder and file name, then download."
                        : "The download button stays available. Invalid URLs return an error when submitted."}
                  </span>
                  {isMetadataPending ? (
                    <span className={styles.inlineStatus}>
                      <LoaderCircle size={14} className={styles.spinner} />
                      Inspecting
                    </span>
                  ) : null}
                </div>

                <div className={styles.organizerGrid}>
                  <label className={styles.field}>
                    <span>Destination Folder</span>
                    <input
                      className={styles.textField}
                      type="text"
                      placeholder={systemStatus?.downloadDirectory ?? "~/Downloads/Capture This"}
                      value={outputDirectory}
                      onChange={(event) => {
                        setHasEditedOutputDirectory(true);
                        setOutputDirectory(event.target.value);
                      }}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>File Name</span>
                    <input
                      className={styles.textField}
                      type="text"
                      placeholder={metadata?.title ?? "Enter file name"}
                      value={outputName}
                      onChange={(event) => {
                        setHasEditedOutputName(true);
                        setOutputName(event.target.value);
                      }}
                    />
                  </label>
                </div>

                <div className={styles.actionRow}>
                  <button type="button" className={styles.ghostButton} onClick={handlePaste}>
                    <CopyPlus size={16} />
                    Paste Link
                  </button>
                  <button
                    type="submit"
                    className={`${styles.ghostButton} ${styles.primaryAction} ${styles.downloadButton}`}
                    disabled={!url.trim() || isQueueing}
                  >
                    <ArrowDownToLine size={16} />
                    Download
                  </button>
                </div>
              </form>

              <AnimatePresence>
                {metadata && url.trim() ? (
                  <motion.div
                    className={styles.metadataCard}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className={styles.thumbnailFrame}>
                      {metadata.thumbnail ? (
                        <Image
                          src={metadata.thumbnail}
                          alt="Thumbnail"
                          fill
                          unoptimized
                          className={styles.thumbnail}
                        />
                      ) : (
                        <div className={styles.thumbnailFallback}>
                          <FileVideo2 size={28} />
                        </div>
                      )}
                    </div>
                    <div className={styles.metadataContent}>
                      <div className={styles.metadataHeader}>
                        <p className={styles.sectionLabel}>Source</p>
                        <span className={styles.metadataTag}>
                          {metadata.extractor ?? "Media Source"}
                        </span>
                      </div>
                      <h2 className={styles.metadataTitle}>{metadata.title}</h2>
                      <p className={styles.metadataSub}>{metadata.uploader ?? "Unknown uploader"}</p>
                      <div className={styles.metadataGrid}>
                        <div className={styles.statBlock}>
                          <span>Duration</span>
                          <strong>{metadata.durationLabel}</strong>
                        </div>
                        <div className={styles.statBlock}>
                          <span>Max Render</span>
                          <strong>{DEFAULT_DOWNLOAD_QUALITY}P</strong>
                        </div>
                        <div className={styles.statBlock}>
                          <span>Est. Payload</span>
                          <strong>{formatBytes(sourceEstimate ?? null)}</strong>
                        </div>
                      </div>
                      <p className={styles.metadataNote}>
                        Current output: {outputName.trim() || metadata.title}. Files save to{" "}
                        {outputDirectory.trim() || systemStatus?.downloadDirectory || "your chosen folder"}.
                      </p>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {queueError || metadataError ? (
                  <motion.div
                    className={styles.alert}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <AlertCircle size={18} />
                    <span>{queueError ?? metadataError}</span>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {historyJobs.length > 0 ? (
                <section className={styles.historySection}>
                  <div className={styles.historyHeader}>
                    <Layers3 size={16} />
                    <span>Recent Extractions</span>
                  </div>
                  <div className={styles.historyList}>
                    {historyJobs.slice(0, 6).map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        className={`${styles.historyCard} ${selectedJobId === job.id ? styles.historyCardActive : ""}`}
                        onClick={() => setSelectedJobId(job.id)}
                      >
                        <div className={styles.historyMain}>
                          <strong>{job.outputName}</strong>
                          <span>{formatTimestamp(job.createdAt)}</span>
                        </div>
                        <div className={styles.historyMeta}>
                          <span className={`${styles.historyStatus} ${styles[toneClass(job.status)]}`}>
                            {job.status === "cancelled" ? (
                              <>
                                <Ban size={14} />
                                Cancelled
                              </>
                            ) : job.status === "completed" ? (
                              <>
                                <CheckCircle2 size={14} />
                                Complete
                              </>
                            ) : (
                              humanStatus(job.status)
                            )}
                          </span>
                          <small>{job.outputDirectory}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </section>

            <aside className={styles.sideRail}>
              <section className={styles.sidePanel}>
                <div className={styles.panelHeader}>
                  <p className={styles.sectionLabel}>System</p>
                  <span className={styles.panelMeta}>
                    {systemStatus?.ok ? "Online" : "Booting"}
                  </span>
                </div>
                <div className={styles.systemList}>
                  <div className={styles.systemRow}>
                    <span>Default Folder</span>
                    <strong>{systemStatus?.downloadDirectory ?? "Resolving output path..."}</strong>
                  </div>
                  <div className={styles.systemRow}>
                    <span>Next File</span>
                    <strong>{outputName.trim() || metadata?.title || "Enter a file name"}</strong>
                  </div>
                  <div className={styles.systemRow}>
                    <span>Next Destination</span>
                    <strong>{outputDirectory.trim() || systemStatus?.downloadDirectory || "Enter a folder path"}</strong>
                  </div>
                  {(systemStatus?.checks ?? []).map((check) => (
                    <div key={check.name} className={styles.systemRow}>
                      <span>{check.name}</span>
                      <strong className={check.available ? styles.toneNeutral : styles.toneDanger}>
                        {check.available ? "Available" : "Unavailable"}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.sidePanel}>
                <div className={styles.panelHeader}>
                  <p className={styles.sectionLabel}>Live Output</p>
                  <span className={`${styles.liveBadge} ${selectedJob ? styles[toneClass(selectedJob.status)] : styles.toneNeutral}`}>
                    <RadioTower size={14} />
                    {selectedJob ? humanStatus(selectedJob.status) : "Standby"}
                  </span>
                </div>

                {selectedJob ? (
                  <div className={styles.liveStack}>
                    <div className={styles.liveHeading}>
                      <strong>{selectedJob.outputName}</strong>
                      <span>{selectedJob.quality}P / {formatTimestamp(selectedJob.updatedAt)}</span>
                    </div>

                    <div className={styles.progressWrap}>
                      <div className={styles.progressBar}>
                        <motion.div
                          className={`${styles.progressFill} ${styles[toneClass(selectedJob.status)]}`}
                          animate={{ width: `${Math.max(selectedJob.progress.percent, 2)}%` }}
                          transition={{ duration: 0.2 }}
                        />
                      </div>
                      <div className={styles.progressMeta}>
                        <span>{selectedJob.progress.percentLabel}</span>
                        <span>{selectedJob.progress.speed ?? "Awaiting transfer metrics"}</span>
                      </div>
                    </div>

                    <div className={styles.liveDetails}>
                      <div className={styles.systemRow}>
                        <span>Destination</span>
                        <strong>{selectedJob.outputDirectory}</strong>
                      </div>
                      <div className={styles.systemRow}>
                        <span>Payload</span>
                        <strong>
                          {selectedJob.progress.downloaded ?? "0"}
                          {selectedJob.progress.total ? ` / ${selectedJob.progress.total}` : ""}
                        </strong>
                      </div>
                      <div className={styles.systemRow}>
                        <span>Status</span>
                        <strong>{selectedJob.error ?? humanStatus(selectedJob.status)}</strong>
                      </div>
                    </div>

                    <div className={styles.liveActions}>
                      {selectedJob.filePath ? (
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => handleReveal(selectedJob.filePath!)}
                        >
                          <FolderOpen size={16} />
                          Reveal File
                        </button>
                      ) : null}
                      {selectedJob.status === "downloading" || selectedJob.status === "queued" ? (
                        <button
                          type="button"
                          className={`${styles.ghostButton} ${styles.dangerButton}`}
                          onClick={() => handleCancel(selectedJob.id)}
                          disabled={isCancelling}
                        >
                          <XCircle size={16} />
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    No active extractions. Paste a URL, set the folder and file name, and download.
                  </div>
                )}
              </section>
            </aside>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

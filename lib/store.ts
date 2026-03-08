import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

import type { DownloadJob } from "@/lib/types";
import { downloadDirectory } from "@/lib/system";

const HISTORY_FILE = join(downloadDirectory, ".capturethis-history.json");

export function loadJobs(): Map<string, DownloadJob> {
    try {
        const raw = readFileSync(HISTORY_FILE, "utf8");
        const parsed = JSON.parse(raw) as DownloadJob[];

        if (!Array.isArray(parsed)) {
            return new Map();
        }

        const jobs = new Map<string, DownloadJob>();

        for (const job of parsed) {
            // Reset any in-progress jobs (server crashed mid-download)
            if (job.status === "downloading" || job.status === "queued") {
                job.status = "queued";
                job.progress = {
                    percent: 0,
                    percentLabel: "0.0%",
                    speed: null,
                    eta: null,
                    downloaded: null,
                    total: null,
                };
            }

            jobs.set(job.id, job);
        }

        return jobs;
    } catch {
        return new Map();
    }
}

export function saveJobs(jobs: Map<string, DownloadJob>): void {
    try {
        mkdirSync(dirname(HISTORY_FILE), { recursive: true });

        const data = JSON.stringify([...jobs.values()], null, 2);
        const tempPath = `${HISTORY_FILE}.tmp`;

        writeFileSync(tempPath, data, "utf8");
        renameSync(tempPath, HISTORY_FILE);
    } catch {
        // Silently ignore write errors — best-effort persistence
    }
}

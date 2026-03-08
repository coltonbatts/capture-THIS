import { execFileSync, execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import type { SystemCheck, SystemStatus } from "@/lib/types";

export const downloadDirectory = join(
  homedir(),
  "Downloads",
  "Infinite-Downloader",
);

function resolveBinary(command: "yt-dlp" | "ffmpeg"): SystemCheck {
  try {
    const output = execFileSync("which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return {
      name: command,
      available: Boolean(output),
      path: output || null,
      message: output
        ? `${command} is ready`
        : `${command} is not available in PATH`,
    };
  } catch {
    return {
      name: command,
      available: false,
      path: null,
      message: `${command} is not available in PATH`,
    };
  }
}

export function ensureDownloadDirectory() {
  mkdirSync(downloadDirectory, { recursive: true });
  return downloadDirectory;
}

export function getSystemStatus(): SystemStatus {
  ensureDownloadDirectory();

  const checks = [
    resolveBinary("yt-dlp"),
    resolveBinary("ffmpeg"),
  ] satisfies SystemCheck[];

  return {
    ok: checks.every((check) => check.available),
    downloadDirectory,
    checks,
  };
}

export function assertSystemReady() {
  const status = getSystemStatus();

  if (!status.ok) {
    const missing = status.checks
      .filter((check) => !check.available)
      .map((check) => check.name)
      .join(", ");

    throw new Error(
      `CaptureTHIS requires ${missing} to be installed and available in PATH.`,
    );
  }

  return status;
}

export async function updateYtDlp(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["-U"], { encoding: "utf8" });
    return stdout.trim();
  } catch (error: any) {
    if (error.stderr) {
      throw new Error(error.stderr.toString().trim().split('\n')[0]);
    }
    throw new Error("Failed to run yt-dlp update.");
  }
}


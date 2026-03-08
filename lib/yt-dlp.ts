import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  DownloadMode,
  DownloadRequest,
  MediaFormatSummary,
  MetadataResponse,
} from "@/lib/types";
import { assertSystemReady } from "@/lib/system";
import { normalizeUrl } from "@/lib/url";

const execFileAsync = promisify(execFile);

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  format_note?: string;
  filesize?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
}

interface YtDlpMetadata {
  title?: string;
  thumbnail?: string;
  uploader?: string;
  duration?: number;
  extractor?: string;
  description?: string;
  formats?: YtDlpFormat[];
}

function qualityLabel(height: number) {
  if (height >= 2160) {
    return "2160";
  }

  if (height >= 1440) {
    return "1440";
  }

  return String(height);
}

function summarizeFormat(format: YtDlpFormat): MediaFormatSummary | null {
  const id = format.format_id;

  if (!id) {
    return null;
  }

  const hasVideo = Boolean(format.vcodec && format.vcodec !== "none");
  const hasAudio = Boolean(format.acodec && format.acodec !== "none");

  let type: DownloadMode = "video-audio";
  if (hasVideo && !hasAudio) {
    type = "video-only";
  } else if (!hasVideo && hasAudio) {
    type = "audio";
  }

  const resolution = format.height ? qualityLabel(format.height) : "Audio";

  return {
    id,
    label: [
      resolution === "Audio" ? "Audio" : `${resolution}p`,
      type === "video-audio"
        ? "video + audio"
        : type === "video-only"
          ? "video only"
          : "audio only",
      format.ext ?? null,
      format.format_note ?? null,
    ]
      .filter(Boolean)
      .join(" / "),
    ext: format.ext ?? "unknown",
    resolution,
    type,
    fps: format.fps ?? null,
    filesize: format.filesize ?? null,
    formatNote: format.format_note ?? null,
  };
}

function formatDuration(totalSeconds: number | null | undefined) {
  if (!totalSeconds) {
    return "Unknown duration";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export async function getMetadata(url: string): Promise<MetadataResponse> {
  assertSystemReady();

  const normalizedUrl = normalizeUrl(url);
  let stdout;
  try {
    const process = await execFileAsync(
      "yt-dlp",
      ["--dump-single-json", "--no-playlist", normalizedUrl],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 12,
      },
    );
    stdout = process.stdout;
  } catch (error: any) {
    if (error.stderr) {
      const message = error.stderr.toString().trim().split('\n')[0];
      throw new Error(`Extraction failed: ${message}`);
    }
    throw new Error("Failed to launch yt-dlp extraction process.");
  }

  const payload = JSON.parse(stdout) as YtDlpMetadata;
  const formats = (payload.formats ?? [])
    .map(summarizeFormat)
    .filter((value): value is MediaFormatSummary => Boolean(value));

  const qualitySet = new Set<string>();
  for (const format of formats) {
    if (format.resolution !== "Audio") {
      qualitySet.add(format.resolution);
    }
  }

  const qualities = Array.from(qualitySet).sort((left, right) => {
    return Number.parseInt(right, 10) - Number.parseInt(left, 10);
  });

  return {
    url: normalizedUrl,
    title: payload.title ?? "Untitled media",
    thumbnail: payload.thumbnail ?? null,
    uploader: payload.uploader ?? null,
    durationSeconds: payload.duration ?? null,
    durationLabel: formatDuration(payload.duration),
    extractor: payload.extractor ?? null,
    description: payload.description ?? null,
    qualities,
    formats,
  };
}

function parseHeight(quality: string) {
  const parsed = Number.parseInt(quality, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildYtDlpArguments(
  request: DownloadRequest,
  outputDirectory: string,
) {
  const args = [
    "--newline",
    "--no-playlist",
    "--progress-template",
    "download:PROGRESS::%(progress.downloaded_bytes)s::%(progress.total_bytes)s::%(progress.total_bytes_estimate)s::%(progress._percent_str)s::%(progress._speed_str)s::%(progress._eta_str)s",
    "-N",
    String(request.threads),
    "-P",
    outputDirectory,
    "-o",
    "%(title)s [%(id)s].%(ext)s",
  ];

  const maxHeight = parseHeight(request.quality);
  const heightFilter = maxHeight ? `[height<=${maxHeight}]` : "";

  if (request.mode === "audio") {
    args.push(
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      request.audioFormat,
      "--audio-quality",
      "0",
      "--embed-metadata",
      "--add-metadata",
    );
  } else if (request.mode === "video-only") {
    args.push("-f", `bestvideo*${heightFilter}/bestvideo`);
  } else {
    args.push(
      "-f",
      `bestvideo*${heightFilter}+bestaudio/best*${heightFilter}/best`,
      "--merge-output-format",
      "mp4",
    );
  }

  args.push(request.url);

  return args;
}

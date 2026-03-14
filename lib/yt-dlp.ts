import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  DownloadMode,
  DownloadRequest,
  MediaFormatSummary,
  MetadataResponse,
  VideoContainer,
  VideoProfile,
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

  if (!id || format.ext === "mhtml" || format.format_note?.includes("storyboard")) {
    return null;
  }

  const hasVideo = Boolean(format.vcodec && format.vcodec !== "none");
  const hasAudio = Boolean(format.acodec && format.acodec !== "none");

  if (!hasVideo && !hasAudio) {
    return null;
  }

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

const DEBUG = process.env.CAPTURETHIS_DEBUG === "1" || process.env.CAPTURETHIS_PROFILE === "1";

export async function getMetadata(url: string): Promise<MetadataResponse> {
  assertSystemReady();

  const normalizedUrl = normalizeUrl(url);
  const metaStart = Date.now();
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

  if (DEBUG) {
    console.log(`[CaptureThis metadata] ${Date.now() - metaStart}ms for ${normalizedUrl.slice(0, 50)}`);
    console.log(`[CaptureThis metadata] Qualities: ${qualities.join(", ")}`);
  }

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

function buildCompatibleVideoSelector(heightFilter: string) {
  return [
    `bestvideo[ext=mp4][vcodec^=avc1]${heightFilter}+bestaudio[ext=m4a]`,
    `bestvideo[vcodec^=avc1]${heightFilter}+bestaudio[acodec^=mp4a]`,
    `best[ext=mp4][vcodec^=avc1][acodec^=mp4a]${heightFilter}`,
    `best[ext=mp4][vcodec^=avc1]${heightFilter}`,
    `best[ext=mp4]${heightFilter}`,
    `best${heightFilter}`,
  ].join("/");
}

function buildCompatibleVideoOnlySelector(heightFilter: string) {
  return [
    `bestvideo[ext=mp4][vcodec^=avc1]${heightFilter}`,
    `bestvideo[ext=mp4]${heightFilter}`,
    `bestvideo${heightFilter}`,
  ].join("/");
}

function buildHighestVideoSelector(heightFilter: string) {
  return `bestvideo*${heightFilter}+bestaudio/best*${heightFilter}/best${heightFilter}`;
}

function buildHighestVideoOnlySelector(heightFilter: string) {
  return `bestvideo*${heightFilter}/bestvideo${heightFilter}`;
}

function buildWebmVideoSelector(heightFilter: string) {
  return [
    `bestvideo[ext=webm]${heightFilter}+bestaudio[ext=webm]`,
    `best[ext=webm]${heightFilter}`,
    buildHighestVideoSelector(heightFilter),
  ].join("/");
}

function buildWebmVideoOnlySelector(heightFilter: string) {
  return [
    `bestvideo[ext=webm]${heightFilter}`,
    buildHighestVideoOnlySelector(heightFilter),
  ].join("/");
}

function resolveContainerProfile(
  outputContainer: VideoContainer,
  videoProfile: VideoProfile,
): VideoProfile {
  if (outputContainer === "mov") {
    if (videoProfile === "prores") {
      return "prores";
    }
    return "compatible";
  }

  if (outputContainer === "webm") {
    return "highest";
  }

  return videoProfile;
}

function sanitizeOutputName(value: string | undefined, fallback: string) {
  const candidate = (value?.trim() || fallback).replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ");
  const collapsed = candidate.replace(/\s+/g, " ").trim();
  return collapsed || "Untitled";
}

export function buildYtDlpArguments(request: DownloadRequest) {
  const outputName = sanitizeOutputName(request.outputName, request.title ?? "Untitled");
  const args = [
    "--newline",
    "--no-playlist",
    "--progress-template",
    "download:PROGRESS::%(progress.downloaded_bytes)s::%(progress.total_bytes)s::%(progress.total_bytes_estimate)s::%(progress._percent_str)s::%(progress._speed_str)s::%(progress._eta_str)s",
    "-N",
    String(request.threads),
    "-P",
    request.outputDirectory,
    "-o",
    `${outputName}.%(ext)s`,
  ];

  const maxHeight = parseHeight(request.quality);
  const heightFilter = maxHeight ? `[height<=${maxHeight}]` : "";
  const resolvedProfile = resolveContainerProfile(
    request.outputContainer,
    request.videoProfile,
  );

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
    const selector =
      request.outputContainer === "webm"
        ? buildWebmVideoOnlySelector(heightFilter)
        : resolvedProfile === "compatible"
          ? buildCompatibleVideoOnlySelector(heightFilter)
          : buildHighestVideoOnlySelector(heightFilter);

    args.push("-f", selector);

    if (request.outputContainer !== "webm") {
      args.push("--remux-video", request.outputContainer);
    }
  } else {
    const selector =
      request.outputContainer === "webm"
        ? buildWebmVideoSelector(heightFilter)
        : resolvedProfile === "compatible"
          ? buildCompatibleVideoSelector(heightFilter)
          : buildHighestVideoSelector(heightFilter);

    args.push(
      "-f",
      selector,
      "--merge-output-format",
      request.outputContainer,
    );
  }

  if (resolvedProfile === "prores") {
    args.push(
      "--postprocessor-args",
      "Video:-c:v prores_ks -profile:v 3 -vendor apl0 -bits_per_mb 8000 -pix_fmt yuv422p10le",
    );
  }

  args.push(request.url);

  return args;
}

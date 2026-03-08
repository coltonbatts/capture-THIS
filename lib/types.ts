export type DownloadMode = "video-audio" | "video-only" | "audio";
export type AudioFormat = "mp3" | "flac";
export type VideoContainer = "mp4" | "mov" | "mkv" | "webm";
export type VideoProfile = "compatible" | "highest";
export type JobStatus = "queued" | "downloading" | "completed" | "failed" | "cancelled";

export interface SystemCheck {
  name: "yt-dlp" | "ffmpeg";
  available: boolean;
  path: string | null;
  message: string;
}

export interface SystemStatus {
  ok: boolean;
  downloadDirectory: string;
  checks: SystemCheck[];
}

export interface MediaFormatSummary {
  id: string;
  label: string;
  ext: string;
  resolution: string;
  type: DownloadMode;
  fps: number | null;
  filesize: number | null;
  formatNote: string | null;
}

export interface MetadataResponse {
  url: string;
  title: string;
  thumbnail: string | null;
  uploader: string | null;
  durationSeconds: number | null;
  durationLabel: string;
  extractor: string | null;
  description: string | null;
  qualities: string[];
  formats: MediaFormatSummary[];
}

export interface DownloadRequest {
  url: string;
  title?: string;
  thumbnail?: string | null;
  mode: DownloadMode;
  quality: string;
  audioFormat: AudioFormat;
  outputContainer: VideoContainer;
  videoProfile: VideoProfile;
  threads: number;
  outputDirectory: string;
  outputName?: string;
  metadata?: MetadataResponse;
}

export interface JobProgress {
  percent: number;
  percentLabel: string;
  speed: string | null;
  eta: string | null;
  downloaded: string | null;
  total: string | null;
}

export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  status: JobStatus;
  quality: string;
  mode: DownloadMode;
  audioFormat: AudioFormat;
  outputContainer: VideoContainer;
  videoProfile: VideoProfile;
  threads: number;
  outputDirectory: string;
  outputName: string;
  progress: JobProgress;
  filePath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadSnapshot {
  jobs: DownloadJob[];
  activeJobId: string | null;
}

export interface DownloadEvent {
  type: "snapshot" | "job-added" | "job-updated" | "job-cancelled" | "heartbeat";
  snapshot: DownloadSnapshot;
}

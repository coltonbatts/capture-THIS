import type { AudioFormat, DownloadMode, VideoContainer, VideoProfile } from "@/lib/types";

export const DEFAULT_DOWNLOAD_MODE: DownloadMode = "video-audio";
export const DEFAULT_AUDIO_FORMAT: AudioFormat = "mp3";
export const DEFAULT_DOWNLOAD_QUALITY = "best";
export const DEFAULT_OUTPUT_CONTAINER: VideoContainer = "mp4";
export const DEFAULT_VIDEO_PROFILE: VideoProfile = "compatible";
export const DEFAULT_DOWNLOAD_THREADS = 8;

export const DEFAULT_OUTPUT_FOLDER_NAME = "Capture This";

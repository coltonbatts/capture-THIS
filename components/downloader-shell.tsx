"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownToLine,
  AudioLines,
  Clock3,
  CopyPlus,
  FileVideo2,
  FolderDown,
  FolderOpen,
  HardDriveDownload,
  Layers3,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  ScanSearch,
  Sparkles,
  CheckCircle2,
  Settings2,
  ChevronDown,
  XCircle,
  Ban,
} from "lucide-react";
import Image from "next/image";
import { useDeferredValue, useEffect, useState, useTransition } from "react";

import type {
  AudioFormat,
  DownloadJob,
  DownloadSnapshot,
  DownloadMode,
  MetadataResponse,
  SystemStatus,
} from "@/lib/types";
import { isLikelyUrl } from "@/lib/url";

import styles from "./downloader-shell.module.css";

const FORMAT_OPTIONS: Array<{
  value: DownloadMode;
  label: string;
  description: string;
}> = [
    { value: "video-audio", label: "Video + Audio", description: "Standard" },
    { value: "video-only", label: "Video Only", description: "Raw Picture" },
    { value: "audio", label: "Audio Only", description: "Extraction" },
  ];

const AUDIO_OPTIONS: Array<{ value: AudioFormat; label: string }> = [
  { value: "mp3", label: "MP3" },
  { value: "flac", label: "FLAC" },
];

function humanStatus(status: DownloadJob["status"]) {
  switch (status) {
    case "queued": return "Queued";
    case "downloading": return "Downloading";
    case "completed": return "Complete";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
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

export function DownloaderShell() {
  const [url, setUrl] = useState("");
  const deferredUrl = useDeferredValue(url);
  const [mode, setMode] = useState<DownloadMode>("video-audio");
  const [quality, setQuality] = useState("2160");
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");
  const [threads, setThreads] = useState(8);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [snapshot, setSnapshot] = useState<DownloadSnapshot>({
    jobs: [],
    activeJobId: null,
  });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isMetadataPending, startMetadataTransition] = useTransition();
  const [, startQueueTransition] = useTransition();

  // Toggle for advanced settings visibility
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch("/api/system", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to inspect system binaries.");
        return (await response.json()) as SystemStatus;
      })
      .then((result) => { if (mounted) setSystemStatus(result); })
      .catch((error: Error) => { if (mounted) setQueueError(error.message); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/download");
    const updateSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { snapshot: DownloadSnapshot };
      startQueueTransition(() => {
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
    return () => { source.close(); };
  }, [startQueueTransition]);

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
            if (payload.qualities[0]) {
              setQuality((current) =>
                payload.qualities.includes(current) ? current : payload.qualities[0],
              );
            }
          });
        })
        .catch((error: Error) => {
          startMetadataTransition(() => {
            setMetadata(null);
            setMetadataError(error.message);
          });
        });
    }, 420);
    return () => { window.clearTimeout(timeout); };
  }, [deferredUrl]);

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
    if (!isLikelyUrl(candidate)) {
      setQueueError("Provide a valid media URL before queueing.");
      return;
    }
    setQueueError(null);
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: candidate,
        title: metadata?.title,
        thumbnail: metadata?.thumbnail,
        mode,
        quality,
        audioFormat,
        threads,
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
    setShowSettings(false);
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

  // Most recent jobs at the top
  const historyJobs = [...snapshot.jobs].reverse().filter(j => j.id !== activeJob?.id);

  const isYtdlpReady = systemStatus?.checks?.find(c => c.name === 'yt-dlp')?.available ?? false;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>

        <motion.section
          className={styles.stage}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Top minimal status indicator */}
          <div className={styles.systemDiscrete} title={isYtdlpReady ? "Engine Ready" : "System initializing"}>
            <div className={`${styles.statusDot} ${!isYtdlpReady ? styles.offline : ""}`} />
            <span className={styles.systemBadge}>Engine {isYtdlpReady ? "Idle" : "Offline"}</span>
          </div>

          <div className={styles.hero}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="CaptureTHIS" className={styles.heroLogo} />
            <h1 className={styles.heroTitle}>Drop a link.</h1>
            <p className={styles.eyebrow}>High-fidelity extraction engine.</p>
          </div>

          <div className={styles.inputPanel}>
            <div className={styles.inputRow}>
              <input
                className={styles.input}
                type="url"
                placeholder="Paste YouTube or Media URL"
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="button"
                className={styles.primaryButton}
                onClick={url.trim() ? handleQueue : handlePaste}
                disabled={Boolean(url.trim() && !isLikelyUrl(url.trim()))}
              >
                {url.trim() ? (
                  <>
                    <ArrowDownToLine size={18} />
                    Download
                  </>
                ) : (
                  <>
                    <CopyPlus size={18} />
                    Paste
                  </>
                )}
              </button>
            </div>

            {/* Inline Metadata (if loaded and URL is present) */}
            <AnimatePresence>
              {metadata && url.trim() && (
                <motion.div
                  className={styles.metadataInline}
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 16 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
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
                        <FileVideo2 size={24} />
                      </div>
                    )}
                  </div>
                  <div className={styles.metadataContent}>
                    <h3 className={styles.metadataTitle}>{metadata.title}</h3>
                    <p className={styles.metadataSub}>
                      <span>{metadata.durationLabel}</span> • <span>{metadata.uploader}</span>
                    </p>
                  </div>
                  {/* Settings Toggle placed cleanly on the right of metadata */}
                  <button
                    type="button"
                    className={styles.settingsToggle}
                    onClick={() => setShowSettings(!showSettings)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-strong)', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: '8px', transition: 'background 0.2s' }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--stroke)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Settings2 size={16} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>Options</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Elegant dropdown settings area */}
            <AnimatePresence>
              {showSettings && metadata && url.trim() && (
                <motion.div
                  className={styles.controlsDrawer}
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                >
                  <div className={styles.controlRow}>
                    <label className={styles.field}>
                      <span>Format</span>
                      <select className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as DownloadMode)}>
                        {FORMAT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>Quality</span>
                      <select
                        className={styles.select}
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                        disabled={mode === "audio"}
                      >
                        {(metadata?.qualities.length ? metadata.qualities : ["2160", "1440", "1080", "720", "480"]).map(opt => (
                          <option key={opt} value={opt}>{opt === "2160" ? "4K (Native)" : `${opt}p`}</option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>Audio Codec</span>
                      <select
                        className={styles.select}
                        value={audioFormat}
                        onChange={(e) => setAudioFormat(e.target.value as AudioFormat)}
                        disabled={mode !== "audio"}
                      >
                        {AUDIO_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {(queueError || metadataError) && (
              <motion.div
                className={styles.alert}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <AlertCircle size={18} />
                <span>{queueError ?? metadataError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Active Download Progress */}
          <AnimatePresence>
            {activeJob && (
              <motion.div
                className={styles.livePanel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <div className={styles.liveHeader}>
                  <div>
                    <strong>{activeJob.title}</strong>
                    <p className={styles.liveStatus}>{humanStatus(activeJob.status)} • {activeJob.mode === "audio" ? activeJob.audioFormat.toUpperCase() : `${activeJob.quality}p`}</p>
                  </div>
                  <div className={styles.liveStats}>
                    <span>{activeJob.progress.speed ?? "Calculating..."}</span>
                    <span>{activeJob.progress.eta ? `~ ${activeJob.progress.eta}` : ""}</span>
                  </div>
                </div>

                <div className={styles.progressBar}>
                  <motion.div
                    className={styles.progressFill}
                    animate={{ width: `${Math.max(activeJob.progress.percent, 2)}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>

                <div className={styles.liveFooter}>
                  <span>{activeJob.progress.percentLabel}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span>{activeJob.progress.downloaded ?? "0"} {activeJob.progress.total ? `/ ${activeJob.progress.total}` : ""}</span>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => handleCancel(activeJob.id)}
                      disabled={isCancelling}
                      title="Cancel download"
                    >
                      <XCircle size={16} />
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* History List below main control */}
          {historyJobs.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.historyHeader}>
                <Layers3 size={16} />
                <span>Recent Extractions</span>
              </div>
              <div className={styles.historyList}>
                {historyJobs.slice(0, 5).map(job => (
                  <div key={job.id} className={styles.historyCard}>
                    <div className={styles.historyMain}>
                      <strong>{job.title}</strong>
                      <span>{job.mode === "audio" ? job.audioFormat.toUpperCase() : `${job.quality}p`}</span>
                    </div>
                    <div className={styles.historyMeta}>
                      {job.status === "completed" ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {job.filePath && (
                            <button
                              type="button"
                              className={styles.revealButton}
                              onClick={() => handleReveal(job.filePath!)}
                              title="Show in Finder"
                            >
                              <FolderOpen size={16} />
                              <span>Finder</span>
                            </button>
                          )}
                          <CheckCircle2 size={18} color="var(--success)" />
                        </div>
                      ) : job.status === "cancelled" ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Ban size={16} color="var(--muted)" />
                          <span className={styles.historyStatus}>Cancelled</span>
                        </div>
                      ) : (
                        <span className={styles.historyStatus}>{humanStatus(job.status)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </motion.section>
      </div>
    </main>
  );
}

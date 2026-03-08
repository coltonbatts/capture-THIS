"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownToLine,
  CopyPlus,
  FileVideo2,
  FolderOpen,
  LoaderCircle,
  RadioTower,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import { useDeferredValue, useEffect, useState, useTransition } from "react";

import {
  DEFAULT_DOWNLOAD_QUALITY,
  DEFAULT_OUTPUT_CONTAINER,
  DEFAULT_VIDEO_PROFILE,
} from "@/lib/download-preset";
import type {
  DownloadJob,
  DownloadSnapshot,
  MetadataResponse,
  SystemStatus,
  VideoContainer,
  VideoProfile,
} from "@/lib/types";
import { extractUrlsFromText } from "@/lib/url";

import styles from "./downloader-shell.module.css";

interface SourceDraft {
  url: string;
  metadata: MetadataResponse | null;
  error: string | null;
  outputName: string;
  quality: string;
  hasEditedOutputName: boolean;
  isInspecting: boolean;
}

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

function formatQualityChoice(quality: string) {
  return quality === "best" ? "Highest available" : `${quality}P max`;
}

function formatContainerLabel(outputContainer: VideoContainer) {
  return outputContainer.toUpperCase();
}

function formatProfileLabel(videoProfile: VideoProfile) {
  return videoProfile === "compatible" ? "QuickTime compatible" : "Highest available";
}

function getHighestQuality(metadata: MetadataResponse | null) {
  const highest = metadata?.qualities[0];
  return highest ? `${highest}P` : "Best available";
}

function isQualitySupported(quality: string, metadata: MetadataResponse) {
  return quality === "best" || metadata.qualities.includes(quality);
}

function createPendingDraft(url: string, previous?: SourceDraft): SourceDraft {
  return {
    url,
    metadata: previous?.metadata ?? null,
    error: null,
    outputName: previous?.outputName ?? "",
    quality: previous?.quality ?? DEFAULT_DOWNLOAD_QUALITY,
    hasEditedOutputName: previous?.hasEditedOutputName ?? false,
    isInspecting: true,
  };
}

async function fetchSourceMetadata(url: string) {
  const response = await fetch("/api/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Metadata lookup failed.");
  }

  return payload as MetadataResponse;
}

export function DownloaderShell() {
  const [sourceInput, setSourceInput] = useState("");
  const deferredSourceInput = useDeferredValue(sourceInput);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [outputContainer, setOutputContainer] =
    useState<VideoContainer>(DEFAULT_OUTPUT_CONTAINER);
  const [videoProfile, setVideoProfile] = useState<VideoProfile>(DEFAULT_VIDEO_PROFILE);
  const [hasEditedOutputDirectory, setHasEditedOutputDirectory] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [sourceDrafts, setSourceDrafts] = useState<SourceDraft[]>([]);
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
    const urls = extractUrlsFromText(deferredSourceInput);

    if (!urls.length) {
      startMetadataTransition(() => {
        setSourceDrafts([]);
      });
      return;
    }

    startMetadataTransition(() => {
      setSourceDrafts((current) => {
        const currentMap = new Map(current.map((draft) => [draft.url, draft]));
        return urls.map((url) => createPendingDraft(url, currentMap.get(url)));
      });
    });

    let active = true;
    const timeout = window.setTimeout(() => {
      Promise.all(
        urls.map(async (url) => {
          try {
            const metadata = await fetchSourceMetadata(url);
            return { url, metadata, error: null as string | null };
          } catch (error) {
            return {
              url,
              metadata: null,
              error: error instanceof Error ? error.message : "Metadata lookup failed.",
            };
          }
        }),
      ).then((results) => {
        if (!active) {
          return;
        }

        const resultMap = new Map(results.map((result) => [result.url, result]));

        startMetadataTransition(() => {
          setSourceDrafts((current) => {
            const currentMap = new Map(current.map((draft) => [draft.url, draft]));

            return urls.map((url) => {
              const previous = currentMap.get(url);
              const result = resultMap.get(url);

              if (!result || result.error || !result.metadata) {
                return {
                  url,
                  metadata: null,
                  error: result?.error ?? "Metadata lookup failed.",
                  outputName: previous?.outputName ?? "",
                  quality: previous?.quality ?? DEFAULT_DOWNLOAD_QUALITY,
                  hasEditedOutputName: previous?.hasEditedOutputName ?? false,
                  isInspecting: false,
                };
              }

              return {
                url,
                metadata: result.metadata,
                error: null,
                outputName:
                  previous?.hasEditedOutputName && previous.outputName.trim()
                    ? previous.outputName
                    : result.metadata.title,
                quality:
                  previous && isQualitySupported(previous.quality, result.metadata)
                    ? previous.quality
                    : DEFAULT_DOWNLOAD_QUALITY,
                hasEditedOutputName: previous?.hasEditedOutputName ?? false,
                isInspecting: false,
              };
            });
          });
        });
      });
    }, 420);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [deferredSourceInput, startMetadataTransition]);

  async function handlePaste() {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (clipboard.trim()) {
        setQueueError(null);
        setSourceInput(clipboard.trim());
      }
    } catch {
      setQueueError("Clipboard access was blocked by the browser.");
    }
  }

  async function handleQueue() {
    if (!outputDirectory.trim()) {
      setQueueError("Choose a destination folder before downloading.");
      return;
    }

    if (sourceDrafts.some((draft) => draft.isInspecting)) {
      setQueueError("Wait for source inspection to finish before queueing.");
      return;
    }

    const readyDrafts = sourceDrafts.filter((draft) => draft.metadata && !draft.error);

    if (!readyDrafts.length) {
      setQueueError("Paste at least one valid media URL before downloading.");
      return;
    }

    setQueueError(null);
    setIsQueueing(true);

    let latestSnapshot = snapshot;
    const queuedJobs: DownloadJob[] = [];
    const failedUrls: string[] = [];
    const errors: string[] = [];

    try {
      for (const draft of readyDrafts) {
        const response = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: draft.url,
            title: draft.metadata?.title,
            thumbnail: draft.metadata?.thumbnail,
            quality: draft.quality,
            outputContainer,
            videoProfile,
            outputDirectory,
            outputName: draft.outputName,
            metadata: draft.metadata ?? undefined,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          failedUrls.push(draft.url);
          errors.push(payload.error ?? `Unable to add ${draft.url}.`);
          continue;
        }

        latestSnapshot = payload.snapshot as DownloadSnapshot;
        queuedJobs.push(payload.job as DownloadJob);
      }

      if (queuedJobs.length) {
        setSnapshot(latestSnapshot);
        setSelectedJobId(queuedJobs[queuedJobs.length - 1]?.id ?? null);
      }

      if (failedUrls.length) {
        setQueueError(
          `Queued ${queuedJobs.length} of ${readyDrafts.length}. ${errors[0] ?? "Some items failed to queue."}`,
        );
        setSourceInput(failedUrls.join("\n"));
      } else {
        setSourceInput("");
      }
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

  function updateDraft(url: string, updater: (draft: SourceDraft) => SourceDraft) {
    setSourceDrafts((current) =>
      current.map((draft) => (draft.url === url ? updater(draft) : draft)),
    );
  }

  const activeJob =
    snapshot.jobs.find((job) => job.id === snapshot.activeJobId) ??
    snapshot.jobs.find((job) => job.status === "downloading") ??
    null;

  const selectedJob =
    snapshot.jobs.find((job) => job.id === selectedJobId) ??
    activeJob ??
    snapshot.jobs[0] ??
    null;

  const isYtdlpReady =
    systemStatus?.checks.find((check) => check.name === "yt-dlp")?.available ?? false;

  const readyDrafts = sourceDrafts.filter((draft) => draft.metadata && !draft.error);
  const failedDraftCount = sourceDrafts.filter((draft) => draft.error).length;
  const isInspectingSources = sourceDrafts.some((draft) => draft.isInspecting);
  const queuedLabel =
    readyDrafts.length > 1 ? `Queue ${readyDrafts.length} Downloads` : "Download";
  const resolvedProfile =
    outputContainer === "mov"
      ? "compatible"
      : outputContainer === "webm"
        ? "highest"
        : videoProfile;
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
            <div />
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
                <h1 className={styles.heroTitle}>Capture This</h1>
              </div>

              <form
                className={styles.inputPanel}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleQueue();
                }}
              >
                <label className={styles.inputLabel} htmlFor="media-url">
                  Source Links
                </label>
                <div className={`${styles.inputRow} ${styles.inputRowMulti}`}>
                  <textarea
                    id="media-url"
                    className={`${styles.input} ${styles.inputArea}`}
                    inputMode="url"
                    placeholder="Paste one URL per line or a whole block of links"
                    autoComplete="off"
                    spellCheck={false}
                    value={sourceInput}
                    onChange={(event) => {
                      setQueueError(null);
                      setSourceInput(event.target.value);
                    }}
                  />
                </div>
                <div className={styles.inputMeta}>
                  <span>
                    {isInspectingSources || isMetadataPending
                      ? "Inspecting source profiles and available quality ladders..."
                      : readyDrafts.length
                        ? `${readyDrafts.length} source${readyDrafts.length === 1 ? "" : "s"} staged. Review file names and quality before queueing.`
                        : "Paste one or more media URLs. Bare youtube.com and youtu.be links work."}
                  </span>
                  {isInspectingSources || isMetadataPending ? (
                    <span className={styles.inlineStatus}>
                      <LoaderCircle size={14} className={styles.spinner} />
                      Inspecting
                    </span>
                  ) : null}
                </div>

                <div className={styles.controlGrid}>
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
                    <span>File Type</span>
                    <select
                      className={styles.select}
                      value={outputContainer}
                      onChange={(event) => {
                        const nextContainer = event.target.value as VideoContainer;
                        setOutputContainer(nextContainer);
                        if (nextContainer === "mov") {
                          setVideoProfile("compatible");
                        } else if (nextContainer === "webm") {
                          setVideoProfile("highest");
                        }
                      }}
                    >
                      <option value="mp4">MP4</option>
                      <option value="mov">MOV</option>
                      <option value="mkv">MKV</option>
                      <option value="webm">WEBM</option>
                    </select>
                  </label>

                  <label className={`${styles.field} ${styles.summaryField}`}>
                    <span>Codec Strategy</span>
                    <select
                      className={styles.select}
                      value={resolvedProfile}
                      onChange={(event) => {
                        setVideoProfile(event.target.value as VideoProfile);
                      }}
                      disabled={outputContainer === "mov" || outputContainer === "webm"}
                    >
                      <option value="compatible">QuickTime compatible</option>
                      <option value="highest">Highest available</option>
                    </select>
                  </label>
                </div>

                <div className={styles.actionRow}>
                  <button type="button" className={styles.ghostButton} onClick={handlePaste}>
                    <CopyPlus size={16} />
                    Paste Links
                  </button>
                  <button
                    type="submit"
                    className={`${styles.ghostButton} ${styles.primaryAction} ${styles.downloadButton}`}
                    disabled={!readyDrafts.length || isQueueing || isInspectingSources}
                  >
                    <ArrowDownToLine size={16} />
                    {queuedLabel}
                  </button>
                </div>
              </form>

              <AnimatePresence>
                {queueError ? (
                  <motion.div
                    className={styles.alert}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <AlertCircle size={18} />
                    <span>{queueError}</span>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {sourceDrafts.length ? (
                  <section className={styles.sourceList}>
                    {sourceDrafts.map((draft, index) => {
                      const qualityOptions = draft.metadata?.qualities ?? [];

                      return (
                        <motion.article
                          key={draft.url}
                          className={`${styles.metadataCard} ${draft.error ? styles.metadataCardError : ""}`}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <div className={styles.thumbnailFrame}>
                            {draft.metadata?.thumbnail ? (
                              <Image
                                src={draft.metadata.thumbnail}
                                alt="Thumbnail"
                                fill
                                unoptimized
                                className={styles.thumbnail}
                              />
                            ) : draft.isInspecting ? (
                              <div className={styles.thumbnailFallback}>
                                <LoaderCircle size={28} className={styles.spinner} />
                              </div>
                            ) : (
                              <div className={styles.thumbnailFallback}>
                                <FileVideo2 size={28} />
                              </div>
                            )}
                          </div>
                          <div className={styles.metadataContent}>
                            <div className={styles.metadataHeader}>
                              <p className={styles.sectionLabel}>Source {index + 1}</p>
                              <span className={styles.metadataTag}>{draft.metadata?.uploader ?? ""}</span>
                            </div>

                            <h2 className={styles.metadataTitle}>
                              {draft.metadata?.title ?? draft.url}
                            </h2>
                            <p className={styles.metadataSub}>
                              {draft.error
                                ? draft.error
                                : draft.isInspecting
                                  ? "Inspecting source..."
                                  : draft.url}
                            </p>

                            {!draft.error && draft.metadata ? (
                              <>
                                <div className={styles.metadataGrid}>
                                  <div className={styles.statBlock}>
                                    <span>Duration</span>
                                    <strong>{draft.metadata.durationLabel}</strong>
                                  </div>
                                  <div className={styles.statBlock}>
                                    <span>Max Source</span>
                                    <strong>{getHighestQuality(draft.metadata)}</strong>
                                  </div>
                                </div>

                                <div className={styles.itemControlGrid}>
                                  <label className={styles.field}>
                                    <span>File Name</span>
                                    <input
                                      className={styles.textField}
                                      type="text"
                                      placeholder={draft.metadata.title}
                                      value={draft.outputName}
                                      onChange={(event) => {
                                        updateDraft(draft.url, (current) => ({
                                          ...current,
                                          outputName: event.target.value,
                                          hasEditedOutputName: true,
                                        }));
                                      }}
                                    />
                                  </label>

                                  <label className={styles.field}>
                                    <span>Resolution Target</span>
                                    <select
                                      className={styles.select}
                                      value={draft.quality}
                                      onChange={(event) => {
                                        updateDraft(draft.url, (current) => ({
                                          ...current,
                                          quality: event.target.value,
                                        }));
                                      }}
                                    >
                                      <option value="best">
                                        Highest available ({getHighestQuality(draft.metadata)} max)
                                      </option>
                                      {qualityOptions.map((quality) => (
                                        <option key={quality} value={quality}>
                                          {quality}P max
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>

                                <p className={styles.metadataNote}>
                                  {formatQualityChoice(draft.quality)}.{" "}
                                  {formatContainerLabel(outputContainer)}.{" "}
                                  {formatProfileLabel(resolvedProfile)}.
                                </p>
                              </>
                            ) : (
                              <p className={styles.metadataNote}>
                                {draft.error
                                  ? "Remove or fix this URL to keep it out of the batch."
                                  : "Waiting for extractor metadata before quality controls unlock."}
                              </p>
                            )}
                          </div>
                        </motion.article>
                      );
                    })}
                  </section>
                ) : null}
              </AnimatePresence>

            </section>

            <aside className={styles.sideRail}>
              <section className={styles.sidePanel}>
                <div className={styles.panelHeader}>
                  <p className={styles.sectionLabel}>Summary</p>
                  <span className={styles.panelMeta}>
                    {systemStatus?.ok ? "Online" : "Booting"}
                  </span>
                </div>
                <div className={styles.systemList}>
                  <div className={styles.systemRow}>
                    <span>Ready</span>
                    <strong>
                      {readyDrafts.length} ready
                      {failedDraftCount ? ` / ${failedDraftCount} need attention` : ""}
                    </strong>
                  </div>
                  <div className={styles.systemRow}>
                    <span>Format</span>
                    <strong>
                      {formatContainerLabel(outputContainer)} / {formatProfileLabel(resolvedProfile)}
                    </strong>
                  </div>
                  <div className={styles.systemRow}>
                    <span>Folder</span>
                    <strong>{outputDirectory.trim() || systemStatus?.downloadDirectory || "Not set"}</strong>
                  </div>
                  <div className={styles.systemRow}>
                    <span>Engine</span>
                    <strong>{isYtdlpReady ? "Ready" : "Unavailable"}</strong>
                  </div>
                </div>
              </section>

              <section className={styles.sidePanel}>
                <div className={styles.panelHeader}>
                  <p className={styles.sectionLabel}>Live Output</p>
                  <span
                    className={`${styles.liveBadge} ${selectedJob ? styles[toneClass(selectedJob.status)] : styles.toneNeutral}`}
                  >
                    <RadioTower size={14} />
                    {selectedJob ? humanStatus(selectedJob.status) : "Standby"}
                  </span>
                </div>

                {selectedJob ? (
                  <div className={styles.liveStack}>
                    <div className={styles.liveHeading}>
                      <strong>{selectedJob.outputName}</strong>
                      <span>
                        {formatQualityChoice(selectedJob.quality)} /{" "}
                        {formatContainerLabel(selectedJob.outputContainer)} /{" "}
                        {formatProfileLabel(selectedJob.videoProfile)} /{" "}
                        {formatTimestamp(selectedJob.updatedAt)}
                      </span>
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
                          onClick={() => {
                            if (selectedJob.filePath) {
                              void handleReveal(selectedJob.filePath);
                            }
                          }}
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
                    No active extractions. Paste one or more URLs, review the quality ladder for
                    each source, and queue the batch.
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

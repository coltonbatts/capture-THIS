import { NextRequest, NextResponse } from "next/server";

import { downloadManager } from "@/lib/download-manager";
import type { AudioFormat, DownloadMode, DownloadRequest, MetadataResponse } from "@/lib/types";
import { isLikelyUrl, normalizeUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function toSseChunk(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function isMode(value: string): value is DownloadMode {
  return value === "video-audio" || value === "video-only" || value === "audio";
}

function isAudioFormat(value: string): value is AudioFormat {
  return value === "mp3" || value === "flac";
}

export async function GET(request: NextRequest) {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const close = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) {
      return;
    }

    closed = true;

    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (controller) {
      controller.close();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = downloadManager.subscribe((event) => {
        controller.enqueue(toSseChunk(event.type, event));
      });

      heartbeat = setInterval(() => {
        downloadManager.heartbeat();
      }, 15000);

      request.signal.addEventListener("abort", () => {
        close(controller);
      });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<DownloadRequest> & { metadata?: MetadataResponse };
    const url = normalizeUrl(body.url ?? "");

    if (!isLikelyUrl(url)) {
      return NextResponse.json(
        { error: "Provide a valid URL before adding to queue." },
        { status: 400 },
      );
    }

    const requestedMode = body.mode ?? "";
    const requestedAudioFormat = body.audioFormat ?? "";
    const mode: DownloadMode = isMode(requestedMode)
      ? requestedMode
      : "video-audio";
    const audioFormat: AudioFormat = isAudioFormat(requestedAudioFormat)
      ? requestedAudioFormat
      : "mp3";
    const quality = body.quality?.trim() || "2160";
    const threads = Math.min(Math.max(Number(body.threads ?? 8), 1), 16);

    const job = await downloadManager.enqueue({
      url,
      title: body.title?.trim(),
      thumbnail: body.thumbnail ?? null,
      mode,
      quality,
      audioFormat,
      threads,
      metadata: body.metadata,
    });

    return NextResponse.json({ job, snapshot: downloadManager.snapshot() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to queue download.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { jobId?: string };
    const jobId = body.jobId?.trim();

    if (!jobId) {
      return NextResponse.json(
        { error: "Provide a jobId to cancel." },
        { status: 400 },
      );
    }

    downloadManager.cancel(jobId);

    return NextResponse.json({ ok: true, snapshot: downloadManager.snapshot() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to cancel download.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}


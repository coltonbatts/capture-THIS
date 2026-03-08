import { NextRequest, NextResponse } from "next/server";

import { downloadManager } from "@/lib/download-manager";
import {
  DEFAULT_AUDIO_FORMAT,
  DEFAULT_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_QUALITY,
  DEFAULT_DOWNLOAD_THREADS,
  DEFAULT_OUTPUT_CONTAINER,
  DEFAULT_VIDEO_PROFILE,
} from "@/lib/download-preset";
import type { DownloadRequest, MetadataResponse } from "@/lib/types";
import { isLikelyUrl, normalizeUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function toSseChunk(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
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

    const job = await downloadManager.enqueue({
      url,
      title: body.title?.trim(),
      thumbnail: body.thumbnail ?? null,
      mode: DEFAULT_DOWNLOAD_MODE,
      quality: body.quality?.trim() || DEFAULT_DOWNLOAD_QUALITY,
      audioFormat: DEFAULT_AUDIO_FORMAT,
      outputContainer: body.outputContainer ?? DEFAULT_OUTPUT_CONTAINER,
      videoProfile: body.videoProfile ?? DEFAULT_VIDEO_PROFILE,
      threads: DEFAULT_DOWNLOAD_THREADS,
      outputDirectory: body.outputDirectory?.trim() ?? "",
      outputName: body.outputName?.trim(),
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

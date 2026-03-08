import { NextRequest, NextResponse } from "next/server";

import { getMetadata } from "@/lib/yt-dlp";
import { isLikelyUrl, normalizeUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { url?: string };
    const url = normalizeUrl(payload.url ?? "");

    if (!isLikelyUrl(url)) {
      return NextResponse.json(
        { error: "Provide a valid media URL to inspect." },
        { status: 400 },
      );
    }

    const metadata = await getMetadata(url);
    return NextResponse.json(metadata);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to extract metadata.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { downloadDirectory } from "@/lib/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as { filePath?: string };
        const filePath = body.filePath?.trim();

        if (!filePath) {
            return NextResponse.json(
                { error: "Provide a filePath to reveal." },
                { status: 400 },
            );
        }

        // Security: ensure path is under the sanctioned download directory
        const resolved = resolve(filePath);
        if (!resolved.startsWith(resolve(downloadDirectory))) {
            return NextResponse.json(
                { error: "Path is outside the download directory." },
                { status: 403 },
            );
        }

        if (!existsSync(resolved)) {
            return NextResponse.json(
                { error: "File no longer exists at the expected path." },
                { status: 404 },
            );
        }

        // macOS: reveal file in Finder
        exec(`open -R "${resolved.replace(/"/g, '\\"')}"`);

        return NextResponse.json({ ok: true });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to reveal file.";

        return NextResponse.json({ error: message }, { status: 500 });
    }
}

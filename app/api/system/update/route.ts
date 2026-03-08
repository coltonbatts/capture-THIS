import { NextResponse } from "next/server";

import { updateYtDlp } from "@/lib/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
    try {
        const message = await updateYtDlp();
        return NextResponse.json({ message });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Failed to update." }, { status: 500 });
    }
}

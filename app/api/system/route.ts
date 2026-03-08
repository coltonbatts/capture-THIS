import { NextResponse } from "next/server";

import { getSystemStatus } from "@/lib/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSystemStatus());
}

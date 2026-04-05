/**
 * GET  /api/admin/codes — list all redemption codes
 * POST /api/admin/codes — create a new redemption code
 * Auth: x-admin-secret header must match ADMIN_SECRET env var
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
  return Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function authCheck(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret === process.env.ADMIN_SECRET;
}

export async function GET(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = serviceClient();
  const { data, error } = await db
    .from("redemption_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: data });
}

export async function POST(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { code: customCode, minutes, maxUses = 1, expiresAt, note } =
    await req.json() as {
      code?: string;
      minutes: number;
      maxUses?: number;
      expiresAt?: string;
      note?: string;
    };

  if (!minutes || minutes <= 0) return NextResponse.json({ error: "Invalid minutes" }, { status: 400 });

  const db = serviceClient();
  const code = (customCode?.trim().toUpperCase()) || genCode();

  const { data, error } = await db.from("redemption_codes").insert({
    code,
    minutes,
    max_uses: maxUses,
    uses_count: 0,
    expires_at: expiresAt ?? null,
    note: note ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ code: data });
}

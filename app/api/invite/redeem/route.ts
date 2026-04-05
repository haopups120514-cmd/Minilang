/**
 * POST /api/invite/redeem
 * Body: { code: string }
 * Auth: Bearer <JWT>   (called right after signUp with the new user's session)
 * Returns: { ok: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return NextResponse.json({ ok: false }, { status: 401 });

  // Create a user-scoped client so RLS uses the caller's uid
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { code } = await req.json() as { code: string };
  const trimmed = code?.trim().toUpperCase();
  if (!trimmed) return NextResponse.json({ ok: false });

  const { error } = await supabase
    .from("invite_codes")
    .update({ used_by: user.id, used_at: new Date().toISOString() })
    .eq("code", trimmed)
    .is("used_by", null); // only redeem if still unused

  return NextResponse.json({ ok: !error });
}

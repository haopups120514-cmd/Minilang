/**
 * GET /api/credits/balance
 * Returns current user's credit balance.
 * Creates the record on first call (120 base mins + random referral code).
 * Handles monthly reset atomically.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I O 0 1
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

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function thisMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function calcRemaining(row: { base_used_month: number; bonus_minutes: number }) {
  return Math.max(0, 120 - row.base_used_month) + row.bonus_minutes;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await anonClient().auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = serviceClient();
  const monthStart = thisMonthStart();

  // Try to fetch existing record
  const { data: existing } = await db
    .from("user_credits")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    // First time: create record
    let referral_code = genCode();
    // Ensure unique (retry on collision)
    for (let i = 0; i < 5; i++) {
      const { data: clash } = await db.from("user_credits").select("user_id").eq("referral_code", referral_code).single();
      if (!clash) break;
      referral_code = genCode();
    }
    const { data: created, error } = await db.from("user_credits").insert({
      user_id: user.id,
      bonus_minutes: 0,
      base_used_month: 0,
      monthly_reset_date: monthStart,
      referral_code,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      minutesRemaining: 120,
      baseRemaining: 120,
      bonusMinutes: 0,
      referralCode: created.referral_code,
      displayName: "",
    });
  }

  // Monthly reset check
  let row = existing;
  const storedMonth = existing.monthly_reset_date?.slice(0, 7); // "YYYY-MM"
  const currentMonth = monthStart.slice(0, 7);
  if (storedMonth < currentMonth) {
    const { data: updated } = await db
      .from("user_credits")
      .update({ base_used_month: 0, monthly_reset_date: monthStart })
      .eq("user_id", user.id)
      .select()
      .single();
    if (updated) row = updated;
  }

  return NextResponse.json({
    minutesRemaining: calcRemaining(row),
    baseRemaining: Math.max(0, 120 - row.base_used_month),
    bonusMinutes: row.bonus_minutes,
    referralCode: row.referral_code,
    displayName: (row as Record<string, unknown>).display_name ?? "",
  });
}

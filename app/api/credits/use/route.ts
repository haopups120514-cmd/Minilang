/**
 * POST /api/credits/use
 * Body: { minutes: number }
 * Deducts minutes from balance. Base quota (120/month) consumed first,
 * then bonus_minutes. Returns updated balance.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function calcRemaining(row: { base_used_month: number; bonus_minutes: number }) {
  return Math.max(0, 120 - row.base_used_month) + row.bonus_minutes;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await anonClient().auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { minutes } = await req.json() as { minutes: number };
  if (!minutes || minutes <= 0) return NextResponse.json({ error: "Invalid minutes" }, { status: 400 });

  const db = serviceClient();
  const { data: row, error } = await db
    .from("user_credits")
    .select("base_used_month, bonus_minutes")
    .eq("user_id", user.id)
    .single();

  if (error || !row) return NextResponse.json({ error: "No credits record" }, { status: 404 });

  // Deduct from base first, then bonus
  const baseAvailable = Math.max(0, 120 - row.base_used_month);
  const fromBase  = Math.min(minutes, baseAvailable);
  const fromBonus = Math.max(0, minutes - fromBase);

  const newBaseUsed  = row.base_used_month + fromBase;
  const newBonus     = Math.max(0, row.bonus_minutes - fromBonus);

  const { data: updated } = await db
    .from("user_credits")
    .update({ base_used_month: newBaseUsed, bonus_minutes: newBonus })
    .eq("user_id", user.id)
    .select()
    .single();

  return NextResponse.json({
    minutesRemaining: updated ? calcRemaining(updated) : 0,
    minutesDeducted: minutes,
  });
}

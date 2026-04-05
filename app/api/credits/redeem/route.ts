/**
 * POST /api/credits/redeem
 * Body: { code: string }
 * Handles both referral codes and admin redemption codes.
 * Referral: redeemer +60 bonus, referrer +30 bonus
 * Redemption: redeemer + code.minutes bonus
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

  const { code: rawCode } = await req.json() as { code: string };
  if (!rawCode?.trim()) return NextResponse.json({ error: "请输入兑换码" }, { status: 400 });

  const code = rawCode.trim().toUpperCase();
  const db = serviceClient();

  // ── 1. Prevent duplicate use ──────────────────────────────────────────────
  const { data: alreadyUsed } = await db
    .from("code_redemptions")
    .select("id")
    .eq("user_id", user.id)
    .eq("code", code)
    .single();
  if (alreadyUsed) {
    return NextResponse.json({ error: "该码已使用过" }, { status: 400 });
  }

  // ── 2. Ensure redeemer has a credits record ───────────────────────────────
  const { data: myRow } = await db
    .from("user_credits")
    .select("bonus_minutes, base_used_month")
    .eq("user_id", user.id)
    .single();
  if (!myRow) {
    return NextResponse.json({ error: "请先打开应用初始化账户" }, { status: 400 });
  }

  // ── 3. Try referral code ──────────────────────────────────────────────────
  const { data: referrer } = await db
    .from("user_credits")
    .select("user_id, referral_code, bonus_minutes")
    .eq("referral_code", code)
    .single();

  if (referrer) {
    if (referrer.user_id === user.id) {
      return NextResponse.json({ error: "不能使用自己的邀请码" }, { status: 400 });
    }
    const REDEEMER_BONUS = 60;
    const REFERRER_BONUS = 30;

    // Add bonus to redeemer
    await db.from("user_credits").update({
      bonus_minutes: myRow.bonus_minutes + REDEEMER_BONUS,
    }).eq("user_id", user.id);

    // Add bonus to referrer
    await db.from("user_credits").update({
      bonus_minutes: referrer.bonus_minutes + REFERRER_BONUS,
    }).eq("user_id", referrer.user_id);

    // Log redemption
    await db.from("code_redemptions").insert({
      user_id: user.id,
      code,
      code_type: "referral",
      minutes_added: REDEEMER_BONUS,
    });

    const { data: updated } = await db
      .from("user_credits")
      .select("base_used_month, bonus_minutes")
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({
      minutesAdded: REDEEMER_BONUS,
      minutesRemaining: updated ? calcRemaining(updated) : calcRemaining({ ...myRow, bonus_minutes: myRow.bonus_minutes + REDEEMER_BONUS }),
      message: `邀请码有效！已获得 ${REDEEMER_BONUS} 分钟，邀请者也获得了 ${REFERRER_BONUS} 分钟奖励`,
    });
  }

  // ── 4. Try redemption code ────────────────────────────────────────────────
  const { data: promoCode } = await db
    .from("redemption_codes")
    .select("*")
    .eq("code", code)
    .single();

  if (promoCode) {
    if (promoCode.uses_count >= promoCode.max_uses) {
      return NextResponse.json({ error: "该兑换码已达使用上限" }, { status: 400 });
    }
    if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date()) {
      return NextResponse.json({ error: "该兑换码已过期" }, { status: 400 });
    }

    // Add bonus to redeemer
    await db.from("user_credits").update({
      bonus_minutes: myRow.bonus_minutes + promoCode.minutes,
    }).eq("user_id", user.id);

    // Increment uses_count
    await db.from("redemption_codes").update({
      uses_count: promoCode.uses_count + 1,
    }).eq("code", code);

    // Log redemption
    await db.from("code_redemptions").insert({
      user_id: user.id,
      code,
      code_type: "redemption",
      minutes_added: promoCode.minutes,
    });

    const { data: updated } = await db
      .from("user_credits")
      .select("base_used_month, bonus_minutes")
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({
      minutesAdded: promoCode.minutes,
      minutesRemaining: updated ? calcRemaining(updated) : 0,
      message: `兑换成功！已获得 ${promoCode.minutes} 分钟`,
    });
  }

  // ── 5. Code not found ─────────────────────────────────────────────────────
  return NextResponse.json({ error: "无效的兑换码，请检查后重试" }, { status: 400 });
}

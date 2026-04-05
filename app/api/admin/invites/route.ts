/**
 * GET /api/admin/invites — invite chains and leaderboard
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

export async function GET(req: NextRequest) {
  if (req.headers.get("x-admin-secret") !== process.env.ADMIN_SECRET)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = serviceClient();

  // Get all redemptions where the code matched a referral_code (type=referral)
  const [{ data: redemptions }, { data: credits }, { data: { users } }] = await Promise.all([
    db.from("code_redemptions").select("*").order("redeemed_at", { ascending: false }),
    db.from("user_credits").select("user_id, referral_code, bonus_minutes"),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const emailMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.email]));
  const referralToUser = Object.fromEntries(
    (credits ?? []).map((c: Record<string, unknown>) => [c.referral_code, c.user_id])
  );

  // Build invite chains: for each redemption, find if the code is a referral code
  const inviteEvents = (redemptions ?? [])
    .filter((r: Record<string, unknown>) => referralToUser[r.code as string])
    .map((r: Record<string, unknown>) => ({
      inviterId:    referralToUser[r.code as string],
      inviterEmail: emailMap[referralToUser[r.code as string] as string] ?? "?",
      inviteeId:    r.user_id,
      inviteeEmail: emailMap[r.user_id as string] ?? "?",
      at:           r.redeemed_at,
      code:         r.code,
    }));

  // Leaderboard: count invites per inviter
  const countMap: Record<string, { email: string; count: number }> = {};
  inviteEvents.forEach((ev) => {
    if (!countMap[ev.inviterId]) countMap[ev.inviterId] = { email: ev.inviterEmail, count: 0 };
    countMap[ev.inviterId].count++;
  });
  const leaderboard = Object.entries(countMap)
    .map(([id, v]) => ({ id, email: v.email, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return NextResponse.json({ inviteEvents, leaderboard });
}

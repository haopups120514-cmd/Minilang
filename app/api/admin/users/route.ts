/**
 * GET  /api/admin/users — list all users with credits info
 * PATCH /api/admin/users — ban/unban a user { userId, isBanned }
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

function authCheck(req: NextRequest) {
  return req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;
}

export async function GET(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = serviceClient();

  // List all auth users
  const { data: { users }, error: authErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });

  // Get all user_credits rows
  const { data: credits } = await db.from("user_credits").select("*");
  const creditsMap = Object.fromEntries((credits ?? []).map((c: Record<string, unknown>) => [c.user_id, c]));

  const result = users.map((u) => {
    const c = creditsMap[u.id] as Record<string, unknown> | undefined;
    const baseUsed   = (c?.base_used_month  as number) ?? 0;
    const baseTotal  = (c?.base_total       as number) ?? 120;
    const bonus      = (c?.bonus_minutes    as number) ?? 0;
    const remaining  = Math.max(0, baseTotal - baseUsed) + bonus;
    return {
      id:           u.id,
      email:        u.email,
      createdAt:    u.created_at,
      lastSignIn:   u.last_sign_in_at,
      referralCode: c?.referral_code,
      remaining,
      isBanned:     c?.is_banned ?? false,
    };
  });

  return NextResponse.json({ users: result });
}

export async function PATCH(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, isBanned } = await req.json() as { userId: string; isBanned: boolean };
  const db = serviceClient();

  const { error } = await db
    .from("user_credits")
    .update({ is_banned: isBanned })
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

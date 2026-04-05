/**
 * GET  /api/announcements — get active unread announcements for current user
 * POST /api/announcements — mark announcement as read { id }
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

async function getUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const db = serviceClient();
  const { data: { user } } = await db.auth.getUser(token);
  return user;
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = serviceClient();

  // Get active announcements this user hasn't read yet
  const { data: readIds } = await db
    .from("announcement_reads")
    .select("announcement_id")
    .eq("user_id", user.id);

  const readSet = new Set((readIds ?? []).map((r: Record<string, unknown>) => r.announcement_id));

  const { data: announcements } = await db
    .from("announcements")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const unread = (announcements ?? []).filter((a: Record<string, unknown>) => !readSet.has(a.id));
  return NextResponse.json({ announcements: unread });
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json() as { id: string };
  const db = serviceClient();

  await db.from("announcement_reads").upsert({
    user_id: user.id,
    announcement_id: id,
  });

  return NextResponse.json({ ok: true });
}

/**
 * GET    /api/admin/announcements — list all announcements
 * POST   /api/admin/announcements — create announcement { title, content }
 * PATCH  /api/admin/announcements — toggle active { id, isActive }
 * DELETE /api/admin/announcements — delete { id }
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
  const { data, error } = await db
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ announcements: data });
}

export async function POST(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { title, content } = await req.json() as { title: string; content: string };
  if (!title?.trim() || !content?.trim())
    return NextResponse.json({ error: "title and content required" }, { status: 400 });

  const db = serviceClient();
  const { data, error } = await db
    .from("announcements")
    .insert({ title: title.trim(), content: content.trim() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ announcement: data });
}

export async function PATCH(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, isActive } = await req.json() as { id: string; isActive: boolean };
  const db = serviceClient();
  const { error } = await db
    .from("announcements")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await req.json() as { id: string };
  const db = serviceClient();
  const { error } = await db.from("announcements").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

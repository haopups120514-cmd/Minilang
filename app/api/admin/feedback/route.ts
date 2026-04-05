/**
 * GET   /api/admin/feedback — list all user feedback
 * PATCH /api/admin/feedback — update status { id, status: 'pending'|'resolved' }
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
    .from("user_feedback")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feedback: data });
}

export async function PATCH(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, status } = await req.json() as { id: string; status: string };
  const db = serviceClient();
  const { error } = await db
    .from("user_feedback")
    .update({ status })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

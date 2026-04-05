/**
 * GET  /api/profile — get current user's display name
 * PATCH /api/profile — update display name { displayName }
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
  const { data } = await db.from("user_credits").select("display_name").eq("user_id", user.id).single();
  return NextResponse.json({ displayName: (data as Record<string, unknown> | null)?.display_name ?? "" });
}

export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { displayName } = await req.json() as { displayName: string };
  const name = displayName?.trim().slice(0, 30);
  if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });

  const db = serviceClient();
  const { error } = await db
    .from("user_credits")
    .update({ display_name: name })
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, displayName: name });
}

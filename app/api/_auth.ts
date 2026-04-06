/**
 * Shared auth helper for API routes.
 * Returns the user if the Bearer token is valid, or null.
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function requireAuth(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { user: null, err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { user: null, err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  return { user, err: null };
}

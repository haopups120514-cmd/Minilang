/**
 * GET /api/admin/stats — dashboard statistics
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

  const [
    { count: totalSessions },
    { data: durationData },
    { data: todaySessions },
    { data: hourlySessions },
    { count: totalUsers },
    { count: totalFeedback },
  ] = await Promise.all([
    db.from("sessions").select("*", { count: "exact", head: true }),
    db.from("sessions").select("duration_secs").not("duration_secs", "is", null),
    db.from("sessions").select("user_id", { count: "exact" })
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    db.from("sessions").select("created_at")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true }),
    db.from("user_credits").select("*", { count: "exact", head: true }),
    db.from("user_feedback").select("*", { count: "exact", head: true }),
  ]);

  // Total transcription minutes
  const totalMins = Math.round(
    (durationData ?? []).reduce((acc: number, row: Record<string, unknown>) => acc + ((row.duration_secs as number) ?? 0), 0) / 60
  );

  // Unique active users today
  const todayUids = new Set((todaySessions ?? []).map((s: Record<string, unknown>) => s.user_id));

  // Hourly activity (last 24h, bucketed by hour)
  const hourBuckets: Record<number, number> = {};
  for (let i = 0; i < 24; i++) hourBuckets[i] = 0;
  (hourlySessions ?? []).forEach((s: Record<string, unknown>) => {
    const h = new Date(s.created_at as string).getHours();
    hourBuckets[h] = (hourBuckets[h] ?? 0) + 1;
  });
  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourBuckets[i] ?? 0,
  }));

  return NextResponse.json({
    totalSessions,
    totalMins,
    todayActiveUsers: todayUids.size,
    totalUsers,
    totalFeedback,
    hourlyData,
  });
}

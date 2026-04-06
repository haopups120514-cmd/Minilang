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
  const now   = Date.now();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const yesterday = new Date(new Date().setHours(0, 0, 0, 0) - 86400000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const twentyFourHAgo = new Date(now - 86400000).toISOString();

  const [
    { count: totalSessions },
    { data: durationData },
    { data: todaySessions },
    { data: yesterdaySessions },
    { data: hourlySessions },
    { data: dailySessions },
    { count: totalUsers },
    { data: newUsersToday },
    { count: totalFeedback },
    { data: allCredits },
  ] = await Promise.all([
    db.from("sessions").select("*", { count: "exact", head: true }),
    db.from("sessions").select("duration_secs").not("duration_secs", "is", null),
    db.from("sessions").select("user_id")
      .gte("created_at", today),
    db.from("sessions").select("user_id")
      .gte("created_at", yesterday).lt("created_at", today),
    db.from("sessions").select("created_at")
      .gte("created_at", twentyFourHAgo)
      .order("created_at", { ascending: true }),
    db.from("sessions").select("created_at")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: true }),
    db.from("user_credits").select("*", { count: "exact", head: true }),
    db.from("user_credits").select("user_id")
      .gte("created_at", today),
    db.from("user_feedback").select("*", { count: "exact", head: true }),
    db.from("user_credits").select("base_minutes,bonus_minutes,used_seconds,is_banned"),
  ]);

  // Total transcription minutes
  const totalMins = Math.round(
    (durationData ?? []).reduce((acc: number, row: Record<string, unknown>) =>
      acc + ((row.duration_secs as number) ?? 0), 0) / 60
  );

  // Avg session duration (minutes)
  const durRows = (durationData ?? []).filter((r: Record<string, unknown>) => (r.duration_secs as number) > 0);
  const avgDurationMins = durRows.length
    ? Math.round(durRows.reduce((a: number, r: Record<string, unknown>) => a + (r.duration_secs as number), 0) / durRows.length / 60)
    : 0;

  // Unique active users today vs yesterday
  const todayUids     = new Set((todaySessions ?? []).map((s: Record<string, unknown>) => s.user_id));
  const yesterdayUids = new Set((yesterdaySessions ?? []).map((s: Record<string, unknown>) => s.user_id));

  // Today's session count
  const todaySessionCount = (todaySessions ?? []).length;

  // New users today
  const newUsersTodayCount = (newUsersToday ?? []).length;

  // Users with credits remaining vs exhausted vs banned
  const credits = (allCredits ?? []) as Record<string, unknown>[];
  const usersActive   = credits.filter(c => !c.is_banned && ((c.base_minutes as number) + (c.bonus_minutes as number) - (c.used_seconds as number) / 60) > 0).length;
  const usersExhausted = credits.filter(c => !c.is_banned && ((c.base_minutes as number) + (c.bonus_minutes as number) - (c.used_seconds as number) / 60) <= 0).length;
  const usersBanned   = credits.filter(c => c.is_banned).length;

  // Hourly activity (last 24h)
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

  // Daily activity (last 7 days)
  const dayBuckets: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    dayBuckets[d.toISOString().slice(0, 10)] = 0;
  }
  (dailySessions ?? []).forEach((s: Record<string, unknown>) => {
    const day = (s.created_at as string).slice(0, 10);
    if (day in dayBuckets) dayBuckets[day] = (dayBuckets[day] ?? 0) + 1;
  });
  const dailyData = Object.entries(dayBuckets).map(([date, count]) => ({ date, count }));

  return NextResponse.json({
    totalSessions,
    totalMins,
    avgDurationMins,
    todayActiveUsers: todayUids.size,
    yesterdayActiveUsers: yesterdayUids.size,
    todaySessionCount,
    newUsersTodayCount,
    totalUsers,
    totalFeedback,
    usersActive,
    usersExhausted,
    usersBanned,
    hourlyData,
    dailyData,
  });
}

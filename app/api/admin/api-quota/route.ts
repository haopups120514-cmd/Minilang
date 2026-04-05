/**
 * GET /api/admin/api-quota — check API quota status
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

  const results: Record<string, unknown> = {};

  // ── DeepL usage ──
  const deeplKey = process.env.DEEPL_API_KEY;
  if (deeplKey) {
    try {
      const isFree = deeplKey.endsWith(":fx");
      const baseUrl = isFree ? "https://api-free.deepl.com" : "https://api.deepl.com";
      const r = await fetch(`${baseUrl}/v2/usage`, {
        headers: { Authorization: `DeepL-Auth-Key ${deeplKey}` },
      });
      if (r.ok) {
        const d = await r.json() as { character_count: number; character_limit: number };
        results.deepl = {
          used:  d.character_count,
          limit: d.character_limit,
          pct:   Math.round((d.character_count / d.character_limit) * 100),
        };
      } else {
        results.deepl = { error: `HTTP ${r.status}` };
      }
    } catch {
      results.deepl = { error: "fetch failed" };
    }
  } else {
    results.deepl = { error: "no key" };
  }

  // ── Groq: tracked in our api_usage table ──
  const db = serviceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: groqRows } = await db
    .from("api_usage")
    .select("count")
    .eq("api", "groq")
    .eq("date", today);
  const groqCount = (groqRows ?? []).reduce((s: number, r: Record<string, unknown>) => s + ((r.count as number) ?? 0), 0);
  results.groq = { todayRequests: groqCount };

  // ── Deepgram: check project balance via management API ──
  const dgKey = process.env.DEEPGRAM_API_KEY;
  if (dgKey) {
    try {
      const r = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${dgKey}` },
      });
      if (r.ok) {
        const d = await r.json() as { projects?: Array<{ project_id: string; name: string }> };
        const projectId = d.projects?.[0]?.project_id;
        if (projectId) {
          const br = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/balances`, {
            headers: { Authorization: `Token ${dgKey}` },
          });
          if (br.ok) {
            const bd = await br.json() as { balances?: Array<{ amount: number; units: string }> };
            results.deepgram = { balances: bd.balances ?? [] };
          } else {
            results.deepgram = { error: `balance HTTP ${br.status}` };
          }
        }
      } else {
        results.deepgram = { error: `HTTP ${r.status}` };
      }
    } catch {
      results.deepgram = { error: "fetch failed" };
    }
  } else {
    results.deepgram = { error: "no key" };
  }

  return NextResponse.json(results);
}

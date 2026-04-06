/**
 * /api/transcribe — Groq Whisper transcription endpoint.
 * Accepts multipart/form-data with:
 *   file     — audio blob (WebM/Opus)
 *   language — BCP-47 code (ja | en | zh)
 * Returns { text: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const WHISPER_LANG: Record<string, string> = { ja: "ja", en: "en", zh: "zh" };

export async function POST(req: NextRequest) {
  // Auth gate — require a valid Supabase session token
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ error: "No Groq key" }, { status: 500 });

  const form = await req.formData();
  const file = form.get("file") as Blob | null;
  const lang   = (form.get("language") as string | null) ?? "ja";
  const prompt = (form.get("prompt")   as string | null) ?? "";
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const whisperLang = WHISPER_LANG[lang] ?? lang;

  // Forward to Groq Whisper — use correct extension so Whisper infers format
  const fileType = (file as Blob).type || "audio/webm";
  const ext = fileType.includes("mp4") ? "m4a" : fileType.includes("ogg") ? "ogg" : "webm";
  const groqForm = new FormData();
  groqForm.append("file", file, `audio.${ext}`);
  groqForm.append("model", "whisper-large-v3-turbo");
  groqForm.append("language", whisperLang);
  groqForm.append("response_format", "json");
  if (prompt) groqForm.append("prompt", prompt);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[transcribe] Groq error:", err);
      return NextResponse.json({ text: "" });
    }
    const data = await res.json();
    return NextResponse.json({ text: data.text ?? "" });
  } catch (e) {
    console.error("[transcribe] fetch error:", e);
    return NextResponse.json({ text: "" });
  }
}

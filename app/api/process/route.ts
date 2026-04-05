/**
 * /api/process — correct ASR errors + translate in one call.
 *
 * Priority:
 *   1. Groq  (LPU inference, ~200-400ms) — if GROQ_API_KEY is set
 *   2. Gemini 2.0 Flash  (no-thinking, ~800ms)
 *   3. Gemini 2.0 Flash Lite (fastest Gemini, ~500ms)
 */
import { NextRequest, NextResponse } from "next/server";

const LANG_NAMES: Record<string, string> = {
  ja: "日语", en: "英语", zh: "中文",
};

const SYSTEM_PROMPT = `你是一名专业同声传译员。翻译规则：
1. 译文要像中文母语者自然说话，不要逐字对应
2. 补全口语省略的主语、宾语，让句子完整
3. 专有名词、学术术语保留英文原词，后可加括号说明
4. 遇到未完整的句子（教授停顿），翻译现有内容，语气词结尾用"……"
5. 只返回 JSON，不加任何解释`;

function buildGroqMessages(text: string, srcName: string, tgtName: string, context?: string, scene?: string, sceneHint?: string) {
  const systemContent = `你是一名专业同声传译员，将${srcName}翻译成${tgtName}。

【强制规则】
1. translated 字段必须是${tgtName}，绝对禁止输出英文或其他语言
2. 译文自然流畅，像母语者说话，不逐字对应
3. 补全口语省略的主语/宾语，让句子完整
4. 专有名词可保留原词，但句子主体必须是${tgtName}
5. 只返回 JSON，不加任何说明`;

  const sceneLine = scene ? `【场景】${scene}${sceneHint ? `：${sceneHint}` : ""}\n` : "";
  const ctx = context?.trim() ? `【前文】\n${context}\n` : "";
  const userContent = `${sceneLine}${ctx}【${srcName}原文】${text}\n\n返回格式：{"corrected":"纠正识别错误后的${srcName}原文","translated":"${tgtName}译文"}`;

  return [
    { role: "system", content: systemContent },
    { role: "user",   content: userContent },
  ];
}

function buildPrompt(text: string, srcName: string, tgtName: string, context?: string, scene?: string, sceneHint?: string) {
  const sceneLine = scene ? `当前场景：${scene}${sceneHint ? `（${sceneHint}）` : ""}\n\n` : "";
  const ctx = context?.trim() ? `前文参考：\n${context}\n\n` : "";
  return `${SYSTEM_PROMPT}\n\n${sceneLine}${ctx}当前${srcName}文本：${text}\n\n返回格式（仅JSON）：{"corrected":"...","translated":"..."}`;
}

function parseResult(raw: string, fallback: string) {
  try {
    const p = JSON.parse(raw) as { corrected?: string; translated?: string };
    return NextResponse.json({ corrected: p.corrected || fallback, translated: p.translated || "" });
  } catch {
    const tm = raw.match(/"translated"\s*:\s*"([^"]+)"/);
    const cm = raw.match(/"corrected"\s*:\s*"([^"]+)"/);
    if (tm) return NextResponse.json({ corrected: cm?.[1] || fallback, translated: tm[1] });
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { text, sourceLang, targetLang, context, scene, sceneHint } = await req.json();
  if (!text?.trim()) return NextResponse.json({ corrected: text ?? "", translated: "" });

  const srcName = LANG_NAMES[sourceLang] ?? sourceLang;
  const tgtName = LANG_NAMES[targetLang] ?? targetLang;

  // ── 1. Groq (LPU, fastest) ──────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: buildGroqMessages(text, srcName, tgtName, context, scene, sceneHint),
          temperature: 0.35,
          max_tokens: 512,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw: string = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (raw) {
          const result = parseResult(raw, text);
          if (result) return result;
        }
      }
    } catch { /* fall through to Gemini */ }
  }

  // ── 2. Gemini 2.0 Flash (non-thinking) ───────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ corrected: text, translated: "" });
  const prompt = buildPrompt(text, srcName, tgtName, context, scene, sceneHint);

  for (const model of ["gemini-2.0-flash", "gemini-2.0-flash-lite"]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 512,
              responseMimeType: "application/json",
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ],
          }),
        }
      );
      if (!res.ok) { if (res.status === 429) await new Promise(r => setTimeout(r, 3000)); continue; }
      const data = await res.json();
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      if (!raw) continue;
      const result = parseResult(raw, text);
      if (result) return result;
    } catch { continue; }
  }

  return NextResponse.json({ corrected: text, translated: "" });
}

import { NextRequest, NextResponse } from "next/server";

const LANG_NAME: Record<string, string> = {
  JA: "日语", EN: "英语", "EN-US": "英语", "EN-GB": "英语",
  ZH: "中文", "ZH-HANS": "中文",
  ja: "日语", en: "英语", zh: "中文",
};

function buildSystemPrompt(srcName: string, tgtName: string, context: string): string {
  const ctx = context.trim()
    ? `\n\n前文（仅供参考，保持术语一致）：\n${context}`
    : "";
  return `你是一名专业的课堂同声传译员，负责将${srcName}实时翻译成${tgtName}。

翻译原则：
- 以中国大学生能轻松理解的方式表达，避免逐字死译
- 口语化的原文译成自然的口语中文；专业术语保持准确
- 短句直接翻译，长句适当拆分以保持流畅
- 不添加任何解释、注释或前缀，只输出译文${ctx}`;
}

export async function POST(req: NextRequest) {
  const { text, sourceLang, targetLang, context } = await req.json();
  if (!text?.trim()) return NextResponse.json({ translatedText: "" });

  const srcName = LANG_NAME[sourceLang] ?? sourceLang;
  const tgtName = LANG_NAME[targetLang] ?? targetLang;

  // ── 1. Groq LLaMA (primary) ─────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: buildSystemPrompt(srcName, tgtName, context ?? "") },
            { role: "user", content: text },
          ],
          temperature: 0.15,
          max_tokens: 300,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const translated: string = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (translated) return NextResponse.json({ translatedText: translated });
      }
    } catch { /* fall through to DeepL */ }
  }

  // ── 2. DeepL (fallback) ─────────────────────────────────────────────────
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return NextResponse.json({ translatedText: "" });

  const endpoint = apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: [text], source_lang: sourceLang, target_lang: targetLang }),
    });
    if (!res.ok) return NextResponse.json({ translatedText: "" });
    const data = await res.json();
    return NextResponse.json({ translatedText: data.translations?.[0]?.text ?? "" });
  } catch {
    return NextResponse.json({ translatedText: "" });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../_auth";

const LANG_NAMES: Record<string, string> = {
  ja: "日语",
  en: "英语",
  zh: "中文",
};

const PROMPT = (langName: string, transcript: string) =>
  `你是一名专业的课堂笔记助手。请根据以下${langName}课堂转写内容，生成结构清晰、内容完整的课堂笔记。

输出格式要求（使用 Markdown，不要用代码块包裹）：

## 📚 主要话题
- 列出本节课涉及的核心主题

## 🔑 重点词汇
- **词汇** — 释义（如是外语词汇请同时给出中文解释）

## 💡 知识要点
1. 重要概念和知识点，要有足够细节以便复习

## 📝 课堂小结
用 2-3 句话概括本节课的主要内容。

---
转写内容：
${transcript}`;

// ── Groq ─────────────────────────────────────────────────────────────────────
async function callGroq(prompt: string) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string | undefined) ?? null;
}

// ── Gemini fallback ───────────────────────────────────────────────────────────
async function callGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ],
          }),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (text.trim()) return text;
    } catch { continue; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { err } = await requireAuth(req);
  if (err) return err;
  const { transcript, language } = await req.json();

  if (!transcript?.trim()) {
    return NextResponse.json({ summary: "暂无转写内容，无法生成笔记。" });
  }

  const prompt = PROMPT(LANG_NAMES[language] ?? language, transcript);
  const isLong = transcript.length >= 5000;

  function clean(s: string) {
    return s.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }

  if (isLong) {
    // Long transcript: Gemini first (1M token context), Groq fallback
    const geminiResult = await callGemini(prompt);
    if (geminiResult?.trim()) return NextResponse.json({ summary: clean(geminiResult) });
    const groqResult = await callGroq(prompt);
    if (groqResult?.trim()) return NextResponse.json({ summary: clean(groqResult) });
  } else {
    // Short transcript: Groq first (faster), Gemini fallback
    const groqResult = await callGroq(prompt);
    if (groqResult?.trim()) return NextResponse.json({ summary: clean(groqResult) });
    const geminiResult = await callGemini(prompt);
    if (geminiResult?.trim()) return NextResponse.json({ summary: clean(geminiResult) });
  }

  return NextResponse.json({ summary: "笔记生成失败，请稍后重试。" });
}

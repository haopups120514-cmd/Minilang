import { NextRequest, NextResponse } from "next/server";

const LANG_NAMES: Record<string, string> = {
  ja: "日语",
  en: "英语",
  zh: "中文",
};

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"];

async function callGemini(model: string, prompt: string, apiKey: string) {
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
  return res;
}

export async function POST(req: NextRequest) {
  const { transcript, language } = await req.json();

  if (!transcript?.trim()) {
    return NextResponse.json({ summary: "暂无转写内容，无法生成笔记。" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "缺少 GEMINI_API_KEY" }, { status: 500 });
  }

  const langName = LANG_NAMES[language] ?? language;

  const prompt = `你是一名专业的课堂笔记助手。请根据以下${langName}课堂转写内容，生成结构清晰、内容完整的课堂笔记。

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

  let hitRateLimit = false;

  for (const model of MODELS) {
    try {
      let res = await callGemini(model, prompt, apiKey);

      // If rate-limited, wait 20 s and retry once with the same model
      if (res.status === 429) {
        hitRateLimit = true;
        await new Promise((r) => setTimeout(r, 20_000));
        res = await callGemini(model, prompt, apiKey);
      }

      if (!res.ok) {
        console.error(`Gemini [${model}] ${res.status}`);
        continue;
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      if (!candidate) continue;

      const text: string = candidate.content?.parts?.[0]?.text ?? "";
      if (!text.trim()) continue;

      const cleaned = text
        .replace(/^```(?:markdown)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();

      return NextResponse.json({ summary: cleaned });
    } catch (e) {
      console.error(`Gemini [${model}] exception:`, e);
    }
  }

  const hint = hitRateLimit
    ? "免费版 Gemini 每分钟请求数已用完，请稍等 1 分钟后重试。\n如需长期使用，建议在 Google Cloud 开启计费以提升配额。"
    : "所有模型均请求失败，请检查 GEMINI_API_KEY 是否有效。";

  return NextResponse.json({ summary: hint });
}

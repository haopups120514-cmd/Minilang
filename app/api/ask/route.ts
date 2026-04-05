import { NextRequest, NextResponse } from "next/server";

const LANG_NAMES: Record<string, string> = {
  ja: "日语",
  en: "英语",
  zh: "中文",
};

const PROMPT = (langName: string, transcript: string, question: string) =>
  `你是一名课堂助手，请根据以下${langName}课堂转写内容，回答学生的问题。
回答要求：简洁明确，基于课堂内容，如果内容中没有相关信息请如实说明。不超过300字。

课堂转写内容：
${transcript}

学生问题：${question}

请用中文回答：`;

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
      max_tokens: 1024,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string | undefined) ?? null;
}

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
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
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
  const { transcript, question, language } = await req.json();

  if (!transcript?.trim()) {
    return NextResponse.json({ answer: "暂无课堂内容可供提问。" });
  }
  if (!question?.trim()) {
    return NextResponse.json({ answer: "请输入问题。" });
  }

  const prompt = PROMPT(LANG_NAMES[language] ?? language, transcript, question);

  const groqResult = await callGroq(prompt);
  if (groqResult?.trim()) return NextResponse.json({ answer: groqResult.trim() });

  const geminiResult = await callGemini(prompt);
  if (geminiResult?.trim()) return NextResponse.json({ answer: geminiResult.trim() });

  return NextResponse.json({ answer: "暂时无法回答，请稍后重试。" });
}

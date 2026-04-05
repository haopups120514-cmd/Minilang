/**
 * /api/detect-scene — infer usage scenario from first few transcripts
 * Returns { scene: string, hint: string } via Groq.
 */
import { NextRequest, NextResponse } from "next/server";

const SCENES = ["大学课堂", "商务会议", "医疗问诊", "日常对话", "其他"];

export async function POST(req: NextRequest) {
  const { texts } = await req.json() as { texts: string[] };
  if (!texts?.length) return NextResponse.json({ scene: "", hint: "" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ scene: "", hint: "" });

  const sample = texts.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `以下是用户的语音识别文本片段：
${sample}

请判断这最可能是哪种使用场景，从以下选项选择一个：${SCENES.join("、")}

同时给出一句简短的翻译提示（说明说话风格、术语特点），帮助翻译员改善翻译质量。

只返回 JSON，不加说明：
{"scene":"场景名称","hint":"翻译提示，例如：说话者为教授，多用学术术语，翻译时保持正式语气"}`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 128,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return NextResponse.json({ scene: "", hint: "" });
    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { scene?: string; hint?: string };
    return NextResponse.json({
      scene: parsed.scene ?? "",
      hint:  parsed.hint  ?? "",
    });
  } catch {
    return NextResponse.json({ scene: "", hint: "" });
  }
}

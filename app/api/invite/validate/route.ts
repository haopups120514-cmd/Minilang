/**
 * POST /api/invite/validate
 * Body: { code: string }   ← 6-digit TOTP from Google Authenticator
 * Returns: { valid: boolean, error?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { verify } from "otplib/functional";

export async function POST(req: NextRequest) {
  const secret = process.env.TOTP_SECRET;
  if (!secret) return NextResponse.json({ valid: false, error: "服务器未配置验证" }, { status: 500 });

  const { code } = await req.json() as { code: string };
  const trimmed = code?.trim().replace(/\s/g, "");
  if (!trimmed || trimmed.length !== 6) {
    return NextResponse.json({ valid: false, error: "请输入 6 位验证码" });
  }

  try {
    const result = await verify({ secret, token: trimmed, strategy: "totp", epochTolerance: 30 });
    if (!result.valid) return NextResponse.json({ valid: false, error: "验证码错误或已过期" });
    return NextResponse.json({ valid: true });
  } catch {
    return NextResponse.json({ valid: false, error: "验证失败" });
  }
}

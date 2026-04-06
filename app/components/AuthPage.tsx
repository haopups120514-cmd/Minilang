"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

type View = "login" | "register" | "forgot";

export default function AuthPage() {
  const [tab,        setTab]        = useState<"login" | "register">("login");
  const [view,       setView]       = useState<View>("login");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [notice,     setNotice]     = useState("");

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      if (view === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) setError(error.message);
        else setNotice("已发送！请检查邮箱中的重置链接。");
      } else if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
      } else {
        // ── Register: validate invite code first ──────────────────────────
        const valRes = await fetch("/api/invite/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode }),
        });
        const { valid, error: codeErr } = await valRes.json() as { valid: boolean; error?: string };
        if (!valid) { setError(codeErr ?? "邀请码无效"); return; }

        // Sign up
        const { error: signUpErr } = await supabase.auth.signUp({ email, password });
        if (signUpErr) { setError(signUpErr.message); return; }
        setNotice("注册成功！欢迎使用 Mimilang。");
      }
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (t: "login" | "register") => {
    setTab(t); setView(t); setError(""); setNotice(""); setInviteCode("");
  };

  return (
    <div className="flex h-screen bg-[var(--c-bg)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <div className="w-[34px] h-[34px] rounded-[9px] bg-[#0071e3] flex items-center justify-center shrink-0">
              <svg width="18" height="14" viewBox="0 0 18 14" fill="white">
                <rect x="0"    y="10" width="2.5" height="4"  rx="1.25"/>
                <rect x="3.75" y="5"  width="2.5" height="9"  rx="1.25"/>
                <rect x="7.5"  y="0"  width="2.5" height="14" rx="1.25"/>
                <rect x="11.25" y="5" width="2.5" height="9"  rx="1.25"/>
                <rect x="15"   y="10" width="2.5" height="4"  rx="1.25"/>
              </svg>
            </div>
            <span className="text-[22px] font-semibold text-white" style={{ letterSpacing: "-0.5px" }}>Mimilang</span>
          </div>
          <p className="text-slate-500 text-sm">实时课堂转录与翻译</p>
        </div>

        {/* Card */}
        <div className="bg-[#161b22] border border-white/8 rounded-2xl p-6">
          {/* Tabs (hidden in forgot view) */}
          {view !== "forgot" && (
            <div className="flex bg-[var(--c-bg)] rounded-xl p-1 mb-6">
              {(["login", "register"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t ? "bg-[#0071e3] text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t === "login" ? "登录" : "注册"}
                </button>
              ))}
            </div>
          )}

          {/* Forgot header */}
          {view === "forgot" && (
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() => { setView("login"); setError(""); setNotice(""); }}
                className="text-slate-500 hover:text-slate-200 text-lg leading-none"
              >←</button>
              <span className="text-sm font-medium text-slate-300">重置密码</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handle} className="space-y-3">
            <input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-[var(--c-bg)] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3] transition-colors"
            />
            {view !== "forgot" && (
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[var(--c-bg)] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3] transition-colors"
              />
            )}

            {/* TOTP — only shown during registration */}
            {tab === "register" && view === "register" && (
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Google Authenticator 验证码"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  maxLength={6}
                  className="w-full bg-[var(--c-bg)] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3] transition-colors font-mono tracking-[0.3em] text-center"
                />
                <p className="mt-1.5 text-[11px] text-slate-600 text-center">联系管理员获取当前 6 位验证码</p>
              </div>
            )}

            {error  && <p className="text-red-400 text-xs">{error}</p>}
            {notice && <p className="text-emerald-400 text-xs">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              {loading ? "请稍候…" : view === "forgot" ? "发送重置链接" : tab === "login" ? "登录" : "注册"}
            </button>

            {view === "login" && (
              <button
                type="button"
                onClick={() => { setView("forgot"); setError(""); setNotice(""); }}
                className="w-full text-center text-xs text-slate-600 hover:text-slate-400 transition-colors pt-1"
              >
                忘记密码？
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

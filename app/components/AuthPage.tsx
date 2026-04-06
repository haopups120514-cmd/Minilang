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
  const [showPw,     setShowPw]     = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwFocus,    setPwFocus]    = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setNotice(""); setLoading(true);
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
        const valRes = await fetch("/api/invite/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode }),
        });
        const { valid, error: codeErr } = await valRes.json() as { valid: boolean; error?: string };
        if (!valid) { setError(codeErr ?? "邀请码无效"); return; }
        const { error: signUpErr } = await supabase.auth.signUp({ email, password });
        if (signUpErr) { setError(signUpErr.message); return; }
        setNotice("注册成功！欢迎使用 Mimilang。");
      }
    } finally { setLoading(false); }
  };

  const switchTab = (t: "login" | "register") => {
    setTab(t); setView(t); setError(""); setNotice(""); setInviteCode("");
  };

  return (
    <div className="flex items-center justify-center h-screen overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 70% 60% at 20% 20%, rgba(168,139,250,0.28) 0%, transparent 55%)," +
          "radial-gradient(ellipse 60% 55% at 80% 80%, rgba(125,211,252,0.22) 0%, transparent 55%)," +
          "radial-gradient(ellipse 50% 50% at 60% 10%, rgba(110,231,183,0.18) 0%, transparent 55%)," +
          "var(--c-bg)",
      }}>

      <div className="w-full max-w-[360px] px-4"
        style={{
          background: "rgba(255,255,255,0.07)",
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 28,
          padding: "40px 36px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
        }}>

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ background: "var(--ai-gradient)" }}>
            <span className="text-white text-xl font-bold tracking-tight">M</span>
          </div>
          <h1 className="text-[22px] font-semibold" style={{ color: "var(--c-text)", letterSpacing: "-0.4px" }}>
            {view === "forgot" ? "重置密码" : tab === "login" ? "欢迎回来" : "创建账号"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--c-text-2)" }}>
            {view === "forgot"
              ? "输入邮箱，我们发送重置链接"
              : tab === "login"
              ? "登录以继续使用 Mimilang"
              : "需要验证码才能注册"}
          </p>
        </div>

        {/* Tabs */}
        {view !== "forgot" && (
          <div className="flex gap-0 mb-6 border-b" style={{ borderColor: "var(--c-border)" }}>
            {(["login", "register"] as const).map(t => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className="pb-2.5 px-1 mr-5 text-sm font-medium relative transition-colors"
                style={{ color: tab === t ? "var(--c-text)" : "var(--c-text-2)" }}
              >
                {t === "login" ? "登录" : "注册"}
                {tab === t && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                    style={{ background: "var(--ai-gradient)" }}/>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Forgot back */}
        {view === "forgot" && (
          <button
            onClick={() => { setView("login"); setError(""); setNotice(""); }}
            className="flex items-center gap-1.5 text-sm mb-6 transition-colors"
            style={{ color: "var(--c-text-2)" }}
          >
            ← 返回登录
          </button>
        )}

        {/* Form */}
        <form onSubmit={handle} className="space-y-3">
          <input
            type="email"
            placeholder="邮箱地址"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={() => setEmailFocus(true)}
            onBlur={() => setEmailFocus(false)}
            required
            className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
            style={{
              background: "var(--c-surface)",
              border: `1px solid ${emailFocus ? "#a78bfa" : "var(--c-border-m)"}`,
              color: "var(--c-text)",
              boxShadow: emailFocus ? "0 0 0 3px rgba(167,139,250,0.12)" : "none",
            }}
          />

          {view !== "forgot" && (
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                placeholder="密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setPwFocus(true)}
                onBlur={() => setPwFocus(false)}
                required minLength={6}
                className="w-full rounded-xl px-4 py-2.5 pr-10 text-sm outline-none transition-all"
                style={{
                  background: "var(--c-surface)",
                  border: `1px solid ${pwFocus ? "#a78bfa" : "var(--c-border-m)"}`,
                  color: "var(--c-text)",
                  boxShadow: pwFocus ? "0 0 0 3px rgba(167,139,250,0.12)" : "none",
                }}
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: "var(--c-text-2)" }}
              >
                {showPw ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          )}

          {tab === "register" && view === "register" && (
            <div>
              <input
                type="text" inputMode="numeric"
                placeholder="Google Authenticator 验证码"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required maxLength={6}
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono tracking-[0.3em] text-center"
                style={{ background: "var(--c-surface)", border: "1px solid var(--c-border-m)", color: "var(--c-text)" }}
              />
              <p className="mt-1.5 text-[11px] text-center" style={{ color: "var(--c-text-2)" }}>
                联系管理员获取当前 6 位验证码
              </p>
            </div>
          )}

          {error  && <p className="text-red-400 text-xs">{error}</p>}
          {notice && <p className="text-emerald-500 text-xs">{notice}</p>}

          <button type="submit" disabled={loading}
            className="w-full text-white text-sm font-medium py-2.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            style={{
              background: "var(--ai-gradient)",
              boxShadow: "0 0 16px rgba(167,139,250,0.22), 0 4px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
          >
            {loading ? "请稍候…" : view === "forgot" ? "发送重置链接" : tab === "login" ? "登录" : "注册"}
          </button>

          {view === "login" && (
            <button type="button"
              onClick={() => { setView("forgot"); setError(""); setNotice(""); }}
              className="w-full text-center text-xs pt-1 transition-colors"
              style={{ color: "var(--c-text-2)" }}
            >
              忘记密码？
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

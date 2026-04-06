"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

type View = "login" | "register" | "forgot";

// ── Pupil offset from mouse position ─────────────────────────────────────
function getPupilOffset(
  el: HTMLDivElement | null,
  mx: number,
  my: number,
  max: number
): { x: number; y: number } {
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const angle = Math.atan2(my - cy, mx - cx);
  const dist = Math.min(max, Math.hypot(mx - cx, my - cy) / 12);
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

// ── Eye ───────────────────────────────────────────────────────────────────
function Eye({
  eRef, px, py, blinking, size,
}: {
  eRef: React.RefObject<HTMLDivElement | null>;
  px: number; py: number; blinking: boolean; size: number;
}) {
  return (
    <div
      ref={eRef}
      style={{
        width: size,
        height: blinking ? 2.5 : size,
        borderRadius: blinking ? 2 : size / 2,
        backgroundColor: "white",
        position: "relative",
        overflow: "hidden",
        transition: "height 0.07s ease, border-radius 0.07s ease",
        flexShrink: 0,
        boxShadow: "inset 0 1px 4px rgba(0,0,0,0.14)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: size * 0.52,
          height: size * 0.52,
          borderRadius: "50%",
          backgroundColor: "#160e2a",
          top: "50%",
          left: "50%",
          transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
          transition: "transform 0.06s ease-out",
          opacity: blinking ? 0 : 1,
        }}
      />
    </div>
  );
}

// ── Glass Orb Character ───────────────────────────────────────────────────
function Orb({
  w, h, grad, eyeSize = 15, eyeGap = 18,
  mx, my, fixedPupil, maxDist = 4.5,
}: {
  w: number; h: number; grad: string;
  eyeSize?: number; eyeGap?: number;
  mx: number; my: number;
  fixedPupil?: { x: number; y: number } | null;
  maxDist?: number;
}) {
  const e1 = useRef<HTMLDivElement>(null);
  const e2 = useRef<HTMLDivElement>(null);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    function tick() {
      t = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => { setBlinking(false); tick(); }, 130);
      }, 3000 + Math.random() * 5000);
    }
    // Stagger initial blink so they don't all blink together
    const init = setTimeout(tick, Math.random() * 2000);
    return () => { clearTimeout(t); clearTimeout(init); };
  }, []);

  const p1 = fixedPupil ?? getPupilOffset(e1.current, mx, my, maxDist);
  const p2 = fixedPupil ?? getPupilOffset(e2.current, mx, my, maxDist);
  const br = Math.min(w, h) * 0.44;

  return (
    <div style={{
      width: w, height: h, borderRadius: br,
      background: grad,
      boxShadow: "0 12px 40px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.38), inset 0 -1px 0 rgba(0,0,0,0.10)",
      position: "relative", flexShrink: 0,
    }}>
      {/* Glass sheen */}
      <div style={{
        position: "absolute", top: "7%", left: "13%", right: "13%", height: "38%",
        borderRadius: br,
        background: "linear-gradient(180deg, rgba(255,255,255,0.32) 0%, transparent 100%)",
        pointerEvents: "none",
      }} />
      {/* Eyes */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: eyeGap,
      }}>
        <Eye eRef={e1} px={p1.x} py={p1.y} blinking={blinking} size={eyeSize} />
        <Eye eRef={e2} px={p2.x} py={p2.y} blinking={blinking} size={eyeSize} />
      </div>
    </div>
  );
}

// ── Main AuthPage ─────────────────────────────────────────────────────────
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

  const [mx, setMx] = useState(0);
  const [my, setMy] = useState(0);
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwFocus,    setPwFocus]    = useState(false);

  useEffect(() => {
    const h = (e: MouseEvent) => { setMx(e.clientX); setMy(e.clientY); };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

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

  // Pupil overrides
  const lookAway   = pwFocus && !showPw ? { x: 0, y: 5 }  : null; // look down
  const lookLeft   = emailFocus         ? { x: -4.5, y: 0 } : null;
  const lookRight  = emailFocus         ? { x: 4.5,  y: 0 } : null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--c-bg)" }}>

      {/* ── Left: character panel ── */}
      <div
        className="hidden lg:flex flex-col items-center justify-center flex-1 relative select-none"
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 15% 25%, rgba(168,139,250,0.28) 0%, transparent 58%)," +
            "radial-gradient(ellipse 60% 55% at 85% 75%, rgba(110,231,183,0.20) 0%, transparent 55%)," +
            "radial-gradient(ellipse 50% 45% at 70% 15%, rgba(125,211,252,0.16) 0%, transparent 55%)," +
            "#08081a",
        }}
      >
        {/* Greeting */}
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-[8px] flex items-center justify-center"
              style={{ background: "var(--ai-gradient)" }}>
              <svg width="16" height="12" viewBox="0 0 18 14" fill="white">
                <rect x="0"     y="10" width="2.5" height="4"  rx="1.25"/>
                <rect x="3.75"  y="5"  width="2.5" height="9"  rx="1.25"/>
                <rect x="7.5"   y="0"  width="2.5" height="14" rx="1.25"/>
                <rect x="11.25" y="5"  width="2.5" height="9"  rx="1.25"/>
                <rect x="15"    y="10" width="2.5" height="4"  rx="1.25"/>
              </svg>
            </div>
            <span className="text-white/90 text-lg font-semibold tracking-tight">Mimilang</span>
          </div>
          <p className="text-white/35 text-xs tracking-[0.18em] uppercase">实时课堂转录 · 翻译</p>
        </div>

        {/* Three glass orbs */}
        <div className="flex items-end gap-7">
          {/* Lavender — tall pill */}
          <Orb
            w={66} h={118}
            grad="linear-gradient(155deg, #ddd6fe 0%, #a78bfa 55%, #7c3aed 100%)"
            eyeSize={15} eyeGap={19}
            mx={mx} my={my}
            fixedPupil={lookAway ?? lookRight}
            maxDist={4.5}
          />
          {/* Sky blue — wide oval */}
          <Orb
            w={94} h={82}
            grad="linear-gradient(155deg, #e0f2fe 0%, #7dd3fc 50%, #0ea5e9 100%)"
            eyeSize={17} eyeGap={25}
            mx={mx} my={my}
            fixedPupil={lookAway}
            maxDist={5.5}
          />
          {/* Mint — rounded square */}
          <Orb
            w={64} h={74}
            grad="linear-gradient(155deg, #ccfbf1 0%, #6ee7b7 50%, #10b981 100%)"
            eyeSize={14} eyeGap={17}
            mx={mx} my={my}
            fixedPupil={lookAway ?? lookLeft}
            maxDist={4}
          />
        </div>

        {/* Hint */}
        <p className="text-white/20 text-[11px] mt-14 tracking-widest select-none">
          {pwFocus && !showPw ? "我们不偷看 👀" : emailFocus ? "你好，请登录！" : "我们在看着你"}
        </p>
      </div>

      {/* ── Right: login form ── */}
      <div className="flex flex-col items-center justify-center flex-1 px-6"
        style={{ background: "var(--c-bg)" }}>
        <div className="w-full max-w-[340px]">

          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex items-center justify-center gap-2.5 mb-2">
              <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center"
                style={{ background: "var(--ai-gradient)" }}>
                <svg width="18" height="14" viewBox="0 0 18 14" fill="white">
                  <rect x="0"     y="10" width="2.5" height="4"  rx="1.25"/>
                  <rect x="3.75"  y="5"  width="2.5" height="9"  rx="1.25"/>
                  <rect x="7.5"   y="0"  width="2.5" height="14" rx="1.25"/>
                  <rect x="11.25" y="5"  width="2.5" height="9"  rx="1.25"/>
                  <rect x="15"    y="10" width="2.5" height="4"  rx="1.25"/>
                </svg>
              </div>
              <span className="text-xl font-semibold" style={{ color: "var(--c-text)", letterSpacing: "-0.4px" }}>
                Mimilang
              </span>
            </div>
            <p className="text-sm" style={{ color: "var(--c-text-2)" }}>实时课堂转录与翻译</p>
          </div>

          {/* Desktop heading */}
          <div className="hidden lg:block mb-7">
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
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: "var(--ai-gradient)" }}
                    />
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
                  required
                  minLength={6}
                  className="w-full rounded-xl px-4 py-2.5 pr-10 text-sm outline-none transition-all"
                  style={{
                    background: "var(--c-surface)",
                    border: `1px solid ${pwFocus ? "#a78bfa" : "var(--c-border-m)"}`,
                    color: "var(--c-text)",
                    boxShadow: pwFocus ? "0 0 0 3px rgba(167,139,250,0.12)" : "none",
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
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
                  type="text"
                  inputMode="numeric"
                  placeholder="Google Authenticator 验证码"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  maxLength={6}
                  className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition-all font-mono tracking-[0.3em] text-center"
                  style={{
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-border-m)",
                    color: "var(--c-text)",
                  }}
                />
                <p className="mt-1.5 text-[11px] text-center" style={{ color: "var(--c-text-2)" }}>
                  联系管理员获取当前 6 位验证码
                </p>
              </div>
            )}

            {error  && <p className="text-red-400 text-xs">{error}</p>}
            {notice && <p className="text-emerald-500 text-xs">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-white text-sm font-medium py-2.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              style={{
                background: "var(--ai-gradient)",
                boxShadow: "0 0 16px rgba(167,139,250,0.22), 0 4px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.25)",
              }}
            >
              {loading ? "请稍候…" : view === "forgot" ? "发送重置链接" : tab === "login" ? "登录" : "注册"}
            </button>

            {view === "login" && (
              <button
                type="button"
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
    </div>
  );
}

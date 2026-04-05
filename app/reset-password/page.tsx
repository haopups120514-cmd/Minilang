"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);
  const [ready,    setReady]    = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("两次密码不一致"); return; }
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setError(error.message);
      else {
        setDone(true);
        setTimeout(() => { window.location.href = "/"; }, 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[var(--c-bg)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <div className="w-[34px] h-[34px] rounded-[9px] bg-indigo-600 flex items-center justify-center shrink-0">
              <svg width="18" height="14" viewBox="0 0 18 14" fill="white">
                <rect x="0"     y="10" width="2.5" height="4"  rx="1.25"/>
                <rect x="3.75"  y="5"  width="2.5" height="9"  rx="1.25"/>
                <rect x="7.5"   y="0"  width="2.5" height="14" rx="1.25"/>
                <rect x="11.25" y="5"  width="2.5" height="9"  rx="1.25"/>
                <rect x="15"    y="10" width="2.5" height="4"  rx="1.25"/>
              </svg>
            </div>
            <span className="text-[22px] font-semibold text-white" style={{ letterSpacing: "-0.5px" }}>Mimilang</span>
          </div>
          <p className="text-slate-500 text-sm">重置密码</p>
        </div>
        <div className="bg-[var(--c-surface)] border border-white/8 rounded-2xl p-6">
          {done ? (
            <p className="text-emerald-400 text-sm text-center">密码已更新！正在跳转…</p>
          ) : !ready ? (
            <p className="text-slate-500 text-sm text-center">正在验证链接…</p>
          ) : (
            <form onSubmit={handle} className="space-y-3">
              <input
                type="password"
                placeholder="新密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[var(--c-bg)] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <input
                type="password"
                placeholder="确认新密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[var(--c-bg)] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
              >
                {loading ? "请稍候…" : "更新密码"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

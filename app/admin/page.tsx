"use client";

import { useState, useEffect, useCallback } from "react";

interface RedemptionCode {
  code: string;
  minutes: number;
  max_uses: number;
  uses_count: number;
  expires_at: string | null;
  note: string | null;
  created_at: string;
}

export default function AdminPage() {
  const [secret,    setSecret]    = useState("");
  const [authed,    setAuthed]    = useState(false);
  const [codes,     setCodes]     = useState<RedemptionCode[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [copied,    setCopied]    = useState<string>("");

  // Create form
  const [formCode,    setFormCode]    = useState("");
  const [formMins,    setFormMins]    = useState("60");
  const [formUses,    setFormUses]    = useState("1");
  const [formExpires, setFormExpires] = useState("");
  const [formNote,    setFormNote]    = useState("");
  const [creating,    setCreating]    = useState(false);
  const [createMsg,   setCreateMsg]   = useState("");

  const fetchCodes = useCallback(async (s: string) => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/codes", { headers: { "x-admin-secret": s } });
    if (res.status === 403) { setError("密码错误"); setLoading(false); return false; }
    const { codes: data } = await res.json();
    setCodes(data ?? []);
    setLoading(false);
    return true;
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await fetchCodes(secret);
    if (ok) setAuthed(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateMsg("");
    const res = await fetch("/api/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({
        code:      formCode.trim().toUpperCase() || undefined,
        minutes:   parseInt(formMins),
        maxUses:   parseInt(formUses),
        expiresAt: formExpires || undefined,
        note:      formNote || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setCreateMsg(`❌ ${data.error}`); }
    else {
      setCreateMsg(`✓ 已创建：${data.code.code}`);
      setFormCode(""); setFormMins("60"); setFormUses("1");
      setFormExpires(""); setFormNote("");
      fetchCodes(secret);
    }
    setCreating(false);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(""), 1500);
    });
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-[#161b22] border border-white/8 rounded-2xl p-6">
          <div className="text-center mb-6">
            <p className="text-lg font-semibold text-white">Mimilang 管理后台</p>
            <p className="text-xs text-slate-500 mt-1">请输入管理员密码</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password"
              placeholder="ADMIN_SECRET"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              className="w-full bg-[#0d1117] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              {loading ? "验证中…" : "登录"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200 px-4 py-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-white">兑换码管理</h1>
            <p className="text-xs text-slate-500 mt-0.5">Mimilang 管理后台</p>
          </div>
          <button
            onClick={() => { setAuthed(false); setSecret(""); setCodes([]); }}
            className="text-xs text-slate-600 hover:text-slate-300 px-3 py-1.5 rounded-lg border border-white/8 hover:border-white/15 transition-colors"
          >
            退出
          </button>
        </div>

        {/* Create code form */}
        <div className="bg-[#161b22] border border-white/8 rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">创建新兑换码</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">自定义码（留空随机生成）</label>
                <input
                  type="text"
                  placeholder="如 PROMO2025"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  maxLength={20}
                  className="w-full bg-[#0d1117] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">分钟数</label>
                <input
                  type="number"
                  min="1"
                  max="9999"
                  value={formMins}
                  onChange={(e) => setFormMins(e.target.value)}
                  required
                  className="w-full bg-[#0d1117] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">最多使用次数</label>
                <input
                  type="number"
                  min="1"
                  max="99999"
                  value={formUses}
                  onChange={(e) => setFormUses(e.target.value)}
                  required
                  className="w-full bg-[#0d1117] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">到期时间（可选）</label>
                <input
                  type="datetime-local"
                  value={formExpires}
                  onChange={(e) => setFormExpires(e.target.value)}
                  className="w-full bg-[#0d1117] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">备注（内部用）</label>
              <input
                type="text"
                placeholder="如：2025新年活动"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                className="w-full bg-[#0d1117] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            {createMsg && (
              <p className={`text-xs ${createMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
                {createMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={creating}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
            >
              {creating ? "创建中…" : "创建兑换码"}
            </button>
          </form>
        </div>

        {/* Codes table */}
        <div className="bg-[#161b22] border border-white/8 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
            <h2 className="text-sm font-semibold text-slate-300">所有兑换码 ({codes.length})</h2>
            <button
              onClick={() => fetchCodes(secret)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              刷新
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : codes.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-10">暂无兑换码</p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {codes.map((c) => {
                const expired = c.expires_at && new Date(c.expires_at) < new Date();
                const exhausted = c.uses_count >= c.max_uses;
                return (
                  <div key={c.code} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          onClick={() => copyCode(c.code)}
                          className="font-mono text-sm text-white hover:text-indigo-300 transition-colors"
                          title="点击复制"
                        >
                          {c.code}
                        </button>
                        {copied === c.code && <span className="text-[10px] text-emerald-400">已复制</span>}
                        {expired  && <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">已过期</span>}
                        {exhausted && <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">已用完</span>}
                      </div>
                      {c.note && <p className="text-[11px] text-slate-500">{c.note}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-mono text-indigo-400">{c.minutes} 分钟</p>
                      <p className="text-[11px] text-slate-500">{c.uses_count}/{c.max_uses} 次已用</p>
                    </div>
                    {c.expires_at && (
                      <div className="text-right shrink-0 hidden sm:block">
                        <p className="text-[11px] text-slate-500">
                          {new Date(c.expires_at).toLocaleDateString("zh-CN")} 到期
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

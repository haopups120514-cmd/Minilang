"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────
interface RedemptionCode {
  code: string; minutes: number; max_uses: number; uses_count: number;
  expires_at: string | null; note: string | null; created_at: string;
}
interface AdminUser {
  id: string; email: string; displayName: string; createdAt: string; lastSignIn: string | null;
  referralCode: string; remaining: number; isBanned: boolean;
}
interface Stats {
  totalSessions: number; totalMins: number; todayActiveUsers: number;
  totalUsers: number; totalFeedback: number;
  hourlyData: { hour: number; count: number }[];
}
interface Announcement {
  id: string; title: string; content: string; is_active: boolean; created_at: string;
}
interface Feedback {
  id: string; user_id: string | null; content: string; status: string; created_at: string;
}
interface InviteEvent {
  inviterEmail: string; inviteeEmail: string; at: string; code: string;
}
interface InviteLeader {
  id: string; email: string; count: number;
}
interface ApiQuota {
  deepl?: { used: number; limit: number; pct: number } | { error: string };
  groq?:  { todayRequests: number };
  deepgram?: { balances: { amount: number; units: string }[] } | { error: string };
}

const TABS = [
  { id: "stats",         label: "数据概览",  icon: "📊" },
  { id: "users",         label: "用户管理",  icon: "👥" },
  { id: "codes",         label: "兑换码",    icon: "🎟" },
  { id: "announcements", label: "公告",      icon: "📢" },
  { id: "feedback",      label: "反馈",      icon: "💬" },
  { id: "invites",       label: "邀请追踪",  icon: "🔗" },
  { id: "api",           label: "API监控",   icon: "🔌" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ─── Shared helpers ───────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#161b22] border border-white/8 rounded-2xl ${className}`}>
      {children}
    </div>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">{children}</p>;
}
function Badge({ color, children }: { color: "red" | "green" | "slate"; children: React.ReactNode }) {
  const cls = { red: "text-red-400 bg-red-400/10", green: "text-emerald-400 bg-emerald-400/10", slate: "text-slate-500 bg-white/5" }[color];
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{children}</span>;
}
function adminFetch(path: string, secret: string, opts: RequestInit = {}) {
  return fetch(path, { ...opts, headers: { ...(opts.headers as Record<string,string>), "x-admin-secret": secret, "Content-Type": "application/json" } });
}

// ─── Tab: Stats ───────────────────────────────────────────
function StatsTab({ secret }: { secret: string }) {
  const [stats, setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/api/admin/stats", secret)
      .then(r => r.json()).then(d => setStats(d)).finally(() => setLoading(false));
  }, [secret]);

  if (loading) return <Spinner />;
  if (!stats)  return <p className="text-red-400 text-sm">加载失败</p>;

  const maxCount = Math.max(...stats.hourlyData.map(d => d.count), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "总会话数",      value: stats.totalSessions },
          { label: "总转录时长(分)", value: stats.totalMins },
          { label: "今日活跃用户",  value: stats.todayActiveUsers },
          { label: "注册用户数",    value: stats.totalUsers },
        ].map(s => (
          <Card key={s.label} className="p-4 text-center">
            <p className="text-2xl font-bold text-white">{s.value ?? "—"}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <SectionLabel>过去 24h 每小时新增会话</SectionLabel>
        <div className="flex items-end gap-1 h-24">
          {stats.hourlyData.map(d => (
            <div key={d.hour} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className="w-full bg-[#0071e3]/60 rounded-sm transition-all"
                style={{ height: `${Math.max(4, (d.count / maxCount) * 88)}px` }}
                title={`${d.hour}:00 — ${d.count} 次`}
              />
              {d.hour % 4 === 0 && (
                <span className="text-[9px] text-slate-600">{d.hour}h</span>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: Users ───────────────────────────────────────────
function UsersTab({ secret }: { secret: string }) {
  const [users,   setUsers]   = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [banning, setBanning] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/users", secret)
      .then(r => r.json()).then(d => setUsers(d.users ?? [])).finally(() => setLoading(false));
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  const toggleBan = async (u: AdminUser) => {
    setBanning(u.id);
    await adminFetch("/api/admin/users", secret, {
      method: "PATCH",
      body: JSON.stringify({ userId: u.id, isBanned: !u.isBanned }),
    });
    setBanning(null);
    load();
  };

  const filtered = users.filter(u =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <input
        placeholder="搜索邮箱…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-[#1d1d1f] border border-white/8 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3]"
      />
      <Card>
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-8">无用户</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map(u => (
              <div key={u.id} className={`px-5 py-3 flex items-center gap-3 ${u.isBanned ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-white truncate">{u.email}</p>
                    {u.displayName && <span className="text-[11px] text-[#2997ff] bg-[#0071e3]/10 px-1.5 py-0.5 rounded shrink-0">{u.displayName}</span>}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    注册 {new Date(u.createdAt).toLocaleDateString("zh-CN")}
                    {u.lastSignIn && ` · 最近登录 ${new Date(u.lastSignIn).toLocaleDateString("zh-CN")}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-mono font-semibold ${u.remaining < 30 ? "text-red-400" : "text-[#2997ff]"}`}>
                    {u.remaining} 分钟
                  </p>
                  {u.remaining < 30 && <Badge color="red">时长不足</Badge>}
                </div>
                <button
                  onClick={() => toggleBan(u)}
                  disabled={banning === u.id}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    u.isBanned
                      ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      : "border-red-500/30 text-red-400 hover:bg-red-500/10"
                  }`}
                >
                  {banning === u.id ? "…" : u.isBanned ? "解封" : "封禁"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab: Codes ───────────────────────────────────────────
function CodesTab({ secret }: { secret: string }) {
  const [codes,    setCodes]    = useState<RedemptionCode[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [copied,   setCopied]   = useState("");
  const [filter,   setFilter]   = useState<"all" | "active" | "expired" | "exhausted">("all");
  // Create form
  const [formCode,    setFormCode]    = useState("");
  const [formMins,    setFormMins]    = useState("60");
  const [formUses,    setFormUses]    = useState("1");
  const [formExpires, setFormExpires] = useState("");
  const [formNote,    setFormNote]    = useState("");
  const [creating,    setCreating]    = useState(false);
  const [createMsg,   setCreateMsg]   = useState("");
  // Batch
  const [batchCount, setBatchCount]   = useState("5");
  const [batching,   setBatching]     = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/codes", secret)
      .then(r => r.json()).then(d => setCodes(d.codes ?? [])).finally(() => setLoading(false));
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setCreateMsg("");
    const res = await adminFetch("/api/admin/codes", secret, {
      method: "POST",
      body: JSON.stringify({
        code:      formCode.trim().toUpperCase() || undefined,
        minutes:   parseInt(formMins),
        maxUses:   parseInt(formUses),
        expiresAt: formExpires || undefined,
        note:      formNote || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) setCreateMsg(`❌ ${data.error}`);
    else { setCreateMsg(`✓ 已创建：${data.code.code}`); setFormCode(""); load(); }
    setCreating(false);
  };

  const batchCreate = async () => {
    setBatching(true);
    const n = parseInt(batchCount) || 5;
    for (let i = 0; i < n; i++) {
      await adminFetch("/api/admin/codes", secret, {
        method: "POST",
        body: JSON.stringify({
          minutes:   parseInt(formMins),
          maxUses:   parseInt(formUses),
          expiresAt: formExpires || undefined,
          note:      formNote || undefined,
        }),
      });
    }
    setBatching(false);
    setCreateMsg(`✓ 已批量创建 ${n} 个`);
    load();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => { setCopied(code); setTimeout(() => setCopied(""), 1500); });
  };

  const filtered = codes.filter(c => {
    if (filter === "all") return true;
    const expired   = c.expires_at && new Date(c.expires_at) < new Date();
    const exhausted = c.uses_count >= c.max_uses;
    if (filter === "expired")   return expired;
    if (filter === "exhausted") return exhausted && !expired;
    if (filter === "active")    return !expired && !exhausted;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Create form */}
      <Card className="p-5">
        <SectionLabel>创建兑换码</SectionLabel>
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InputField label="自定义码（留空随机）" value={formCode} onChange={e => setFormCode(e.target.value.toUpperCase())} placeholder="PROMO2025" mono />
            <InputField label="分钟数" type="number" value={formMins} onChange={e => setFormMins(e.target.value)} required />
            <InputField label="最多使用次数" type="number" value={formUses} onChange={e => setFormUses(e.target.value)} required />
            <InputField label="到期时间（可选）" type="datetime-local" value={formExpires} onChange={e => setFormExpires(e.target.value)} />
          </div>
          <InputField label="备注" value={formNote} onChange={e => setFormNote(e.target.value)} placeholder="内部备注" />
          {createMsg && <p className={`text-xs ${createMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{createMsg}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={creating}
              className="bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
              {creating ? "创建中…" : "创建"}
            </button>
            <span className="text-slate-600 text-xs">或批量</span>
            <input type="number" min="1" max="100" value={batchCount} onChange={e => setBatchCount(e.target.value)}
              className="w-16 bg-[#1d1d1f] border border-white/8 rounded-lg px-2 py-1.5 text-sm text-slate-100 focus:outline-none" />
            <span className="text-slate-500 text-xs">个</span>
            <button type="button" onClick={batchCreate} disabled={batching}
              className="border border-white/10 hover:border-white/20 disabled:opacity-50 text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
              {batching ? "生成中…" : "批量生成"}
            </button>
          </div>
        </form>
      </Card>

      {/* Filter + list */}
      <Card>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5">
          {(["all", "active", "expired", "exhausted"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                filter === f ? "bg-[#0071e3] text-white" : "text-slate-500 hover:text-slate-300"
              }`}>
              {{ all: "全部", active: "可用", expired: "已过期", exhausted: "已用完" }[f]}
            </button>
          ))}
          <button onClick={load} className="ml-auto text-xs text-slate-500 hover:text-slate-300">刷新</button>
        </div>
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-8">暂无</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map(c => {
              const expired   = c.expires_at && new Date(c.expires_at) < new Date();
              const exhausted = c.uses_count >= c.max_uses;
              return (
                <div key={c.code} className="px-5 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <button onClick={() => copyCode(c.code)}
                        className="font-mono text-sm text-white hover:text-[#2997ff] transition-colors">
                        {c.code}
                      </button>
                      {copied === c.code   && <span className="text-[10px] text-emerald-400">已复制</span>}
                      {expired             && <Badge color="red">已过期</Badge>}
                      {exhausted && !expired && <Badge color="slate">已用完</Badge>}
                      {!expired && !exhausted && <Badge color="green">可用</Badge>}
                    </div>
                    {c.note && <p className="text-[11px] text-slate-500">{c.note}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono text-[#2997ff]">{c.minutes} 分钟</p>
                    <p className="text-[11px] text-slate-500">{c.uses_count}/{c.max_uses} 次</p>
                  </div>
                  {c.expires_at && (
                    <p className="text-[11px] text-slate-500 shrink-0 hidden sm:block">
                      {new Date(c.expires_at).toLocaleDateString("zh-CN")} 到期
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab: Announcements ───────────────────────────────────
function AnnouncementsTab({ secret }: { secret: string }) {
  const [list,    setList]    = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [title,   setTitle]   = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg,     setMsg]     = useState("");

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/announcements", secret)
      .then(r => r.json()).then(d => setList(d.announcements ?? [])).finally(() => setLoading(false));
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setMsg("");
    const res = await adminFetch("/api/admin/announcements", secret, {
      method: "POST", body: JSON.stringify({ title, content }),
    });
    const d = await res.json();
    if (!res.ok) setMsg(`❌ ${d.error}`);
    else { setMsg("✓ 已发布"); setTitle(""); setContent(""); load(); }
    setCreating(false);
  };

  const toggle = async (a: Announcement) => {
    await adminFetch("/api/admin/announcements", secret, {
      method: "PATCH", body: JSON.stringify({ id: a.id, isActive: !a.is_active }),
    });
    load();
  };

  const del = async (a: Announcement) => {
    if (!confirm(`删除公告"${a.title}"？`)) return;
    await adminFetch("/api/admin/announcements", secret, {
      method: "DELETE", body: JSON.stringify({ id: a.id }),
    });
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionLabel>发布新公告</SectionLabel>
        <form onSubmit={create} className="space-y-3">
          <InputField label="标题" value={title} onChange={e => setTitle(e.target.value)} required />
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">内容</label>
            <textarea
              value={content} onChange={e => setContent(e.target.value)} required rows={4}
              className="w-full bg-[#1d1d1f] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3] resize-none"
            />
          </div>
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{msg}</p>}
          <button type="submit" disabled={creating}
            className="bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            {creating ? "发布中…" : "发布"}
          </button>
        </form>
      </Card>

      <Card>
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-300">所有公告 ({list.length})</p>
          <button onClick={load} className="text-xs text-slate-500 hover:text-slate-300">刷新</button>
        </div>
        {loading ? <Spinner /> : list.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-8">暂无公告</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {list.map(a => (
              <div key={a.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white">{a.title}</p>
                      <Badge color={a.is_active ? "green" : "slate"}>{a.is_active ? "开启" : "关闭"}</Badge>
                    </div>
                    <p className="text-xs text-slate-400 whitespace-pre-wrap">{a.content}</p>
                    <p className="text-[11px] text-slate-600 mt-1">{new Date(a.created_at).toLocaleString("zh-CN")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggle(a)}
                      className="text-xs text-slate-400 hover:text-white border border-white/8 hover:border-white/20 px-2.5 py-1 rounded-lg transition-colors">
                      {a.is_active ? "关闭" : "开启"}
                    </button>
                    <button onClick={() => del(a)}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-400/40 px-2.5 py-1 rounded-lg transition-colors">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab: Feedback ────────────────────────────────────────
function FeedbackTab({ secret }: { secret: string }) {
  const [list,    setList]    = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<"all" | "pending" | "resolved">("pending");

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/feedback", secret)
      .then(r => r.json()).then(d => setList(d.feedback ?? [])).finally(() => setLoading(false));
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    await adminFetch("/api/admin/feedback", secret, {
      method: "PATCH", body: JSON.stringify({ id, status }),
    });
    load();
  };

  const filtered = list.filter(f => filter === "all" || f.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(["all", "pending", "resolved"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
              filter === f ? "bg-[#0071e3] text-white" : "text-slate-500 hover:text-slate-300"
            }`}>
            {{ all: "全部", pending: "待处理", resolved: "已处理" }[f]}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs text-slate-500 hover:text-slate-300">刷新</button>
      </div>
      <Card>
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-8">暂无反馈</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map(f => (
              <div key={f.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 whitespace-pre-wrap">{f.content}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {f.user_id ? f.user_id.slice(0, 8) + "…" : "匿名"} · {new Date(f.created_at).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1.5">
                    <Badge color={f.status === "resolved" ? "green" : "red"}>
                      {f.status === "resolved" ? "已处理" : "待处理"}
                    </Badge>
                    {f.status === "pending" ? (
                      <button onClick={() => setStatus(f.id, "resolved")}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300">
                        标记已处理
                      </button>
                    ) : (
                      <button onClick={() => setStatus(f.id, "pending")}
                        className="text-[11px] text-slate-500 hover:text-slate-300">
                        重新打开
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab: Invites ─────────────────────────────────────────
function InvitesTab({ secret }: { secret: string }) {
  const [data,    setData]    = useState<{ inviteEvents: InviteEvent[]; leaderboard: InviteLeader[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState<"leaderboard" | "events">("leaderboard");

  useEffect(() => {
    adminFetch("/api/admin/invites", secret)
      .then(r => r.json()).then(d => setData(d)).finally(() => setLoading(false));
  }, [secret]);

  if (loading) return <Spinner />;
  if (!data)   return <p className="text-red-400 text-sm">加载失败</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(["leaderboard", "events"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
              view === v ? "bg-[#0071e3] text-white" : "text-slate-500 hover:text-slate-300"
            }`}>
            {v === "leaderboard" ? "邀请排行榜" : "邀请明细"}
          </button>
        ))}
      </div>

      <Card>
        {view === "leaderboard" ? (
          data.leaderboard.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">暂无邀请记录</p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {data.leaderboard.map((l, i) => (
                <div key={l.id} className="px-5 py-3 flex items-center gap-3">
                  <span className={`text-sm font-bold w-6 text-center ${i < 3 ? "text-yellow-400" : "text-slate-600"}`}>
                    {i + 1}
                  </span>
                  <p className="flex-1 text-sm text-slate-200 truncate">{l.email}</p>
                  <p className="text-sm font-mono text-[#2997ff]">{l.count} 人</p>
                </div>
              ))}
            </div>
          )
        ) : (
          data.inviteEvents.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">暂无邀请记录</p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {data.inviteEvents.map((ev, i) => (
                <div key={i} className="px-5 py-3">
                  <p className="text-xs text-slate-300">
                    <span className="text-[#2997ff]">{ev.inviterEmail}</span>
                    <span className="text-slate-500"> 邀请了 </span>
                    <span className="text-slate-200">{ev.inviteeEmail}</span>
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    码 {ev.code} · {new Date(ev.at).toLocaleString("zh-CN")}
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </Card>
    </div>
  );
}

// ─── Tab: API Quota ───────────────────────────────────────
function ApiQuotaTab({ secret }: { secret: string }) {
  const [quota,   setQuota]   = useState<ApiQuota | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/api-quota", secret)
      .then(r => r.json()).then(d => setQuota(d)).finally(() => setLoading(false));
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;

  const deepl    = quota?.deepl   as Record<string, unknown> | undefined;
  const groq     = quota?.groq    as Record<string, unknown> | undefined;
  const deepgram = quota?.deepgram as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={load} className="text-xs text-slate-500 hover:text-slate-300">刷新</button>
      </div>

      {/* DeepL */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>DeepL 翻译用量（本月）</SectionLabel>
        </div>
        {deepl?.error ? (
          <p className="text-sm text-slate-500">{String(deepl.error)}</p>
        ) : deepl?.limit ? (
          <>
            <div className="flex items-end justify-between mb-2">
              <p className="text-2xl font-bold text-white">
                {Number(deepl.pct)}%
              </p>
              <p className="text-xs text-slate-500">
                {Number(deepl.used).toLocaleString()} / {Number(deepl.limit).toLocaleString()} 字符
              </p>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${Number(deepl.pct) > 80 ? "bg-red-500" : "bg-[#0071e3]"}`}
                style={{ width: `${Math.min(Number(deepl.pct), 100)}%` }}
              />
            </div>
            {Number(deepl.pct) > 80 && (
              <p className="text-xs text-red-400 mt-2">⚠️ 用量超过 80%，请注意</p>
            )}
          </>
        ) : null}
      </Card>

      {/* Groq */}
      <Card className="p-5">
        <SectionLabel>Groq 今日请求次数</SectionLabel>
        <p className="text-2xl font-bold text-white">{String(groq?.todayRequests ?? 0)}</p>
        <p className="text-xs text-slate-500 mt-1">（仅统计通过本服务的请求，非实时 API 余额）</p>
        {Number(groq?.todayRequests ?? 0) > 500 && (
          <p className="text-xs text-red-400 mt-2">⚠️ 今日请求量较高</p>
        )}
      </Card>

      {/* Deepgram */}
      <Card className="p-5">
        <SectionLabel>Deepgram 账户余额</SectionLabel>
        {deepgram?.error ? (
          <p className="text-sm text-slate-500">{String(deepgram.error)}</p>
        ) : (deepgram?.balances as Array<{ amount: number; units: string }> | undefined)?.length ? (
          <div className="space-y-2">
            {(deepgram?.balances as Array<{ amount: number; units: string }>).map((b, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <p className={`text-2xl font-bold ${b.amount < 5 ? "text-red-400" : "text-white"}`}>
                  ${b.amount.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500">{b.units}</p>
              </div>
            ))}
            {(deepgram?.balances as Array<{ amount: number; units: string }>).some(b => b.amount < 5) && (
              <p className="text-xs text-red-400">⚠️ 余额不足 $5，请及时充值</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">无余额信息</p>
        )}
      </Card>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="w-5 h-5 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function InputField({
  label, value, onChange, type = "text", placeholder, required, mono,
}: {
  label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string; placeholder?: string; required?: boolean; mono?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] text-slate-500 mb-1 block">{label}</label>
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder} required={required}
        className={`w-full bg-[#1d1d1f] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3] ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────
export default function AdminPage() {
  const [secret,  setSecret]  = useState("");
  const [authed,  setAuthed]  = useState(false);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [tab,     setTab]     = useState<TabId>("stats");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/admin/codes", { headers: { "x-admin-secret": secret } });
    setLoading(false);
    if (res.status === 403) { setError("密码错误"); return; }
    setAuthed(true);
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#1d1d1f] flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-[#161b22] border border-white/8 rounded-2xl p-6">
          <div className="text-center mb-6">
            <p className="text-lg font-semibold text-white">Mimilang 管理后台</p>
            <p className="text-xs text-slate-500 mt-1">请输入管理员密码</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input type="password" placeholder="ADMIN_SECRET" value={secret}
              onChange={e => setSecret(e.target.value)} required
              className="w-full bg-[#1d1d1f] border border-white/8 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[#0071e3]"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
              {loading ? "验证中…" : "登录"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1d1d1f] text-slate-200">
      {/* Header */}
      <div className="border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Mimilang 管理后台</p>
        <button onClick={() => { setAuthed(false); setSecret(""); }}
          className="text-xs text-slate-600 hover:text-slate-300 px-3 py-1.5 rounded-lg border border-white/8 hover:border-white/15 transition-colors">
          退出
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/5 overflow-x-auto">
        <div className="flex px-4 min-w-max">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? "border-[#0071e3] text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {tab === "stats"         && <StatsTab         secret={secret} />}
        {tab === "users"         && <UsersTab         secret={secret} />}
        {tab === "codes"         && <CodesTab         secret={secret} />}
        {tab === "announcements" && <AnnouncementsTab secret={secret} />}
        {tab === "feedback"      && <FeedbackTab      secret={secret} />}
        {tab === "invites"       && <InvitesTab       secret={secret} />}
        {tab === "api"           && <ApiQuotaTab      secret={secret} />}
      </div>
    </div>
  );
}

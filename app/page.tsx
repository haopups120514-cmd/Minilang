"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadSessionsFromDB, saveSessionsToDB, deleteSessionFromDB } from "./lib/supabase-db";
import AuthPage from "./components/AuthPage";

// ─── Types ────────────────────────────────────────────────────────────────────

type LangKey = "ja" | "en" | "zh";

interface TranscriptEntry {
  id: number;
  original: string;
  translated: string;
  timestamp: string;
  speaker?: number;
}

interface Session {
  id: string;
  title: string;       // "4月5日 09:30"
  createdAt: string;   // ISO
  sourceLang: LangKey;
  targetLang: LangKey;
  transcripts: TranscriptEntry[];
  summary: string;
  notes: string;       // user's quick notes
  durationSecs?: number; // actual recorded duration in seconds
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES: Record<LangKey, {
  label: string; nativeLabel: string; flag: string;
  deepgramLang: string; deeplSource: string; deeplTarget: string;
}> = {
  ja: { label: "Japanese", nativeLabel: "日本語", flag: "🇯🇵", deepgramLang: "ja",    deeplSource: "JA", deeplTarget: "JA"    },
  en: { label: "English",  nativeLabel: "English", flag: "🇺🇸", deepgramLang: "en-US", deeplSource: "EN", deeplTarget: "EN-US" },
  zh: { label: "Chinese",  nativeLabel: "中文",    flag: "🇨🇳", deepgramLang: "zh-CN", deeplSource: "ZH", deeplTarget: "ZH"    },
};

const ALL_LANGS: LangKey[] = ["ja", "en", "zh"];

const FONT_SIZES = [
  { cls: "text-xs sm:text-sm",      leading: "leading-relaxed" },  // 小
  { cls: "text-sm sm:text-[15px]",  leading: "leading-relaxed" },  // 默认
  { cls: "text-[15px] sm:text-lg",  leading: "leading-loose"   },  // 大
  { cls: "text-base sm:text-xl",    leading: "leading-loose"   },  // 超大
];

const MAX_RECONNECTS = 3;
const LS_PREFS    = "ls-prefs-v1";

// BCP-47 codes accepted by Chrome's local Translation API
const LOCAL_LANG: Record<LangKey, string> = { ja: "ja", en: "en", zh: "zh" };

const SPEAKER_COLORS = [
  { dot: "#60a5fa", text: "text-sky-300",     label: "主讲" },
  { dot: "#34d399", text: "text-emerald-300", label: "学生A" },
  { dot: "#fbbf24", text: "text-amber-300",   label: "学生B" },
  { dot: "#f87171", text: "text-rose-300",    label: "学生C" },
  { dot: "#c084fc", text: "text-purple-300",  label: "学生D" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSessionTitle(date = new Date()) {
  return date.toLocaleString("zh-CN", {
    month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function makeSessionId() {
  return `s${Date.now()}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Mimilang() {
  // Auth
  const [user,        setUser]        = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Sessions
  const [sessions,          setSessions]          = useState<Session[]>([]);
  const [currentSessionId,  setCurrentSessionId]  = useState<string>("");
  const [viewingSessionId,  setViewingSessionId]  = useState<string>("");
  const [showSessionPanel,  setShowSessionPanel]  = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Network
  const [isOnline, setIsOnline] = useState(true);

  // Mobile notes sheet
  const [showMobileNotes, setShowMobileNotes] = useState(false);

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("mimilang-theme", next); } catch {}
  };

  // Language (global preference, also stored per session)
  const [sourceLang,    setSourceLang]    = useState<LangKey>("ja");
  const [targetLang,    setTargetLang]    = useState<LangKey>("zh");
  const [autoDetect,    setAutoDetect]    = useState(false); // kept for compat, always false

  // Recording
  const [isRecording,        setIsRecording]        = useState(false);
  const [isPaused,           setIsPaused]           = useState(false);
  const [isWhisperProcessing,setIsWhisperProcessing] = useState(false);
  const [isConnecting,       setIsConnecting]       = useState(false);
  const [interimText,   setInterimText]   = useState("");
  const [interimTrans,  setInterimTrans]  = useState("");
  const [reconnectMsg,  setReconnectMsg]  = useState("");
  const [error,         setError]         = useState("");
  const [elapsedSecs,   setElapsedSecs]   = useState(0);

  // Summary
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSummary,   setShowSummary]   = useState(false);

  // AI correction
  const [correctionEnabled, setCorrectionEnabled] = useState(true);
  const [correctingIds,     setCorrectingIds]     = useState<Set<number>>(new Set());
  const correctionEnabledRef = useRef(correctionEnabled);
  useEffect(() => { correctionEnabledRef.current = correctionEnabled; }, [correctionEnabled]);

  // Scene detection
  const [detectedScene, setDetectedScene] = useState("");
  const [sceneHint,     setSceneHint]     = useState("");
  const detectedSceneRef = useRef("");
  const sceneHintRef     = useRef("");
  const sceneDetectedAt  = useRef(0); // transcript count when last detected

  // Transcription engine
  const [transcriptionEngine, setTranscriptionEngine] = useState<"deepgram" | "whisper">("deepgram");
  const transcriptionEngineRef = useRef<"deepgram" | "whisper">("deepgram");
  useEffect(() => { transcriptionEngineRef.current = transcriptionEngine; }, [transcriptionEngine]);

  // Translation mode: "local" = Chrome built-in (zero-latency), "cloud" = DeepL
  const [translationMode,  setTranslationMode]  = useState<"local" | "cloud">("local");
  const translationModeRef = useRef<"local" | "cloud">("local");
  const [localUnavailable, setLocalUnavailable] = useState(false);

  // Session rename
  const [renamingSessionId, setRenamingSessionId] = useState<string>("");
  const [renameValue,       setRenameValue]        = useState("");

  const renameSession = (sid: string, title: string) => {
    const t = title.trim();
    if (t) setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, title: t } : s));
    setRenamingSessionId("");
  };

  // Keep a ref to recent transcripts so WebSocket callbacks can access context
  const recentTranscriptsRef = useRef<TranscriptEntry[]>([]);
  useEffect(() => {
    const s = sessions.find((s) => s.id === currentSessionId);
    if (s) recentTranscriptsRef.current = s.transcripts.slice(-6);
  }, [sessions, currentSessionId]);

  // Microphone selection
  const [audioDevices,     setAudioDevices]     = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [showMicPicker,    setShowMicPicker]    = useState(false);

  // Recording backup
  const audioChunksRef   = useRef<Blob[]>([]);
  const [backupUrl,       setBackupUrl]         = useState<string>("");

  // UI
  const [fontSizeIdx,   setFontSizeIdx]   = useState(1);
  const [showExport,    setShowExport]    = useState(false);
  const [showSettings,  setShowSettings]  = useState(false);
  const [copied,        setCopied]        = useState(false);
  const [copiedId,      setCopiedId]      = useState<number | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Credits / time quota
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [referralCode,     setReferralCode]     = useState("");
  const [redeemInput,      setRedeemInput]      = useState("");
  const [redeemMsg,        setRedeemMsg]        = useState<{ ok: boolean; text: string } | null>(null);
  const [redeemLoading,    setRedeemLoading]    = useState(false);
  const [inviteCopied,     setInviteCopied]     = useState(false);

  // Refs
  const wsRef             = useRef<WebSocket | null>(null);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const transcriptEndRef  = useRef<HTMLDivElement>(null);
  const historyScrollRef  = useRef<HTMLDivElement>(null);
  const entryIdRef        = useRef(0);
  const commitCountRef    = useRef(0); // total commits this session, for scene detection timing
  const sourceLangRef     = useRef(sourceLang);
  const targetLangRef     = useRef(targetLang);
  const currentSidRef     = useRef(currentSessionId); // session id ref for ws callbacks
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedSecsRef    = useRef(0);
  const volumeBarsRef     = useRef<HTMLDivElement>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const animFrameRef      = useRef<number | null>(null);
  const translateCache    = useRef(new Map<string, string>());
  const intentionalRef    = useRef(false);
  const reconnectCount    = useRef(0);
  const reconnectTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimAbort      = useRef<AbortController | null>(null);
  const staleInterimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimTextRef    = useRef("");   // mirrors interimText state for callbacks
  // Sentence buffer: accumulates Deepgram is_final segments until a full sentence is detected
  const sentenceBufferRef      = useRef("");
  const sentenceBufferSrc      = useRef<LangKey>("ja");
  const sentenceBufferSpeaker  = useRef<number | undefined>(undefined);
  const sentenceFlushTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepAliveRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingRef    = useRef(false);
  const isConnectingRef   = useRef(false);
  const whisperRecorderRef   = useRef<MediaRecorder | null>(null);
  const whisperBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWhisperActiveRef   = useRef(false);
  const doWhisperBatchRef    = useRef<(() => void) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const translatorRef     = useRef<{ translate: (t: string) => Promise<string> } | null>(null);
  const translatorPairRef = useRef("");

  useEffect(() => { sourceLangRef.current    = sourceLang;        }, [sourceLang]);
  useEffect(() => { targetLangRef.current    = targetLang;        }, [targetLang]);
  useEffect(() => { currentSidRef.current    = currentSessionId;  }, [currentSessionId]);
  useEffect(() => { interimTextRef.current   = interimText;       }, [interimText]);
  useEffect(() => { isRecordingRef.current   = isRecording;       }, [isRecording]);
  useEffect(() => { isConnectingRef.current  = isConnecting;      }, [isConnecting]);
  useEffect(() => { translationModeRef.current = translationMode; }, [translationMode]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const viewId           = viewingSessionId || currentSessionId;
  const viewingSession   = sessions.find((s) => s.id === viewId);
  const currentSession   = sessions.find((s) => s.id === currentSessionId);
  const isViewingCurrent = viewId === currentSessionId;
  const viewTranscripts  = viewingSession?.transcripts ?? [];

  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) =>
        s.title.includes(searchQuery) ||
        s.transcripts.some((t) =>
          t.original.includes(searchQuery) || t.translated.includes(searchQuery)
        )
      )
    : sessions;

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    }).catch(() => {
      // Safari 下网络失败或 Supabase 初始化异常时，确保不会永久转圈
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Credits: load balance on login ───────────────────────────────────────────
  useEffect(() => {
    if (!user) { setCreditsRemaining(null); setReferralCode(""); return; }
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      fetch("/api/credits/balance", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          if (d.minutesRemaining !== undefined) setCreditsRemaining(d.minutesRemaining);
          if (d.referralCode) setReferralCode(d.referralCode);
        }).catch(() => {});
    });
  }, [user]);

  // ── Credits: deduct after recording ends ─────────────────────────────────────
  const prevIsRecordingRef = useRef(false);
  useEffect(() => {
    if (prevIsRecordingRef.current && !isRecording) {
      const mins = Math.ceil(elapsedSecsRef.current / 60);
      if (mins > 0) {
        supabase.auth.getSession().then(({ data }) => {
          const token = data.session?.access_token;
          if (!token) return;
          fetch("/api/credits/use", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ minutes: mins }),
          }).then((r) => r.json()).then((d) => {
            if (d.minutesRemaining !== undefined) setCreditsRemaining(d.minutesRemaining);
          }).catch(() => {});
        });
      }
    }
    prevIsRecordingRef.current = isRecording;
  }, [isRecording]);


  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Theme init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mimilang-theme") as "dark" | "light" | null;
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    if (theme === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
  }, [theme]);

  // ── Persistence (IndexedDB, with localStorage migration) ────────────────────
  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }
    async function init() {
      try {
        const saved: Session[] = await loadSessionsFromDB(user!.id);
        if (Array.isArray(saved) && saved.length > 0) {
          setSessions(saved);
          const last = saved[saved.length - 1];
          setCurrentSessionId(last.id);
          setViewingSessionId(last.id);
          currentSidRef.current = last.id;
          setSourceLang(last.sourceLang);
          const allIds = saved.flatMap((s) => s.transcripts.map((t) => t.id));
          if (allIds.length > 0) entryIdRef.current = Math.max(...allIds) + 1;
        }
      } catch (e) { console.error("DB load error:", e); }

      try {
        const prefs = localStorage.getItem(LS_PREFS);
        if (prefs) {
          const p = JSON.parse(prefs);
          if (p.fontSizeIdx !== undefined) setFontSizeIdx(p.fontSizeIdx);
          if (p.selectedDeviceId) setSelectedDeviceId(p.selectedDeviceId);
          if (p.translationMode) setTranslationMode(p.translationMode);
        }
      } catch {}
    }
    init();

    // Enumerate microphone devices (labels available after permission grant)
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      setAudioDevices(devs.filter((d) => d.kind === "audioinput"));
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user || sessions.length === 0) return;
    saveSessionsToDB(sessions, user.id).catch(() => {});
  }, [sessions, user]);

  useEffect(() => {
    try { localStorage.setItem(LS_PREFS, JSON.stringify({ fontSizeIdx, sourceLang, targetLang, translationMode })); } catch {}
  }, [fontSizeIdx, sourceLang, targetLang]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isViewingCurrent || userScrolledUp) return;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [viewTranscripts.length, isViewingCurrent, userScrolledUp]);

  // Reset scroll position when switching sessions or stopping recording
  useEffect(() => { setUserScrolledUp(false); }, [viewId]);
  useEffect(() => { if (!isRecording) setUserScrolledUp(false); }, [isRecording]);

  // ── Timer ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isRecording) {
      setElapsedSecs(0);
      timerRef.current = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  useEffect(() => { elapsedSecsRef.current = elapsedSecs; }, [elapsedSecs]);

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Retry translation for a single entry ─────────────────────────────────────
  const retranslate = (entryId: number, text: string) => {
    translateAny(text, sourceLang, targetLang).then((t) => {
      if (t) updateTranscript(entryId, t);
    });
  };

  // ── Audio pipeline (noise gate + volume monitor) ─────────────────────────────
  /**
   * Sets up: mic stream → [noise gate worklet] → analyser → MediaStreamDestination
   * Returns the processed stream to feed into MediaRecorder / Deepgram.
   * Falls back to the raw stream if AudioWorklet is unavailable.
   */
  const setupAudioPipeline = async (stream: MediaStream): Promise<MediaStream> => {
    try {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const source  = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const dest = ctx.createMediaStreamDestination();

      try {
        await ctx.audioWorklet.addModule("/noise-gate.js");
        const gate = new AudioWorkletNode(ctx, "noise-gate");
        source.connect(gate);
        gate.connect(analyser);
      } catch {
        // AudioWorklet not supported — skip noise gate
        source.connect(analyser);
      }
      analyser.connect(dest);

      // Volume bar animation
      const data = new Uint8Array(analyser.frequencyBinCount);
      const thresholds = [8, 22, 42, 62, 82];
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const vol = Math.min(100, (data.reduce((a, b) => a + b, 0) / data.length / 255) * 300);
        if (volumeBarsRef.current) {
          Array.from(volumeBarsRef.current.children).forEach((bar, i) => {
            const el = bar as HTMLElement;
            const on = vol >= thresholds[i];
            el.style.opacity = on ? "1" : "0.18";
            el.style.backgroundColor = on ? "#818cf8" : "#374151";
          });
        }
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);

      return dest.stream;
    } catch {
      // Full fallback: return raw stream, no monitoring
      return stream;
    }
  };

  const stopVolumeMonitor = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (volumeBarsRef.current)
      Array.from(volumeBarsRef.current.children).forEach((b) => {
        const el = b as HTMLElement;
        el.style.opacity = "0.18";
        el.style.backgroundColor = "#374151";
      });
  };

  // ── Translation with cache ───────────────────────────────────────────────────

  /** Cloud translation via Groq (cached) */
  const translate = async (text: string, src: LangKey, tgt: LangKey): Promise<string> => {
    const key = `${src}:${tgt}:${text}`;
    if (translateCache.current.has(key)) return translateCache.current.get(key)!;
    const context = recentTranscriptsRef.current.slice(-3).map((t) => t.translated || t.original).join("\n");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceLang: LANGUAGES[src].deeplSource, targetLang: LANGUAGES[tgt].deeplTarget, context }),
      });
      const d = await res.json();
      const result: string = d.translatedText || "";
      if (result) translateCache.current.set(key, result);
      return result;
    } catch { return ""; }
  };

  /** Get (or create) a cached Chrome local Translator instance */
  const getLocalTranslator = async (src: LangKey, tgt: LangKey) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).translation as any;
    if (!api?.createTranslator) { setLocalUnavailable(true); return null; }
    const pair = `${src}:${tgt}`;
    if (translatorPairRef.current === pair && translatorRef.current) return translatorRef.current;
    try {
      const srcCode = LOCAL_LANG[src];
      const tgtCode = LOCAL_LANG[tgt];
      if (api.canTranslate) {
        const avail: string = await api.canTranslate({ sourceLanguage: srcCode, targetLanguage: tgtCode });
        if (avail === "no") { setLocalUnavailable(true); return null; }
      }
      const t = await api.createTranslator({ sourceLanguage: srcCode, targetLanguage: tgtCode });
      if (t?.ready) await t.ready; // wait for model download if needed
      translatorRef.current = t;
      translatorPairRef.current = pair;
      setLocalUnavailable(false);
      return t as { translate: (text: string) => Promise<string> };
    } catch { setLocalUnavailable(true); return null; }
  };

  /** Send interim text to Groq immediately (no debounce), abort previous in-flight request */
  const doCloudInterim = (text: string, src: LangKey, tgt: LangKey) => {
    const ctrl = new AbortController();
    interimAbort.current = ctrl;
    const context = recentTranscriptsRef.current.slice(-2).map((t) => t.translated || t.original).join("\n");
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sourceLang: LANGUAGES[src].deeplSource, targetLang: LANGUAGES[tgt].deeplTarget, context }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        const result: string = d.translatedText || "";
        if (result) {
          translateCache.current.set(`${src}:${tgt}:${text}`, result);
          setInterimTrans(result);
        }
      })
      .catch(() => {});
  };

  /** Route translation — always cloud (Groq → DeepL); local Chrome AI removed (only supports en target) */
  const translateAny = async (text: string, src: LangKey, tgt: LangKey): Promise<string> => {
    return translate(text, src, tgt);
  };

  // ── Session helpers ──────────────────────────────────────────────────────────
  const createSession = useCallback((src: LangKey, tgt: LangKey): Session => {
    const id = makeSessionId();
    const session: Session = {
      id,
      title: makeSessionTitle(),
      createdAt: new Date().toISOString(),
      sourceLang: src,
      targetLang: tgt,
      transcripts: [],
      summary: "",
      notes: "",
    };
    setSessions((prev) => [...prev, session]);
    setCurrentSessionId(id);
    setViewingSessionId(id);
    currentSidRef.current = id;
    return session;
  }, []);

  /** 用户手动新建课程（录音中禁用） */
  const handleNewSession = () => {
    createSession(sourceLang, targetLang);
    setShowSessionPanel(false);
    setInterimText("");
    setInterimTrans("");
  };

  /** 向当前 session 追加 / 更新 transcript */
  const addTranscript = (entry: TranscriptEntry) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSidRef.current
          ? { ...s, transcripts: [...s.transcripts, entry] }
          : s
      )
    );
  };

  const updateTranscriptOriginal = (entryId: number, original: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSidRef.current
          ? { ...s, transcripts: s.transcripts.map((t) => t.id === entryId ? { ...t, original } : t) }
          : s
      )
    );
    setCorrectingIds((prev) => { const next = new Set(prev); next.delete(entryId); return next; });
  };

  const updateSessionNotes = (notes: string) => {
    setSessions((prev) => prev.map((s) => s.id === viewId ? { ...s, notes } : s));
  };

  const updateTranscript = (entryId: number, translated: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSidRef.current
          ? {
              ...s,
              transcripts: s.transcripts.map((t) =>
                t.id === entryId ? { ...t, translated } : t
              ),
            }
          : s
      )
    );
  };

  // ── Scene detection ───────────────────────────────────────────────────────────
  const triggerSceneDetection = useCallback(() => {
    const texts = recentTranscriptsRef.current.map((t) => t.original);
    if (texts.length < 5) return;
    fetch("/api/detect-scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    })
      .then((r) => r.json())
      .then(({ scene, hint }: { scene: string; hint: string }) => {
        if (scene) {
          setDetectedScene(scene);
          setSceneHint(hint);
          detectedSceneRef.current = scene;
          sceneHintRef.current     = hint;
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flush sentence buffer (Deepgram mode) ───────────────────────────────────
  const flushSentenceBuffer = useCallback(() => {
    const pending = sentenceBufferRef.current.trim();
    if (!pending) return;
    sentenceBufferRef.current = "";
    if (sentenceFlushTimer.current) { clearTimeout(sentenceFlushTimer.current); sentenceFlushTimer.current = null; }
    const src     = sentenceBufferSrc.current;
    const tgt     = targetLangRef.current;
    const speaker = sentenceBufferSpeaker.current;
    const newId   = entryIdRef.current++;
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const cached  = translateCache.current.get(`${src}:${tgt}:${pending}`);
    addTranscript({ id: newId, original: pending, translated: cached ?? "", timestamp, speaker });
    if (!cached) translateAny(pending, src, tgt).then((t) => { if (t) updateTranscript(newId, t); });
    if (correctionEnabledRef.current) {
      const ctx = recentTranscriptsRef.current.slice(-4).map((t) => t.original).join("\n");
      setCorrectingIds((prev) => new Set([...prev, newId]));
      const scene     = detectedSceneRef.current;
      const sceneHint = sceneHintRef.current;
      fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pending, sourceLang: src, targetLang: tgt, context: ctx, scene, sceneHint }),
      })
        .then((r) => r.json())
        .then(({ corrected, translated }: { corrected: string; translated: string }) => {
          if (corrected && corrected !== pending) updateTranscriptOriginal(newId, corrected);
          else setCorrectingIds((prev) => { const n = new Set(prev); n.delete(newId); return n; });
          if (translated) {
            translateCache.current.set(`${src}:${tgt}:${corrected || pending}`, translated);
            updateTranscript(newId, translated);
          }
        })
        .catch(() => setCorrectingIds((prev) => { const n = new Set(prev); n.delete(newId); return n; }));
    }
    // Trigger scene detection at commit #5 and every 10 after that
    const count = ++commitCountRef.current;
    if (count === 5 || (count > 5 && (count - 5) % 10 === 0)) triggerSceneDetection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSceneDetection]);

  // ── Commit a text as a final transcript entry ────────────────────────────────
  const commitEntry = useCallback((text: string, src: LangKey, tgt: LangKey) => {
    if (!text.trim()) return;
    const newId = entryIdRef.current++;
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const cached = translateCache.current.get(`${src}:${tgt}:${text}`);
    addTranscript({ id: newId, original: text, translated: cached ?? "", timestamp });

    const contextText = recentTranscriptsRef.current.slice(-4).map((t) => t.original).join("\n");

    if (correctionEnabledRef.current) {
      setCorrectingIds((prev) => new Set([...prev, newId]));
      fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceLang: src, targetLang: tgt, context: contextText, scene: detectedSceneRef.current, sceneHint: sceneHintRef.current }),
      })
        .then((r) => r.json())
        .then(({ corrected, translated }: { corrected: string; translated: string }) => {
          if (corrected && corrected !== text) updateTranscriptOriginal(newId, corrected);
          else setCorrectingIds((prev) => { const n = new Set(prev); n.delete(newId); return n; });
          if (translated) {
            translateCache.current.set(`${src}:${tgt}:${corrected || text}`, translated);
            updateTranscript(newId, translated);
          } else if (!cached) {
            translate(text, src, tgt).then((t) => updateTranscript(newId, t));
          }
        })
        .catch(() => {
          setCorrectingIds((prev) => { const n = new Set(prev); n.delete(newId); return n; });
          if (!cached) translate(text, src, tgt).then((t) => updateTranscript(newId, t));
        });
    } else if (!cached) {
      translate(text, src, tgt).then((t) => updateTranscript(newId, t));
    }
    const count = ++commitCountRef.current;
    if (count === 5 || (count > 5 && (count - 5) % 10 === 0)) triggerSceneDetection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSceneDetection]);

  // ── Transcribe a blob via Groq Whisper ───────────────────────────────────────
  const transcribeBlob = async (blob: Blob, lang: string, prompt?: string): Promise<string> => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const fd = new FormData();
    fd.append("file", blob, "audio.webm");
    if (lang !== "auto") fd.append("language", lang);  // omit → Whisper auto-detects
    if (prompt) fd.append("prompt", prompt);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${authSession?.access_token ?? ""}` },
        body: fd,
      });
      if (!res.ok) return "";
      const { text } = await res.json();
      return text?.trim() ?? "";
    } catch { return ""; }
  };

  // ── Stop recording ───────────────────────────────────────────────────────────
  const stopRecording = useCallback((intentional = true) => {
    intentionalRef.current = intentional;
    // Whisper mode cleanup
    isWhisperActiveRef.current = false;
    if (whisperBatchTimerRef.current) { clearTimeout(whisperBatchTimerRef.current); whisperBatchTimerRef.current = null; }
    if (whisperRecorderRef.current?.state !== "inactive") whisperRecorderRef.current?.stop();
    whisperRecorderRef.current = null;
    if (reconnectTimer.current)    { clearTimeout(reconnectTimer.current);      reconnectTimer.current = null; }
    if (interimTimer.current)      { clearTimeout(interimTimer.current);        interimTimer.current = null; }
    if (staleInterimTimer.current) { clearTimeout(staleInterimTimer.current);   staleInterimTimer.current = null; }
    if (keepAliveRef.current)      { clearInterval(keepAliveRef.current);        keepAliveRef.current = null; }
    interimAbort.current?.abort();
    // Flush any buffered sentence that hasn't been committed yet
    flushSentenceBuffer();

    // Flush any interim text that was never finalized by Deepgram
    const pending = interimTextRef.current.trim();
    if (pending) {
      const src = sourceLangRef.current;
      const tgt = targetLangRef.current;
      const nid = entryIdRef.current++;
      const ts  = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const ch  = translateCache.current.get(`${src}:${tgt}:${pending}`);
      addTranscript({ id: nid, original: pending, translated: ch ?? "", timestamp: ts });
      if (!ch) translateAny(pending, src, tgt).then((t) => { if (t) updateTranscript(nid, t); });
      interimTextRef.current = "";
    }

    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
        wsRef.current.close(1000, "stopped");
      }
      wsRef.current = null;
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopVolumeMonitor();
    // Save actual recording duration to the session
    setSessions((prev) =>
      prev.map((s) => s.id === currentSidRef.current
        ? { ...s, durationSecs: elapsedSecsRef.current }
        : s
      )
    );
    setIsRecording(false);
    setIsConnecting(false);
    setInterimText("");
    setInterimTrans("");
    setReconnectMsg("");
  }, []);

  useEffect(() => () => stopRecording(true), [stopRecording]);

  // ── Keyboard shortcut: Space = start/stop (skip when focus is in an input) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.code !== "Space") return;
      e.preventDefault();
      if (isRecordingRef.current) stopRecording(true);
      else if (!isConnectingRef.current) startRecording();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRecording]);

  // ── Pause / Resume recording ─────────────────────────────────────────────────
  const pauseRecording = useCallback(() => {
    // Silence the mic track — Deepgram sends nothing, Whisper blob will be tiny
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    // Stop Whisper batching until resume
    if (transcriptionEngineRef.current === "whisper") {
      isWhisperActiveRef.current = false;
      if (whisperBatchTimerRef.current) { clearTimeout(whisperBatchTimerRef.current); whisperBatchTimerRef.current = null; }
      if (whisperRecorderRef.current?.state !== "inactive") whisperRecorderRef.current?.stop();
    }
    setIsPaused(true);
    setInterimText("");
    setInterimTrans("");
  }, []);

  const resumeRecording = useCallback(() => {
    // Re-enable mic track
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = true; });
    // Restart Whisper batching
    if (transcriptionEngineRef.current === "whisper") {
      isWhisperActiveRef.current = true;
      doWhisperBatchRef.current?.();
    }
    setIsPaused(false);
  }, []);

  // ── Start recording ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    setError("");
    // ── Credits check ────────────────────────────────────────────────────────
    if (creditsRemaining !== null && creditsRemaining <= 0) {
      setError("本月录音时长已用完，请在设置中兑换时长码或分享邀请码获取奖励");
      return;
    }
    setIsConnecting(true);
    intentionalRef.current = false;

    // 确保有当前课程（若无则自动创建）
    let sid = currentSidRef.current;
    if (!sid || !sessions.find((s) => s.id === sid)) {
      const s = createSession(sourceLang, targetLang);
      sid = s.id;
    }

    // 切回当前课程视图
    setViewingSessionId(sid);

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();

      // For Whisper mode, skip Deepgram token fetch
      let key: string | null = null;
      if (transcriptionEngineRef.current === "deepgram") {
        const { key: k, error: e } = await fetch("/api/deepgram-token", {
          headers: { Authorization: `Bearer ${authSession?.access_token ?? ""}` },
        }).then((r) => r.json());
        if (e || !k) throw new Error("获取 API Key 失败");
        key = k;
      }

      // Enhanced constraints: browser-level noise suppression before our gate
      const deviceConstraint = selectedDeviceId ? { deviceId: { ideal: selectedDeviceId } } : {};
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...deviceConstraint,
          echoCancellation:  true,
          noiseSuppression:  true,
          autoGainControl:   true,
          channelCount:      1,
          sampleRate:        16000,
        },
      });
      streamRef.current = stream;

      // Re-enumerate after permission grant so device labels become available
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        setAudioDevices(devs.filter((d) => d.kind === "audioinput"));
      }).catch(() => {});

      // Build noise-gate pipeline; use processed stream for recording
      const processedStream = await setupAudioPipeline(stream);

      // ── Whisper batch mode ──────────────────────────────────────────────────
      if (transcriptionEngineRef.current === "whisper") {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
        isWhisperActiveRef.current = true;
        setIsConnecting(false);
        setIsRecording(true);
        setReconnectMsg("");

        const doWhisperBatch = () => {
          const chunksBuf: Blob[] = [];
          const mr = new MediaRecorder(processedStream, { mimeType });
          whisperRecorderRef.current = mr;
          mr.ondataavailable = (e) => { if (e.data.size > 0) chunksBuf.push(e.data); };
          mr.onstop = async () => {
            const blob = new Blob(chunksBuf, { type: mimeType });
            if (blob.size > 3000) {
              setIsWhisperProcessing(true);
              const tgt = targetLangRef.current;
              const contextPrompt = recentTranscriptsRef.current.slice(-3).map((t) => t.original).join(" ");
              const whisperLang = sourceLangRef.current;
              const text = await transcribeBlob(blob, whisperLang, contextPrompt || undefined);
              setIsWhisperProcessing(false);
              if (text) {
                const src = sourceLangRef.current;
                commitEntry(text, src, tgt);
              }
            }
            if (isWhisperActiveRef.current) doWhisperBatch();
          };
          mr.start();
          whisperBatchTimerRef.current = setTimeout(() => {
            if (mr.state !== "inactive") mr.stop();
          }, 8000);
        };
        doWhisperBatchRef.current = doWhisperBatch;

        doWhisperBatch();
        return;
      }

      // ── Deepgram WebSocket mode ─────────────────────────────────────────────
      const params = new URLSearchParams({
        language:        LANGUAGES[sourceLangRef.current].deepgramLang,
        model:           "nova-2",
        punctuate:       "true",
        interim_results: "true",
        smart_format:    "true",
        filler_words:    "false",
        endpointing:     "300",
        diarize:         "true",
      });

      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", key!]);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnecting(false);
        setIsRecording(true);
        setReconnectMsg("");
        reconnectCount.current = 0;

        // Send KeepAlive every 8 s to prevent server-side timeout during silence
        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 8000);

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
        // Record from the noise-gated stream so Deepgram receives clean audio
        const mr = new MediaRecorder(processedStream, { mimeType });
        mediaRecorderRef.current = mr;
        audioChunksRef.current = [];
        if (backupUrl) { URL.revokeObjectURL(backupUrl); setBackupUrl(""); }
        mr.ondataavailable = (ev) => {
          if (ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
            if (ws.readyState === WebSocket.OPEN) ws.send(ev.data);
          }
        };
        mr.onstop = () => {
          if (audioChunksRef.current.length > 0) {
            const blob = new Blob(audioChunksRef.current, { type: mimeType });
            setBackupUrl(URL.createObjectURL(blob));
          }
        };
        mr.start(250);
      };

      ws.onmessage = (event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type !== "Results") return;

        const text = data.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!text) return;

        const curSrc = sourceLangRef.current;
        const curTgt = targetLangRef.current;

        // Extract dominant speaker from words array (diarization)
        const words: { speaker?: number }[] = data.channel?.alternatives?.[0]?.words ?? [];
        const speakerCounts: Record<number, number> = {};
        for (const w of words) {
          if (w.speaker !== undefined) speakerCounts[w.speaker] = (speakerCounts[w.speaker] ?? 0) + 1;
        }
        const speakerEntries = Object.entries(speakerCounts);
        const dominantSpeaker = speakerEntries.length > 0
          ? Number(speakerEntries.sort((a, b) => b[1] - a[1])[0][0])
          : undefined;

        if (data.is_final) {
          // ── Final result: buffer until sentence is complete ───────────────────
          if (interimTimer.current)      { clearTimeout(interimTimer.current);      interimTimer.current = null; }
          if (staleInterimTimer.current) { clearTimeout(staleInterimTimer.current); staleInterimTimer.current = null; }
          interimAbort.current?.abort();
          setInterimText("");
          setInterimTrans("");

          // Use selected source language directly
          const effectiveSrc: LangKey = curSrc;

          // Append to sentence buffer (first segment also records speaker + lang)
          if (!sentenceBufferRef.current) {
            sentenceBufferSrc.current     = effectiveSrc;
            sentenceBufferSpeaker.current = dominantSpeaker;
          }
          sentenceBufferRef.current = sentenceBufferRef.current
            ? sentenceBufferRef.current + " " + text
            : text;

          // Decide whether to flush now or wait for more
          const isSentenceEnd = /[。！？….!?]["'」』]?\s*$/.test(sentenceBufferRef.current);
          const isTooLong     = sentenceBufferRef.current.length > 160;

          if (isSentenceEnd || isTooLong) {
            flushSentenceBuffer();
          } else {
            // Silence timer: flush after 2.5 s of no new is_final
            if (sentenceFlushTimer.current) clearTimeout(sentenceFlushTimer.current);
            sentenceFlushTimer.current = setTimeout(flushSentenceBuffer, 2500);
          }
        } else {
          // ── Interim: show text immediately, translate with 80ms debounce ──
          setInterimText(text);

          // Stale guard: if is_final never comes within 3 s, commit
          if (staleInterimTimer.current) clearTimeout(staleInterimTimer.current);
          staleInterimTimer.current = setTimeout(() => {
            const stale = interimTextRef.current.trim();
            if (!stale) return;
            const src: LangKey = sourceLangRef.current;
            const tgt = targetLangRef.current;
            const sid  = currentSidRef.current;
            if (!sid) return;
            const nid = entryIdRef.current++;
            const ts  = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            const ch  = translateCache.current.get(`${src}:${tgt}:${stale}`);
            addTranscript({ id: nid, original: stale, translated: ch ?? "", timestamp: ts });
            if (!ch) translateAny(stale, src, tgt).then((t) => { if (t) updateTranscript(nid, t); });
            setInterimText("");
            setInterimTrans("");
          }, 3000);

          // Translate interim immediately — local: zero-latency, cloud: abort prev & send now
          if (interimTimer.current) { clearTimeout(interimTimer.current); interimTimer.current = null; }
          interimAbort.current?.abort();
          const cacheKey = `${curSrc}:${curTgt}:${text}`;
          if (translateCache.current.has(cacheKey)) {
            setInterimTrans(translateCache.current.get(cacheKey)!);
          } else {
            doCloudInterim(text, curSrc, curTgt);
          }
        }
      };

      ws.onerror = () => {
        setError("语音识别连接失败，请检查 API Key 和网络。");
        stopRecording(true);
      };

      ws.onclose = (ev) => {
        setIsConnecting(false);
        setInterimText("");
        setInterimTrans("");
        if (ev.code !== 1000 && !intentionalRef.current) {
          const attempt = ++reconnectCount.current;
          if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
          mediaRecorderRef.current = null;
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          stopVolumeMonitor();
          setIsRecording(false);
          if (attempt <= MAX_RECONNECTS) {
            setReconnectMsg(`连接断开，2 秒后自动重连 (${attempt}/${MAX_RECONNECTS})…`);
            reconnectTimer.current = setTimeout(() => { setReconnectMsg(""); startRecording(); }, 2000);
          } else {
            setError("连接多次断开，请手动重新开始上课。");
            reconnectCount.current = 0;
          }
        } else {
          setIsRecording(false);
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "录音启动失败";
      setError(
        msg.includes("Permission denied") || msg.includes("NotAllowedError")
          ? "麦克风权限被拒绝，请在浏览器设置中允许访问麦克风。"
          : msg
      );
      setIsConnecting(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      stopVolumeMonitor();
    }
  };

  // ── Summary ──────────────────────────────────────────────────────────────────
  const generateSummary = async () => {
    if (!viewTranscripts.length) return;
    setIsSummarizing(true);
    // 先清空旧笔记再打开弹窗
    setSessions((prev) =>
      prev.map((s) => (s.id === viewId ? { ...s, summary: "" } : s))
    );
    setShowSummary(true);

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: viewTranscripts.map((t) => t.original).join("\n"),
          language: viewingSession?.sourceLang ?? sourceLang,
        }),
      });
      const { summary } = await res.json();
      setSessions((prev) =>
        prev.map((s) => (s.id === viewId ? { ...s, summary: summary ?? "生成失败，请重试。" } : s))
      );
    } catch {
      setSessions((prev) =>
        prev.map((s) => (s.id === viewId ? { ...s, summary: "生成失败，请重试。" } : s))
      );
    } finally {
      setIsSummarizing(false);
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────────
  const exportSession = (format: "txt" | "md") => {
    const s = viewingSession ?? currentSession;
    if (!s) return;
    const srcInfo = LANGUAGES[s.sourceLang];
    const tgtInfo = LANGUAGES[s.targetLang];
    const dateStr = new Date(s.createdAt).toLocaleString("zh-CN");
    const stem = `lecture-${s.title.replace(/[\s:/]/g, "-")}`;
    let content = "";

    if (format === "md") {
      content = `# ${s.title} 课堂记录\n\n- **日期**：${dateStr}\n- **语言**：${srcInfo.nativeLabel} → ${tgtInfo.nativeLabel}\n\n---\n\n`;
      s.transcripts.forEach((t) => {
        content += `### ${t.timestamp}\n\n**原文**：${t.original}\n\n**译文**：${t.translated}\n\n`;
      });
      if (s.summary) content += `---\n\n## 课堂笔记\n\n${s.summary}\n`;
      if (s.notes?.trim()) content += `\n---\n\n## 快速笔记\n\n${s.notes}\n`;
    } else {
      content = `${s.title} 课堂记录\n日期：${dateStr}\n语言：${srcInfo.nativeLabel} → ${tgtInfo.nativeLabel}\n${"─".repeat(40)}\n\n`;
      s.transcripts.forEach((t) => {
        content += `[${t.timestamp}]\n原：${t.original}\n译：${t.translated}\n\n`;
      });
      if (s.summary) content += `${"─".repeat(40)}\n课堂笔记\n\n${s.summary}\n`;
      if (s.notes?.trim()) content += `${"─".repeat(40)}\n快速笔记\n\n${s.notes}\n`;
    }

    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `${stem}.${format}` }).click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  };

  const printSession = () => {
    const s = viewingSession ?? currentSession;
    if (!s) return;
    const srcInfo = LANGUAGES[s.sourceLang];
    const tgtInfo = LANGUAGES[s.targetLang];
    const dateStr = new Date(s.createdAt).toLocaleString("zh-CN");
    const entries = s.transcripts.map((t) => `
      <div class="entry">
        <div class="time">${t.timestamp}</div>
        <div class="original">${t.original}</div>
        <div class="translated">${t.translated}</div>
      </div>`).join("");
    const summary = s.summary ? `<div class="section"><h2>课堂笔记</h2><pre>${s.summary}</pre></div>` : "";
    const notes   = s.notes?.trim() ? `<div class="section"><h2>快速笔记</h2><pre>${s.notes}</pre></div>` : "";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${s.title} - Mimilang</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1a1a1a}
h1{font-size:1.4rem;margin-bottom:.25rem}.meta{font-size:.85rem;color:#666;margin-bottom:2rem}
.entry{margin-bottom:1.25rem;padding-bottom:1.25rem;border-bottom:1px solid #eee;page-break-inside:avoid}
.time{font-size:.75rem;color:#999;margin-bottom:.25rem;font-family:monospace}
.original{font-size:1rem;margin-bottom:.5rem}.translated{font-size:.95rem;color:#4f46e5;padding-left:1rem;border-left:3px solid #c7d2fe}
.section{margin-top:2rem;padding-top:1.5rem;border-top:2px solid #eee}h2{font-size:1.05rem;margin-bottom:.75rem}
pre{font-family:inherit;white-space:pre-wrap;font-size:.9rem;color:#333}
@media print{@page{margin:2cm}}</style></head><body>
<h1>${s.title}</h1>
<div class="meta">日期：${dateStr}　语言：${srcInfo.nativeLabel} → ${tgtInfo.nativeLabel}</div>
${entries}${summary}${notes}</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
    setShowExport(false);
  };

  // ── Copy ─────────────────────────────────────────────────────────────────────
  const copyText = async (text: string, id?: number) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // 旧版 Safari fallback：使用 execCommand
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
    } catch {}
    if (id !== undefined) { setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); }
    else { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  // ── Language ─────────────────────────────────────────────────────────────────
  /** Heuristic: contains hiragana/katakana → Japanese, else English */
  const detectLangFromText = (text: string): LangKey =>
    /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text) ? "ja" : "en";

  const swapLangs = () => {};  // no-op — source is always ja/en, target is always zh
  const handleSrcChange = (v: string) => { setSourceLang(v as LangKey); };
  const handleTgtChange = (_v: string) => {}; // target is always zh, not user-selectable

  const clearCurrentSession = () => {
    setSessions((prev) =>
      prev.map((s) => (s.id === viewId ? { ...s, transcripts: [], summary: "" } : s))
    );
    setInterimText("");
    setInterimTrans("");
  };

  const deleteSession = (sid: string) => {
    deleteSessionFromDB(sid).catch(() => {});
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sid);
      if (sid === currentSessionId) {
        const last = next[next.length - 1];
        const newId = last?.id ?? "";
        setCurrentSessionId(newId);
        setViewingSessionId(newId);
        currentSidRef.current = newId;
      } else if (sid === viewingSessionId) {
        setViewingSessionId(currentSessionId);
      }
      return next;
    });
  };

  const srcLang = LANGUAGES[viewingSession?.sourceLang ?? sourceLang];
  const tgtLang = LANGUAGES[viewingSession?.targetLang ?? targetLang];
  const busy = isRecording || isConnecting;
  const { cls: textCls, leading } = FONT_SIZES[fontSizeIdx];
  const currentSummary = viewingSession?.summary ?? "";

  // ── JSX ───────────────────────────────────────────────────────────────────────

  if (authLoading) return (
    <div className="flex h-screen bg-[var(--c-bg)] items-center justify-center">
      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <AuthPage />;

  return (
    <div
      className={`flex flex-col h-dvh bg-[var(--c-bg)] text-[var(--c-text)] font-sans theme-transition${theme === "light" ? " light" : ""}`}
      onClick={() => { setShowExport(false); setShowMicPicker(false); setShowSettings(false); }}
    >
      {/* ── Header ── */}
      <header className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-4 h-14 border-b border-white/5 bg-[var(--c-surface)]">

        {/* Left: sessions toggle + logo */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setShowSessionPanel((v) => !v); }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showSessionPanel
                ? "bg-indigo-600/20 text-indigo-400"
                : "text-slate-500 hover:text-slate-200 hover:bg-white/5"
            }`}
            title="课程列表"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
            </svg>
            <span className="hidden sm:inline">课程</span>
            {sessions.length > 0 && (
              <span className="text-[10px] text-slate-600 tabular-nums">{sessions.length}</span>
            )}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-[26px] h-[26px] rounded-[7px] bg-indigo-600 flex items-center justify-center shrink-0">
              <svg width="14" height="11" viewBox="0 0 14 11" fill="white">
                <rect x="0"  y="8" width="2" height="3" rx="1"/>
                <rect x="3"  y="4" width="2" height="7" rx="1"/>
                <rect x="6"  y="0" width="2" height="11" rx="1"/>
                <rect x="9"  y="4" width="2" height="7" rx="1"/>
                <rect x="12" y="8" width="2" height="3" rx="1"/>
              </svg>
            </div>
            <span className="hidden sm:inline text-[15px] font-semibold text-white" style={{ letterSpacing: "-0.4px" }}>Mimilang</span>
          </div>
        </div>

        {/* Center: source language toggle (target is always 中文) */}
        <div className="flex items-center gap-1 bg-[var(--c-card)] rounded-xl px-1 py-1">
          {(["ja", "en"] as LangKey[]).map((lang) => (
            <button
              key={lang}
              onClick={() => !busy && handleSrcChange(lang)}
              disabled={busy}
              className={`px-2 sm:px-3 py-1 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40 ${
                sourceLang === lang
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {LANGUAGES[lang].flag}<span className="hidden sm:inline"> {LANGUAGES[lang].nativeLabel}</span>
            </button>
          ))}
          <span className="text-slate-600 text-xs px-0.5 sm:px-1"><span className="hidden sm:inline">→ </span>中文</span>
        </div>

        {/* Right: recording status + theme + logout */}
        <div className="flex items-center gap-2 justify-end">
          {isConnecting && <span className="hidden sm:inline text-xs text-slate-500 animate-pulse">连接中…</span>}
          {isRecording && (
            <div className="flex items-center gap-2">
              <div ref={volumeBarsRef} className="flex items-end gap-[2px] h-4">
                {[30, 50, 65, 80, 100].map((h, i) => (
                  <div key={i} className="w-[3px] rounded-full transition-colors duration-75"
                    style={{ height: `${h}%`, backgroundColor: "#374151", opacity: 0.18 }} />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
                <span className="text-xs font-mono text-red-400 tabular-nums">{fmtTime(elapsedSecs)}</span>
              </div>
            </div>
          )}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors shrink-0"
          >
            {theme === "dark" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            title={user.email}
            className="text-xs text-slate-600 hover:text-slate-300 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors shrink-0 touch-manipulation"
          >
            <span className="hidden min-[380px]:inline">退出</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="min-[380px]:hidden">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ── Error / reconnect banners ── */}
      {error && (
        <div className="shrink-0 flex items-center justify-between bg-red-950/80 border-b border-red-900/50 px-5 py-2 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-4 text-xl leading-none text-red-500 hover:text-red-200">×</button>
        </div>
      )}
      {reconnectMsg && (
        <div className="shrink-0 flex items-center gap-2 bg-amber-950/80 border-b border-amber-900/50 px-5 py-2 text-sm text-amber-300">
          <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
          {reconnectMsg}
        </div>
      )}
      {!isOnline && (
        <div className="shrink-0 flex items-center gap-2 bg-zinc-900 border-b border-zinc-700 px-5 py-2 text-sm text-zinc-300">
          <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />
          网络已断开，录音无法继续
        </div>
      )}

      {/* ── "正在查看历史课程" banner ── */}
      {!isViewingCurrent && currentSession && (
        <div className="shrink-0 flex items-center justify-between bg-indigo-950/60 border-b border-indigo-900/40 px-5 py-1.5">
          <span className="text-xs text-indigo-400">
            正在查看：<span className="font-semibold">{viewingSession?.title}</span>
          </span>
          <button
            onClick={() => setViewingSessionId(currentSessionId)}
            className="text-xs text-indigo-400 hover:text-indigo-200 underline"
          >
            返回当前课程
          </button>
        </div>
      )}

      {/* ── Main area (history + right sidebar on md+) ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Sessions panel (overlay) — always in DOM, slide via CSS transition */}
        <div
          className={`absolute inset-0 z-30 bg-black/10 backdrop-blur-[2px] transition-opacity duration-200 ${
            showSessionPanel ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
          onClick={() => setShowSessionPanel(false)}
        />
        <div
          className={`absolute left-0 top-0 bottom-0 w-56 bg-[var(--c-surface)] border-r border-white/[0.04] z-40 flex flex-col shadow-2xl transition-transform duration-200 ease-out ${
            showSessionPanel ? "translate-x-0" : "-translate-x-full"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
                <span className="text-xs font-semibold text-slate-400">课程记录</span>
                <button
                  onClick={handleNewSession}
                  disabled={busy}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  新课程
                </button>
              </div>

              {/* Search */}
              <div className="px-3 py-2 border-b border-white/5 shrink-0">
                <input
                  type="text"
                  placeholder="搜索课程…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[var(--c-bg)] border border-white/8 rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>

              {/* Session list */}
              <div className="flex-1 overflow-y-auto">
                {filteredSessions.length === 0 ? (
                  <p className="text-xs text-slate-600 px-4 py-4 text-center">
                    {searchQuery ? "无匹配结果" : "暂无课程记录"}
                  </p>
                ) : (
                  [...filteredSessions].reverse().map((s) => {
                    const isActive = s.id === currentSessionId;
                    const isViewing = s.id === viewId;
                    return (
                      <div key={s.id} className={`group relative border-b border-white/3 ${isViewing ? "bg-indigo-600/10" : "hover:bg-white/4"}`}>
                        <div
                          className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${isViewing ? "border-l-2 border-l-indigo-500" : "border-l-2 border-l-transparent"}`}
                          onClick={() => { setViewingSessionId(s.id); setShowSessionPanel(false); }}
                        >
                          <div className="flex items-center gap-1 mb-0.5 min-w-0 pr-6 md:pr-0">
                            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                            {renamingSessionId === s.id ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => renameSession(s.id, renameValue)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") renameSession(s.id, renameValue);
                                  if (e.key === "Escape") setRenamingSessionId("");
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 text-[13px] font-medium bg-transparent border-b border-indigo-500 text-slate-200 focus:outline-none"
                              />
                            ) : (
                              <>
                                <span
                                  className="text-[13px] text-slate-200 font-medium truncate"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingSessionId(s.id);
                                    setRenameValue(s.title);
                                  }}
                                >{s.title}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRenamingSessionId(s.id); setRenameValue(s.title); }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-700 hover:text-slate-400 shrink-0 ml-0.5"
                                  title="重命名"
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2 pl-3">
                            <span className="text-[10px] text-slate-600">{s.transcripts.length} 条</span>
                            {s.summary && <span className="text-[10px] text-indigo-500">有笔记</span>}
                            <span className="text-[10px] text-slate-700">{LANGUAGES[s.sourceLang].flag}→{LANGUAGES[s.targetLang].flag}</span>
                          </div>
                        </div>
                        {/* Delete button */}
                        {!isActive && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 active:text-red-400 p-2.5 touch-manipulation"
                            title="删除此课程"
                          >
                            <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

        {/* ── History panel (scrollable, user can freely browse) ── */}
        <div
          ref={historyScrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-5 xl:px-16 2xl:px-28 space-y-5 min-w-0 relative lg:max-w-[calc(100%-288px)]"
          onScroll={() => {
            const el = historyScrollRef.current;
            if (!el) return;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            setUserScrolledUp(!nearBottom);
          }}
        >
          {viewTranscripts.length === 0 ? (
            <EmptyState text={isViewingCurrent ? "点击「开始上课」开始实时转写" : "此课程暂无转写记录"} />
          ) : (
            viewTranscripts.map((t) => (
              <div key={t.id} className="group relative">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-700 tabular-nums font-mono">{t.timestamp}</span>
                  {t.speaker !== undefined && (() => {
                    const sc = SPEAKER_COLORS[t.speaker % SPEAKER_COLORS.length];
                    return (
                      <span className={`flex items-center gap-1 text-[9px] ${sc.text}`}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: sc.dot }} />
                        {sc.label}
                      </span>
                    );
                  })()}
                  {correctionEnabled && correctingIds.has(t.id) && (
                    <span className="flex items-center gap-1 text-[9px] text-indigo-500/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500/70 animate-pulse shrink-0" />
                      AI处理中
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); copyText(`${t.original}\n${t.translated}`, t.id); }}
                    className="ml-auto opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-2 md:p-1 text-slate-600 hover:text-slate-300 active:text-slate-200 touch-manipulation"
                  >
                    {copiedId === t.id ? (
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" className="text-green-400">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className={`${textCls} ${leading} text-slate-200`}>{t.original}</p>
                <div className="mt-1 pl-3 border-l-2 border-indigo-500/25">
                  {t.translated
                    ? <p className={`${textCls} ${leading} text-indigo-300/80`}>{t.translated}</p>
                    : (
                      <button
                        onClick={() => retranslate(t.id, t.original)}
                        className="text-[12px] text-slate-600 hover:text-indigo-400 italic transition-colors"
                      >
                        翻译失败，点击重试
                      </button>
                    )
                  }
                </div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />

          {/* Jump-to-latest button (shown when user scrolled up during recording) */}
          {isViewingCurrent && isRecording && userScrolledUp && (
            <button
              onClick={() => {
                setUserScrolledUp(false);
                transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full shadow-xl transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              跳到最新
            </button>
          )}
        </div>

        {/* ── Right sidebar (md+ only) ── */}
        <div className="hidden lg:flex flex-col w-72 shrink-0 border-l border-white/5 bg-[var(--c-bg)] overflow-hidden">

          {/* Live section */}
          <div className="shrink-0 border-b border-white/5 p-4 min-h-[120px]">
            <div className="flex items-center gap-2 mb-3">
              {isRecording && isViewingCurrent ? (
                <>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  <span className="text-[10px] text-red-400 font-mono uppercase tracking-wider">实时</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-slate-700 shrink-0" />
                  <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider">待机</span>
                </>
              )}
            </div>
            {isViewingCurrent && interimText ? (
              <>
                <p className={`${textCls} ${leading} text-slate-200 leading-snug`}>{interimText}</p>
                <div className="mt-2 pl-3 border-l-2 border-indigo-500/30">
                  <p className={`${textCls} ${leading} text-indigo-300/80 leading-snug`}>
                    {interimTrans || <span className="text-slate-600 italic text-[13px]">翻译中…</span>}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-slate-600 italic">
                {isRecording && isViewingCurrent ? "等待语音…" : "开始上课后显示实时内容"}
              </p>
            )}
          </div>

          {/* Session stats */}
          <div className="shrink-0 border-b border-white/5 p-4">
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-3">课堂统计</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-slate-500">时长</span>
                <span className="text-[12px] font-mono text-slate-300 tabular-nums">
                  {isRecording && isViewingCurrent
                    ? fmtTime(elapsedSecs)
                    : viewingSession?.durationSecs != null
                      ? fmtTime(viewingSession.durationSecs)
                      : "—"
                  }
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-slate-500">条数</span>
                <span className="text-[12px] font-mono text-slate-300 tabular-nums">{viewTranscripts.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-slate-500">字数</span>
                <span className="text-[12px] font-mono text-slate-300 tabular-nums">
                  {viewTranscripts.reduce((n, t) => n + t.original.length, 0)}
                </span>
              </div>
              {viewingSession?.summary && (
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-500">笔记</span>
                  <span className="text-[10px] text-indigo-400">已生成 ✓</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick notes */}
          <div className="flex flex-col flex-1 p-4 min-h-0">
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2 shrink-0">快速笔记</p>
            <textarea
              value={viewingSession?.notes ?? ""}
              onChange={(e) => updateSessionNotes(e.target.value)}
              placeholder="在这里记录要点、疑问…"
              className="flex-1 bg-[var(--c-surface)] border border-white/5 rounded-lg p-3 text-[13px] text-slate-300 placeholder-slate-700 resize-none focus:outline-none focus:border-indigo-500/50 leading-relaxed"
            />
          </div>

          {/* Usage stats */}
          {sessions.length > 0 && (() => {
            const totalMins = Math.round(sessions.reduce((n, s) => n + (s.durationSecs ?? 0), 0) / 60);
            const totalEntries = sessions.reduce((n, s) => n + s.transcripts.length, 0);
            return (
              <div className="shrink-0 border-t border-white/5 p-4">
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-3">我的用量</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-500">总课程</span>
                    <span className="text-[12px] font-mono text-slate-300 tabular-nums">{sessions.length} 节</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-500">总录音</span>
                    <span className="text-[12px] font-mono text-slate-300 tabular-nums">{totalMins} 分钟</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-500">总转写</span>
                    <span className="text-[12px] font-mono text-slate-300 tabular-nums">{totalEntries} 条</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Live strip (mobile only, only during active recording) ── */}
      {isViewingCurrent && isRecording && (
        <div className="lg:hidden shrink-0 border-t border-indigo-500/20 bg-[var(--c-bg-deep)] px-5 py-3 min-h-[56px] max-h-40">
          <div className="flex items-center gap-2 mb-1.5">
            {isPaused ? (
              <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">已暂停</span>
            ) : (
              <>
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isWhisperProcessing ? "bg-purple-400" : "bg-red-400"}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isWhisperProcessing ? "bg-purple-500" : "bg-red-500"}`} />
                </span>
                <span className={`text-[10px] font-mono uppercase tracking-wider ${isWhisperProcessing ? "text-purple-400" : "text-red-400"}`}>
                  {transcriptionEngine === "whisper" ? (isWhisperProcessing ? "识别中…" : "录音中") : "实时"}
                </span>
              </>
            )}
          </div>
          {isPaused ? (
            <p className="text-sm text-slate-600 italic">点击「继续」恢复录音</p>
          ) : transcriptionEngine === "whisper" ? (
            <p className="text-sm text-slate-600 italic">
              {isWhisperProcessing ? "正在识别本段语音…" : "每8秒自动识别一次"}
            </p>
          ) : interimText ? (
            <>
              <p className={`${textCls} ${leading} text-slate-300`}>{interimText}</p>
              <div className="mt-1 pl-3 border-l-2 border-indigo-500/30">
                <p className={`${textCls} ${leading} text-indigo-300/70`}>
                  {interimTrans || <span className="text-slate-600 italic">翻译中…</span>}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600 italic">等待语音输入…</p>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div
        className="shrink-0 border-t border-white/5 bg-[var(--c-surface)] mobile-footer-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile secondary controls row */}
        <div className="flex lg:hidden items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.04] overflow-x-auto scrollbar-none">
          {/* 清空 */}
          <button onClick={clearCurrentSession} disabled={viewTranscripts.length === 0 || isRecording}
            className="w-10 h-9 flex items-center justify-center rounded-lg text-slate-500 disabled:opacity-20 disabled:cursor-not-allowed active:bg-white/5 touch-manipulation shrink-0"
            title="清空"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          </button>

          {/* 导出 */}
          <div className="relative shrink-0">
            <button onClick={(e) => { e.stopPropagation(); setShowExport((v) => !v); }} disabled={viewTranscripts.length === 0}
              className="w-10 h-9 flex items-center justify-center rounded-lg text-slate-500 disabled:opacity-20 active:bg-white/5 touch-manipulation"
              title="导出"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
            </button>
            {showExport && (
              <div className="absolute bottom-full mb-2 left-0 bg-[var(--c-card)] border border-white/10 rounded-xl py-1.5 shadow-xl w-32 z-10">
                <button onClick={() => exportSession("txt")} className="w-full text-left px-4 py-2.5 text-xs text-slate-300 active:bg-white/5">导出 .txt</button>
                <button onClick={() => exportSession("md")}  className="w-full text-left px-4 py-2.5 text-xs text-slate-300 active:bg-white/5">导出 .md</button>
                <button onClick={printSession}               className="w-full text-left px-4 py-2.5 text-xs text-slate-300 active:bg-white/5">打印 / PDF</button>
                {backupUrl && (
                  <a href={backupUrl} download={`recording-${viewingSession?.title ?? "backup"}.webm`}
                    className="block px-4 py-2.5 text-xs text-emerald-400 active:bg-white/5"
                    onClick={() => setShowExport(false)}
                  >录音备份</a>
                )}
              </div>
            )}
          </div>

          {/* 设置 */}
          <button onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v); }}
            className={`flex items-center gap-1 h-9 px-2 rounded-lg text-xs transition-colors touch-manipulation shrink-0 ${showSettings ? "text-slate-300 bg-white/5" : "text-slate-500 active:bg-white/5"}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            设置
          </button>

          <span className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

          {/* 字号 */}
          <button onClick={() => setFontSizeIdx((i) => Math.max(0, i - 1))} disabled={fontSizeIdx === 0}
            className="w-8 h-9 flex items-center justify-center rounded-lg text-[11px] font-bold text-slate-500 active:bg-white/5 disabled:opacity-20 shrink-0 touch-manipulation"
          >A</button>
          <button onClick={() => setFontSizeIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))} disabled={fontSizeIdx === FONT_SIZES.length - 1}
            className="w-8 h-9 flex items-center justify-center rounded-lg text-[13px] font-bold text-slate-500 active:bg-white/5 disabled:opacity-20 shrink-0 touch-manipulation"
          >A</button>

          <span className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

          {/* 笔记 */}
          <button onClick={() => setShowMobileNotes(true)}
            className="w-10 h-9 flex items-center justify-center rounded-lg text-slate-500 active:bg-white/5 transition-colors shrink-0 touch-manipulation"
            title="笔记"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
          </button>
        </div>

        {/* Main row */}
        <div className="flex items-center justify-between px-5 py-3">
          {/* Left: secondary controls (desktop only) */}
          <div className="hidden lg:flex items-center gap-3 flex-1">
            <button onClick={clearCurrentSession} disabled={viewTranscripts.length === 0 || isRecording}
              className="text-xs text-slate-600 hover:text-slate-400 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            >清空</button>

            {/* Export */}
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowExport((v) => !v); }} disabled={viewTranscripts.length === 0}
                className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >导出
                <svg width="8" height="8" viewBox="0 0 20 20" fill="currentColor" className={`transition-transform ${showExport ? "rotate-180" : ""}`}><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
              {showExport && (
                <div className="absolute bottom-full mb-2 left-0 bg-[var(--c-card)] border border-white/10 rounded-lg py-1 shadow-xl w-28 z-10">
                  <button onClick={() => exportSession("txt")} className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">导出 .txt</button>
                  <button onClick={() => exportSession("md")}  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">导出 .md</button>
                  <button onClick={printSession}               className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">打印 / PDF</button>
                  {backupUrl && (
                    <a href={backupUrl} download={`recording-${viewingSession?.title ?? "backup"}.webm`}
                      className="block px-3 py-1.5 text-xs text-emerald-400 hover:bg-white/5"
                      onClick={() => setShowExport(false)}
                    >录音备份 .webm</a>
                  )}
                </div>
              )}
            </div>

            {/* Settings gear */}
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v); }}
                className={`flex items-center gap-1 text-xs transition-colors ${showSettings ? "text-slate-300" : "text-slate-600 hover:text-slate-400"}`}
                title="设置"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                <span>设置</span>
              </button>
              {showSettings && (
                <div className="absolute bottom-full mb-2 left-0 bg-[var(--c-card)] border border-white/10 rounded-xl p-3 shadow-xl w-64 z-10" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">设置</p>

                  {/* Transcription engine */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[12px] text-slate-300">识别引擎</p>
                      <p className="text-[10px] text-slate-600">{transcriptionEngine === "deepgram" ? "低延迟，实时显示" : "高准确率，句末输出"}</p>
                    </div>
                    <div className="flex gap-1">
                      <button disabled={isRecording} onClick={() => setTranscriptionEngine("deepgram")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 ${transcriptionEngine === "deepgram" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}`}
                      >实时</button>
                      <button disabled={isRecording} onClick={() => setTranscriptionEngine("whisper")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 ${transcriptionEngine === "whisper" ? "bg-purple-600/80 text-white" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}`}
                      >精准</button>
                    </div>
                  </div>

                  {/* AI enhancement */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[12px] text-slate-300">AI 增强</p>
                      <p className="text-[10px] text-slate-600">识别纠错 + 翻译优化</p>
                    </div>
                    <button onClick={() => setCorrectionEnabled((v) => !v)}
                      className={`relative w-9 h-5 rounded-full transition-colors flex items-center shrink-0 ${correctionEnabled ? "bg-indigo-600" : "bg-slate-700"}`}
                    >
                      <span className={`absolute w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${correctionEnabled ? "left-[18px]" : "left-[2px]"}`} />
                    </button>
                  </div>

                  {/* Microphone */}
                  <div className="pt-2.5 border-t border-white/5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">麦克风</p>
                    <button disabled={isRecording} onClick={() => { setSelectedDeviceId(""); try { localStorage.setItem(LS_PREFS, JSON.stringify({ fontSizeIdx, translationMode, selectedDeviceId: "" })); } catch {} }}
                      className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors mb-0.5 disabled:opacity-40 ${!selectedDeviceId ? "text-emerald-400" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}`}
                    >系统默认</button>
                    {audioDevices.map((d) => (
                      <button key={d.deviceId} disabled={isRecording}
                        onClick={() => { setSelectedDeviceId(d.deviceId); try { localStorage.setItem(LS_PREFS, JSON.stringify({ fontSizeIdx, translationMode, selectedDeviceId: d.deviceId })); } catch {} }}
                        className={`w-full text-left px-2 py-1 rounded text-[11px] truncate transition-colors mb-0.5 disabled:opacity-40 ${selectedDeviceId === d.deviceId ? "text-emerald-400" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}`}
                        title={d.label || d.deviceId}
                      >{d.label || `麦克风 ${d.deviceId.slice(0, 8)}…`}</button>
                    ))}
                    {audioDevices.length === 0 && <p className="px-2 text-[11px] text-slate-700 italic">开始上课后显示</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile spacer */}
          <div className="lg:hidden flex-1" />

          {/* Center */}
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-2">
            {!isRecording ? (
              <button onClick={startRecording} disabled={isConnecting || !isOnline} title="开始上课 (Space)"
                className="btn-record flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 disabled:opacity-50 text-white rounded-full text-sm font-semibold transition-all border border-indigo-400/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_rgba(99,102,241,0.4)] touch-manipulation"
              >
                <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                {isConnecting ? "连接中…" : "开始上课"}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={isPaused ? resumeRecording : pauseRecording} title={isPaused ? "继续上课" : "暂停"}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[var(--c-glass)] hover:bg-[var(--c-glass-hover)] border border-[var(--c-glass-border)] text-slate-300 rounded-full text-sm font-semibold transition-all backdrop-blur-sm touch-manipulation"
                >
                  {isPaused ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  )}
                  {isPaused ? "继续" : "暂停"}
                </button>
                <button onClick={() => stopRecording(true)} title="结束上课 (Space)"
                  className="btn-stop flex items-center gap-2 px-5 py-2 bg-red-700 hover:bg-red-600 active:scale-95 text-white rounded-full text-sm font-semibold transition-all border border-red-400/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_24px_rgba(239,68,68,0.3)] touch-manipulation"
                >
                  <span className="w-2 h-2 rounded bg-white/80 shrink-0" />
                  结束上课
                </button>
              </div>
            )}
            <button onClick={generateSummary} disabled={viewTranscripts.length === 0 || isSummarizing}
              className="flex items-center gap-2 px-3 sm:px-5 py-2 bg-[var(--c-glass)] hover:bg-[var(--c-glass-hover)] border border-[var(--c-glass-border)] disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 rounded-full text-sm font-semibold transition-all backdrop-blur-sm touch-manipulation"
              title="课堂笔记"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span className="hidden sm:inline">{isSummarizing ? "生成中…" : "课堂笔记"}</span>
              {isSummarizing && <span className="sm:hidden">…</span>}
            </button>
            </div>
            <span className="hidden lg:block text-[10px] text-slate-700 font-mono">Space</span>
          </div>

          {/* Right: font size (desktop) + notes button (mobile) */}
          <div className="flex items-center gap-1 flex-1 justify-end">
            <div className="hidden lg:flex items-center gap-1">
              <span className="text-[10px] text-slate-700 mr-1">字号</span>
              <button onClick={() => setFontSizeIdx((i) => Math.max(0, i - 1))} disabled={fontSizeIdx === 0}
                className="w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold text-slate-500 hover:text-slate-200 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
              >A</button>
              <div className="flex gap-0.5 px-1">
                {FONT_SIZES.map((_, i) => (
                  <div key={i} className={`w-1 h-1 rounded-full transition-colors ${i === fontSizeIdx ? "bg-indigo-400" : "bg-slate-700"}`} />
                ))}
              </div>
              <button onClick={() => setFontSizeIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))} disabled={fontSizeIdx === FONT_SIZES.length - 1}
                className="w-6 h-6 flex items-center justify-center rounded text-[13px] font-bold text-slate-500 hover:text-slate-200 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
              >A</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile Notes Sheet ── */}
      {showMobileNotes && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setShowMobileNotes(false)}>
          <div
            className="absolute inset-x-0 bottom-0 bg-[var(--c-surface)] border-t border-white/8 rounded-t-2xl p-4 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 shrink-0">
              <span className="text-sm font-semibold text-slate-300">笔记 & 统计</span>
              <button onClick={() => setShowMobileNotes(false)} className="text-slate-500 hover:text-slate-200 text-xl p-1 leading-none">×</button>
            </div>
            <div className="flex gap-5 mb-3 shrink-0">
              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-0.5">录音时长</p>
                <p className="text-sm font-mono text-slate-300">
                  {isRecording && isViewingCurrent ? fmtTime(elapsedSecs) : viewingSession?.durationSecs != null ? fmtTime(viewingSession.durationSecs) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-0.5">条数</p>
                <p className="text-sm font-mono text-slate-300">{viewTranscripts.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-0.5">字数</p>
                <p className="text-sm font-mono text-slate-300">{viewTranscripts.reduce((n, t) => n + t.original.length, 0)}</p>
              </div>
            </div>
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2 shrink-0">快速笔记</p>
            <textarea
              value={viewingSession?.notes ?? ""}
              onChange={(e) => updateSessionNotes(e.target.value)}
              placeholder="在这里记录要点、疑问…"
              className="flex-1 bg-[var(--c-bg)] border border-white/5 rounded-lg p-3 text-[13px] text-slate-300 placeholder-slate-700 resize-none focus:outline-none focus:border-indigo-500/50 leading-relaxed min-h-[120px]"
            />
            {sessions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5 shrink-0">
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2">我的用量</p>
                <div className="flex gap-5">
                  <div>
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-0.5">总课程</p>
                    <p className="text-sm font-mono text-slate-300">{sessions.length} 节</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-0.5">总录音</p>
                    <p className="text-sm font-mono text-slate-300">
                      {Math.round(sessions.reduce((n, s) => n + (s.durationSecs ?? 0), 0) / 60)} 分钟
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-0.5">总转写</p>
                    <p className="text-sm font-mono text-slate-300">
                      {sessions.reduce((n, s) => n + s.transcripts.length, 0)} 条
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mobile Settings Sheet ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setShowSettings(false)}>
          <div
            className="absolute inset-x-0 bottom-0 bg-[var(--c-surface)] border-t border-white/8 rounded-t-2xl px-5 py-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 拖拽把手 */}
            <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-5">
              <span className="text-[15px] font-semibold text-slate-200">设置</span>
              <button onClick={() => setShowSettings(false)} className="text-slate-500 text-xl p-1 leading-none active:text-slate-200">×</button>
            </div>

            {/* 识别引擎 */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[13px] text-slate-300 font-medium">识别引擎</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {transcriptionEngine === "deepgram" ? "低延迟，实时显示" : "高准确率，句末输出"}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0 ml-4">
                <button disabled={isRecording} onClick={() => setTranscriptionEngine("deepgram")}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40 touch-manipulation ${transcriptionEngine === "deepgram" ? "bg-indigo-600 text-white" : "text-slate-500 bg-white/5 active:bg-white/10"}`}
                >实时</button>
                <button disabled={isRecording} onClick={() => setTranscriptionEngine("whisper")}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40 touch-manipulation ${transcriptionEngine === "whisper" ? "bg-purple-600/80 text-white" : "text-slate-500 bg-white/5 active:bg-white/10"}`}
                >精准</button>
              </div>
            </div>

            {/* AI 增强 */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[13px] text-slate-300 font-medium">AI 增强</p>
                <p className="text-[11px] text-slate-600 mt-0.5">识别纠错 + 翻译优化</p>
              </div>
              <button onClick={() => setCorrectionEnabled((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors flex items-center shrink-0 ml-4 touch-manipulation ${correctionEnabled ? "bg-indigo-600" : "bg-slate-700"}`}
              >
                <span className={`absolute w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${correctionEnabled ? "left-[22px]" : "left-[2px]"}`} />
              </button>
            </div>

            {/* 麦克风 */}
            <div className="pt-4 border-t border-white/5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">麦克风</p>
              <button disabled={isRecording}
                onClick={() => { setSelectedDeviceId(""); try { localStorage.setItem(LS_PREFS, JSON.stringify({ fontSizeIdx, translationMode, selectedDeviceId: "" })); } catch {} }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] transition-colors mb-1 disabled:opacity-40 touch-manipulation ${!selectedDeviceId ? "text-emerald-400 bg-emerald-500/10" : "text-slate-500 active:bg-white/5"}`}
              >系统默认</button>
              {audioDevices.map((d) => (
                <button key={d.deviceId} disabled={isRecording}
                  onClick={() => { setSelectedDeviceId(d.deviceId); try { localStorage.setItem(LS_PREFS, JSON.stringify({ fontSizeIdx, translationMode, selectedDeviceId: d.deviceId })); } catch {} }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] truncate transition-colors mb-1 disabled:opacity-40 touch-manipulation ${selectedDeviceId === d.deviceId ? "text-emerald-400 bg-emerald-500/10" : "text-slate-500 active:bg-white/5"}`}
                  title={d.label || d.deviceId}
                >{d.label || `麦克风 ${d.deviceId.slice(0, 8)}…`}</button>
              ))}
              {audioDevices.length === 0 && (
                <p className="px-3 text-[12px] text-slate-700 italic">开始上课后显示</p>
              )}
            </div>

            {/* ── 时长 & 邀请 ── */}
            <div className="pt-4 border-t border-white/5 mt-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">我的时长</p>

              {/* Balance */}
              {creditsRemaining !== null ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] text-slate-300">本月剩余</span>
                    <span className={`text-[13px] font-mono font-semibold ${creditsRemaining <= 10 ? "text-red-400" : creditsRemaining <= 30 ? "text-amber-400" : "text-emerald-400"}`}>
                      {creditsRemaining} 分钟
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${creditsRemaining <= 10 ? "bg-red-500" : creditsRemaining <= 30 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, (creditsRemaining / 120) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1">每月重置 120 分钟</p>
                </div>
              ) : (
                <div className="h-8 flex items-center mb-4">
                  <div className="w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full animate-spin mr-2" />
                  <span className="text-[12px] text-slate-600">加载中…</span>
                </div>
              )}

              {/* Invite code */}
              {referralCode && (
                <div className="mb-4">
                  <p className="text-[11px] text-slate-500 mb-1.5">我的邀请码
                    <span className="text-slate-700 ml-1">（好友填写后，对方+60分钟，你+30分钟）</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-mono text-sm text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-2 tracking-widest">
                      {referralCode}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(referralCode).then(() => {
                          setInviteCopied(true);
                          setTimeout(() => setInviteCopied(false), 2000);
                        }).catch(() => {});
                      }}
                      className="px-3 py-2 rounded-lg text-[12px] bg-white/5 active:bg-white/10 text-slate-400 touch-manipulation shrink-0"
                    >
                      {inviteCopied ? "✓ 已复制" : "复制"}
                    </button>
                  </div>
                </div>
              )}

              {/* Redeem code */}
              <div>
                <p className="text-[11px] text-slate-500 mb-1.5">兑换时长码</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="输入邀请码或兑换码"
                    value={redeemInput}
                    onChange={(e) => { setRedeemInput(e.target.value.toUpperCase()); setRedeemMsg(null); }}
                    maxLength={20}
                    className="flex-1 bg-[var(--c-bg)] border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono tracking-wider"
                  />
                  <button
                    disabled={redeemLoading || !redeemInput.trim()}
                    onClick={async () => {
                      setRedeemLoading(true);
                      setRedeemMsg(null);
                      const { data } = await supabase.auth.getSession();
                      const token = data.session?.access_token;
                      if (!token) { setRedeemMsg({ ok: false, text: "请先登录" }); setRedeemLoading(false); return; }
                      const res = await fetch("/api/credits/redeem", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ code: redeemInput.trim() }),
                      });
                      const d = await res.json();
                      if (res.ok) {
                        setRedeemMsg({ ok: true, text: d.message });
                        setCreditsRemaining(d.minutesRemaining);
                        setRedeemInput("");
                      } else {
                        setRedeemMsg({ ok: false, text: d.error || "兑换失败" });
                      }
                      setRedeemLoading(false);
                    }}
                    className="px-3 py-2 rounded-lg text-[12px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white touch-manipulation shrink-0"
                  >
                    {redeemLoading ? "…" : "兑换"}
                  </button>
                </div>
                {redeemMsg && (
                  <p className={`text-[12px] mt-1.5 ${redeemMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {redeemMsg.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Summary Modal ── */}
      {showSummary && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSummary(false); }}
        >
          <div className="bg-[var(--c-surface)] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">📚</span>
                <div>
                  <h2 className="text-[15px] font-semibold text-white leading-tight">课堂笔记</h2>
                  {viewingSession && (
                    <p className="text-[11px] text-slate-600">{viewingSession.title}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setShowSummary(false)} className="text-slate-500 hover:text-slate-200 text-xl leading-none p-1">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {isSummarizing ? (
                <div className="flex flex-col items-center justify-center h-32 gap-4">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-slate-500">Gemini 正在生成课堂笔记…</span>
                </div>
              ) : (
                <SummaryRenderer text={currentSummary} />
              )}
            </div>

            {!isSummarizing && currentSummary && (
              <div className="px-6 py-3 border-t border-white/5 shrink-0 flex items-center justify-between">
                <button
                  onClick={() => copyText(currentSummary)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {copied ? "✓ 已复制" : "复制到剪贴板"}
                </button>
                <div className="flex items-center gap-1.5 text-xs text-slate-700">
                  <span>{srcLang.flag} {srcLang.nativeLabel}</span>
                  <span>→</span>
                  <span>{tgtLang.flag} {tgtLang.nativeLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LangSelect({ value, exclude, onChange, disabled, allowAuto = false }: {
  value: string; exclude?: LangKey; onChange: (v: string) => void; disabled: boolean; allowAuto?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="appearance-none bg-transparent text-[13px] font-medium text-slate-200 pl-2 pr-6 py-1 rounded-lg cursor-pointer focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5 transition-colors"
      >
        {allowAuto && (
          <option value="auto" className="bg-[var(--c-card)]">🌐 自动</option>
        )}
        {ALL_LANGS.filter((k) => k !== exclude).map((k) => (
          <option key={k} value={k} className="bg-[var(--c-card)]">
            {LANGUAGES[k].flag} {LANGUAGES[k].nativeLabel}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 select-none pt-16">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-700">
        <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
        <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
        <line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
      <p className="text-sm text-slate-600">{text}</p>
    </div>
  );
}

function SummaryRenderer({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="space-y-1 text-sm">
      {text.split("\n").map((line, i) => {
        if (line.startsWith("## ")) return (
          <h2 key={i} className="text-[15px] font-semibold text-white mt-6 mb-2 first:mt-0">{line.slice(3)}</h2>
        );
        if (line.startsWith("### ")) return (
          <h3 key={i} className="text-[13px] font-semibold text-slate-300 mt-4 mb-1">{line.slice(4)}</h3>
        );
        if (line.startsWith("- ") || line.startsWith("* ")) return (
          <p key={i} className="text-slate-300 leading-relaxed pl-4 flex gap-2">
            <span className="text-indigo-500 shrink-0 mt-0.5">·</span>
            <span><InlineFmt text={line.slice(2)} /></span>
          </p>
        );
        const nm = line.match(/^(\d+)\.\s(.*)$/);
        if (nm) return (
          <p key={i} className="text-slate-300 leading-relaxed pl-4 flex gap-2">
            <span className="text-indigo-500 font-mono text-xs shrink-0 mt-1 tabular-nums">{nm[1]}.</span>
            <span><InlineFmt text={nm[2]} /></span>
          </p>
        );
        if (line.startsWith("---") || line.startsWith("===")) return <hr key={i} className="border-white/5 my-4" />;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i} className="text-slate-300 leading-relaxed"><InlineFmt text={line} /></p>;
      })}
    </div>
  );
}

function InlineFmt({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

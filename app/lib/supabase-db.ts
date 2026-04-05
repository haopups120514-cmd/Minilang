import { supabase } from "./supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSessionsFromDB(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id:           row.id,
    title:        row.title,
    createdAt:    row.created_at,
    sourceLang:   row.source_lang,
    targetLang:   row.target_lang,
    transcripts:  row.transcripts,
    summary:      row.summary,
    notes:        row.notes,
    durationSecs: row.duration_secs ?? undefined,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveSessionsToDB(sessions: any[], userId: string): Promise<void> {
  if (sessions.length === 0) return;
  const rows = sessions.map((s) => ({
    id:           s.id,
    user_id:      userId,
    title:        s.title,
    created_at:   s.createdAt,
    source_lang:  s.sourceLang,
    target_lang:  s.targetLang,
    transcripts:  s.transcripts,
    summary:      s.summary,
    notes:        s.notes,
    duration_secs: s.durationSecs ?? null,
  }));
  const { error } = await supabase.from("sessions").upsert(rows);
  if (error) throw error;
}

export async function deleteSessionFromDB(id: string): Promise<void> {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw error;
}

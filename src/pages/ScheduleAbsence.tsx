import { useState, type FormEvent } from "react";
import { PRAYER_SLOTS, SLOT_LABELS, type PrayerSlot } from "@shared/constants";
import { Field, Sheet, useAction } from "../components/ui";
import { api } from "../lib/api";
import { todayIso } from "../lib/format";
import { useFetch } from "../lib/hooks";

export const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export interface ScheduleEntry { id?: string; circleId?: string; circleName?: string; weekday: number; slot: PrayerSlot | ""; start: string; end: string; place: string }

/** نص الموعد: «مغرباً» إن كان بصلاة، وإلا «16:00 – 18:00». */
export const slotText = (e: ScheduleEntry): string => (e.slot ? SLOT_LABELS[e.slot] : `${e.start} – ${e.end}`);

/** جدول الحلقة (للقراءة): أيام وأوقات ومكان. */
export function ScheduleCard({ studentId }: { studentId?: string } = {}) {
  const { data } = useFetch<{ entries: ScheduleEntry[] }>(`/api/schedule${studentId ? `?studentId=${studentId}` : ""}`);
  if (!data?.entries.length) return null;
  return (
    <section className="card">
      <h3>جدول الحلقة</h3>
      <div className="list" style={{ marginTop: 6, gap: 4 }}>
        {data.entries.map((e, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{WEEKDAYS[e.weekday]}</b><span dir={e.slot ? "rtl" : "ltr"}>{slotText(e)}</span><span className="muted">{e.place}</span></div>)}
      </div>
    </section>
  );
}

interface Notice { id: string; date: string; reason: string }

/** إبلاغ غياب من ولي الأمر: تاريخ وسبب، ويصل المحفّظ إشعار. */
export function AbsenceReport({ studentId }: { studentId?: string } = {}) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useFetch<{ notices: Notice[] }>(`/api/absences/mine${studentId ? `?studentId=${studentId}` : ""}`);
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => api("/api/absences", { method: "POST", body: { date: f.get("date"), reason: f.get("reason"), ...(studentId ? { studentId } : {}) } }), "أُرسل الإبلاغ إلى المحفّظ")) { setOpen(false); void reload(); }
  };
  return (
    <section className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}><h3 style={{ flex: 1 }}>إبلاغ غياب</h3><button className="btn small" type="button" onClick={() => setOpen(true)}>إبلاغ جديد</button></div>
      {data?.notices.slice(0, 3).map((n) => <div key={n.id} className="muted" style={{ fontSize: ".9rem" }}>{n.date} — {n.reason}</div>)}
      {open && (
        <Sheet title="إبلاغ عن غياب" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={submit}>
            <Field label="تاريخ الغياب" hint="من اليوم وحتى 30 يوماً قادماً"><input name="date" type="date" min={todayIso()} defaultValue={todayIso()} required /></Field>
            <Field label="السبب"><textarea name="reason" required minLength={2} maxLength={300} placeholder="مثال: موعد طبي" /></Field>
            <button className="btn" disabled={busy}>إرسال إلى المحفّظ</button>
          </form>
        </Sheet>
      )}
    </section>
  );
}

/** محرّر جدول حلقة (للمدير والسكرتير). */
export function ScheduleEditor({ circleId, circleName, onClose }: { circleId: string; circleName: string; onClose: () => void }) {
  const { data } = useFetch<{ entries: ScheduleEntry[] }>(`/api/schedule?circleId=${circleId}`);
  const [rows, setRows] = useState<ScheduleEntry[] | null>(null);
  const { busy, run } = useAction();
  const list = rows ?? data?.entries ?? [];
  const set = (i: number, patch: Partial<ScheduleEntry>) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    const entries = list.map((r) => ({ weekday: r.weekday, slot: r.slot ?? "", start: r.start, end: r.end, place: r.place }));
    if (await run(() => api(`/api/schedule/${circleId}`, { method: "PUT", body: { entries } }), "تم حفظ الجدول")) onClose();
  };
  return (
    <Sheet title={`جدول ${circleName}`} onClose={onClose}>
      <div className="list">
        {list.map((r, i) => (
          <div key={i} className="card form-grid">
            <div className="form-grid two">
              <Field label="اليوم"><select value={r.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, k) => <option key={d} value={k}>{d}</option>)}</select></Field>
              <Field label="المكان"><input value={r.place} onChange={(e) => set(i, { place: e.target.value })} maxLength={80} /></Field>
            </div>
            <Field label="نوع الموعد">
              <select value={r.slot ?? ""} onChange={(e) => set(i, { slot: e.target.value as PrayerSlot | "" })}>
                <option value="">بالساعات (من — إلى)</option>
                {PRAYER_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
              </select>
            </Field>
            {!r.slot && (
              <div className="form-grid two">
                <Field label="من"><input type="time" value={r.start} onChange={(e) => set(i, { start: e.target.value })} /></Field>
                <Field label="إلى"><input type="time" value={r.end} onChange={(e) => set(i, { end: e.target.value })} /></Field>
              </div>
            )}
            <button className="btn ghost danger small" type="button" onClick={() => setRows(list.filter((_, j) => j !== i))}>حذف الموعد</button>
          </div>
        ))}
        {!list.length && <div className="empty">لا توجد مواعيد.</div>}
      </div>
      <button className="btn ghost small" type="button" disabled={list.length >= 14} onClick={() => setRows([...list, { weekday: 0, slot: "", start: "16:00", end: "18:00", place: "" }])}>＋ إضافة موعد</button>
      <button className="btn" type="button" disabled={busy} onClick={() => void save()}>حفظ الجدول</button>
    </Sheet>
  );
}

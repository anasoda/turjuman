import { useEffect, useState, type FormEvent } from "react";
import { ROLE_LABELS, type Role } from "@shared/constants";
import { Field, Sheet, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useMe } from "../lib/session";
import { fmtDay, monthIso, todayIso } from "../lib/format";
import { useFetch } from "../lib/hooks";
import { outboxAll, subscribeSync } from "../lib/offline";

type Status = "present" | "absent" | "late" | "excused";
const STATUS: Record<Status, string> = { present: "حاضر", late: "متأخر", excused: "بعذر", absent: "غائب" };
/** الحالتان اللتان تتطلبان ملاحظة (قرار المالك): سبب العذر وملاحظة التأخر. */
const NEEDS_NOTE: Status[] = ["excused", "late"];
const NOTE_LABEL: Partial<Record<Status, string>> = { excused: "سبب العذر", late: "ملاحظة التأخر" };
const NOTE_HINT: Partial<Record<Status, string>> = { excused: "مثال: مراجعة طبية", late: "مثال: تأخر 15 دقيقة لظرف طارئ" };

interface DayRow { id: string; name: string; role: Role; status: Status | null; note: string | null; pending?: boolean }
interface SumRow { id: string; name: string; role: Role; present: number; absent: number; late: number; excused: number }

/** حضور الكادر (المدير والسكرتير)، ومعلّمو مرحلته لمدير المرحلة (§15.3): تسجيل يومي وملخص شهري. */
export function StaffAttendance() {
  const { user } = useMe();
  const [date, setDate] = useState(todayIso());
  const [tab, setTab] = useState<"day" | "month">("day");
  const [month, setMonth] = useState(monthIso());
  const day = useFetch<{ rows: DayRow[] }>(tab === "day" ? `/api/staff-attendance?date=${date}` : null);
  const sum = useFetch<{ rows: SumRow[] }>(tab === "month" ? `/api/staff-attendance/summary?month=${month}` : null);
  const { run } = useAction();
  const [noteFor, setNoteFor] = useState<{ row: DayRow; status: Status } | null>(null);
  const [pendingMonth, setPendingMonth] = useState(false);
  useEffect(() => {
    const load = () => { void outboxAll().then((items) => setPendingMonth(items.some((item) => item.userId === user.id && item.status !== "rejected" && item.path === "/api/staff-attendance" && String((item.body as { date?: string }).date).startsWith(month)))); };
    load();
    return subscribeSync(load);
  }, [month, user.id]);

  const save = async (r: DayRow, status: Status, note: string) => {
    const ok = await run(() => api("/api/staff-attendance", { method: "POST", body: { userId: r.id, date, status, note } }));
    if (ok) void day.reload();
    return ok;
  };

  /** «بعذر» و«متأخر» يفتحان ورقة الملاحظة؛ «حاضر» و«غائب» يُحفظان مباشرة. */
  const pick = (r: DayRow, s: Status) => {
    if (NEEDS_NOTE.includes(s)) setNoteFor({ row: r, status: s });
    else void save(r, s, "");
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>{user.role === "stage_manager" ? "حضور معلمي مرحلتي" : "حضور الكادر"}</h1><p>{tab === "day" ? fmtDay(date) : month}</p></div></div>
      <div className="tabs" role="tablist">
        <button type="button" aria-pressed={tab === "day"} onClick={() => setTab("day")}>اليومي</button>
        <button type="button" aria-pressed={tab === "month"} onClick={() => setTab("month")}>الملخص الشهري</button>
      </div>
      {tab === "day" ? <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} aria-label="التاريخ" /> : <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value || monthIso())} aria-label="الشهر" />}
      {(day.error || sum.error) && <div className="error-box">{day.error || sum.error}</div>}
      {tab === "month" && pendingMonth && <div className="notice-box">الملخص الشهري لا يشمل سجلات الحضور التي تنتظر المزامنة بعد.</div>}
      <div className="list">
        {tab === "day" && day.data?.rows.map((r) => (
          <div key={r.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{r.name}</b><span className="chip gold">{ROLE_LABELS[r.role]}</span>{r.pending && <span className="chip">بانتظار المزامنة</span>}</div>
            <div className="radio-row" style={{ marginTop: 8 }} role="radiogroup" aria-label={`حضور ${r.name}`}>
              {(Object.keys(STATUS) as Status[]).map((s) => (
                <label key={s} style={{ minWidth: 70, padding: "6px 10px" }}><input type="radio" name={`st-${r.id}`} checked={r.status === s} onChange={() => pick(r, s)} />{STATUS[s]}</label>
              ))}
            </div>
            {r.status && NEEDS_NOTE.includes(r.status) && (
              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <small className="muted">{NOTE_LABEL[r.status]}: {r.note || "—"}</small>
                <button className="btn ghost small" type="button" onClick={() => setNoteFor({ row: r, status: r.status as Status })}>تعديل الملاحظة</button>
              </div>
            )}
          </div>
        ))}
        {tab === "month" && sum.data?.rows.map((r) => (
          <div key={r.id} className="card">
            <b>{r.name}</b> <span className="chip gold">{ROLE_LABELS[r.role]}</span>
            <div className="muted" style={{ fontSize: ".9rem" }}>حضور {r.present} · تأخر {r.late} · بعذر {r.excused} · غياب {r.absent}</div>
          </div>
        ))}
        {tab === "day" && day.data && !day.data.rows.length && <div className="empty">لا يوجد كادر لتسجيل حضوره.</div>}
      </div>
      {noteFor && (
        <NoteSheet
          name={noteFor.row.name}
          status={noteFor.status}
          current={noteFor.row.status === noteFor.status ? noteFor.row.note ?? "" : ""}
          onClose={() => setNoteFor(null)}
          onSave={async (note) => {
            if (await save(noteFor.row, noteFor.status, note)) setNoteFor(null);
          }}
        />
      )}
    </main>
  );
}

/** ورقة الملاحظة الإلزامية لحالتي «بعذر» و«متأخر» (لا نوافذ prompt — قاعدة 6). */
function NoteSheet({ name, status, current, onClose, onSave }: { name: string; status: Status; current: string; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const { busy } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onSave(String(new FormData(e.currentTarget).get("note") ?? "").trim());
  };
  return (
    <Sheet title={`${STATUS[status]}: ${name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label={NOTE_LABEL[status] ?? "ملاحظة"} hint="تُحفظ مع السجل وتظهر في كشف اليوم">
          <textarea name="note" required minLength={2} maxLength={200} defaultValue={current} placeholder={NOTE_HINT[status]} />
        </Field>
        <button className="btn" disabled={busy}>حفظ</button>
      </form>
    </Sheet>
  );
}

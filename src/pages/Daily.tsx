import { useMemo, useState, type FormEvent } from "react";
import type { Direction } from "@shared/constants";
import { countPages, countVerses, isValidRange, mushafPageFor, type Position } from "@shared/quran";
import { PositionPicker } from "../components/PositionPicker";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { ATTENDANCE_LABELS, fmtDay, fmtPos, todayIso, type Attendance } from "../lib/format";
import { initials, useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle } from "../lib/types";

interface BoardStudent { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number; nextStart: Position | null }
interface DailyRecord {
  id: string; studentId: string; date: string; attendance: Attendance; direction: Direction;
  fromSurah: number | null; fromAyah: number | null; toSurah: number | null; toAyah: number | null;
  verses: number; pages: number; grade: string; note: string;
}
interface Board { date: string; circleId: string | null; circleName?: string; rows: Array<{ student: BoardStudent; record: DailyRecord | null; absenceNotice: string | null }> }

/** التسميع اليومي: لوحة طلاب الحلقة ليوم محدد، والضغط على طالب يفتح نموذج الحضور والتسميع. */
export function Daily() {
  const { user } = useMe();
  const isTeacher = user.role === "teacher";
  // /api/circles محصورة بالدور أصلاً، فالمعلّم يستقبل حلقاته هو — ومنها يختار (§15.5)
  const circles = useFetch<{ circles: Circle[] }>("/api/circles");
  const [circleId, setCircleId] = useState("");
  const [date, setDate] = useState(todayIso());
  // مدير المرحلة قد يدرّس حلقة (§15.3أ): تُفتح لوحته على حلقته هو أولاً ثم أول حلقة فعّالة
  const active = circles.data?.circles.filter((c) => c.active) ?? [];
  const mine = active.find((c) => c.primaryTeacherId === user.id || c.assistantTeacherId === user.id);
  const effectiveCircle = circleId || mine?.id || active[0]?.id || "";
  const path = effectiveCircle ? `/api/daily/board?date=${date}&circleId=${effectiveCircle}` : null;
  const noCircle = !!circles.data && !active.length;
  const board = useFetch<Board>(path);
  const [editing, setEditing] = useState<{ student: BoardStudent; record: DailyRecord | null } | null>(null);
  const rows = board.data?.rows ?? [];
  const done = rows.filter((r) => r.record).length;

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>التسميع اليومي</h1><p>{board.data?.circleName ? `${board.data.circleName} · ` : ""}{fmtDay(date)} · سُجّل {done} من {rows.length}</p></div>
      </div>
      <div className="search-row">
        <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} aria-label="التاريخ" />
        {active.length > 1 && (
          <select className="input" value={effectiveCircle} onChange={(e) => setCircleId(e.target.value)} aria-label="الحلقة">
            {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      {board.error && <div className="error-box">{board.error}</div>}
      <div className="list">
        {rows.map(({ student, record, absenceNotice }) => (
          <button key={student.id} type="button" className="card row-card" onClick={() => setEditing({ student, record })}>
            <span className="avatar">{initials(student.name)}</span>
            <span className="grow">
              <b>{student.name}</b>
              {record ? (
                <small>
                  {record.attendance === "absent" ? "غائب" : `${fmtPos(record.fromSurah ? { surah: record.fromSurah, ayah: record.fromAyah! } : null)} ← ${fmtPos(record.toSurah ? { surah: record.toSurah, ayah: record.toAyah! } : null)} · ${record.pages} ص`}
                  {record.grade ? ` · ${record.grade}` : ""}
                </small>
              ) : <small>{student.nextStart ? `يبدأ من ${fmtPos(student.nextStart)}` : "أتمّ المسار"}</small>}
              {absenceNotice && <small style={{ color: "var(--gold)" }}>أبلغ ولي الأمر عن غيابه: {absenceNotice}</small>}
            </span>
            <span className={`chip ${record ? (record.attendance === "absent" ? "off" : "") : "gold"}`}>{record ? ATTENDANCE_LABELS[record.attendance] : "لم يُسجَّل"}</span>
          </button>
        ))}
        {!board.loading && !rows.length && <div className="empty">{noCircle ? (isTeacher ? "لم تُسنَد إليك حلقة بعد." : "لا توجد حلقات فعّالة.") : "لا يوجد طلاب في هذه الحلقة."}</div>}
      </div>
      {editing && <DailyForm date={date} student={editing.student} record={editing.record} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void board.reload(); }} />}
    </main>
  );
}

function DailyForm({ date, student, record, onClose, onSaved }: { date: string; student: BoardStudent; record: DailyRecord | null; onClose: () => void; onSaved: () => void }) {
  const { settings } = useMe();
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const dir = student.direction;
  const initialFrom: Position = record?.fromSurah ? { surah: record.fromSurah, ayah: record.fromAyah! } : student.nextStart ?? { surah: student.lastSurah, ayah: Math.max(1, student.lastAyah) };
  const initialTo: Position = record?.toSurah ? { surah: record.toSurah, ayah: record.toAyah! } : initialFrom;
  const [attendance, setAttendance] = useState<Attendance>(record?.attendance ?? "present");
  const [from, setFrom] = useState<Position>(initialFrom);
  const [to, setTo] = useState<Position>(initialTo);
  const [grade, setGrade] = useState(record?.grade ?? "");
  const [note, setNote] = useState(record?.note ?? "");

  const attends = attendance !== "absent";
  const valid = !attends || isValidRange(dir, from, to);
  const calc = useMemo(() => (attends && valid ? { verses: countVerses(dir, from, to), pages: countPages(dir, from, to) } : null), [attends, valid, dir, from, to]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { studentId: student.id, date, attendance, from: attends ? from : null, to: attends ? to : null, grade: attends ? grade : "", note };
    if (await run(() => api("/api/daily", { method: "POST", body }), "تم حفظ السجل")) onSaved();
  };
  const remove = async () => {
    if (!record || !(await confirm({ title: "حذف سجل اليوم؟", confirmLabel: "حذف", danger: true }))) return;
    if (await run(() => api(`/api/daily/${record.id}`, { method: "DELETE" }), "تم الحذف")) onSaved();
  };

  return (
    <Sheet title={student.name} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="radio-row" role="radiogroup" aria-label="الحضور">
          {(Object.keys(ATTENDANCE_LABELS) as Attendance[]).map((a) => (
            <label key={a}><input type="radio" name="attendance" checked={attendance === a} onChange={() => setAttendance(a)} />{ATTENDANCE_LABELS[a]}</label>
          ))}
        </div>
        {attends && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>{dir === "descending" ? "اتجاه الحفظ: من الناس إلى الفاتحة" : "اتجاه الحفظ: من الفاتحة إلى الناس"} — البداية مقترحة تلقائياً بعد آخر ما حفظه.</p>
            <PositionPicker label="من" value={from} onChange={setFrom} />
            <PositionPicker label="إلى" value={to} onChange={setTo} />
            {!valid ? <div className="error-box">النهاية يجب ألا تسبق البداية وفق اتجاه حفظ الطالب.</div> : calc && (
              <div className="card" style={{ background: "var(--green-soft)" }}>
                <b>{calc.verses} آية · {calc.pages} صفحة</b>
                <div className="muted" style={{ fontSize: ".85rem" }}>من صفحة {mushafPageFor(from.surah, from.ayah)} إلى صفحة {mushafPageFor(to.surah, to.ayah)} (مصحف المدينة)</div>
              </div>
            )}
            <Field label="التقييم">
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">بلا تقييم</option>
                {settings.recitationGrades.map((g) => <option key={g}>{g}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="ملاحظة لولي الأمر (اختياري)"><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        <div className="actions">
          <button className="btn" disabled={busy || !valid}>{record ? "حفظ التعديل" : "حفظ"}</button>
          {record && <button className="btn ghost danger" type="button" onClick={() => void remove()}>حذف السجل</button>}
        </div>
      </form>
    </Sheet>
  );
}

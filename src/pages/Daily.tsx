import { useMemo, useState, type FormEvent } from "react";
import type { Direction } from "@shared/constants";
import { countPages, countVerses, isValidRange, mushafPageFor, nextStart, rangeDirection, type Position } from "@shared/quran";
import { PositionPicker } from "../components/PositionPicker";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { ATTENDANCE_LABELS, fmtDay, fmtPos, todayIso, type Attendance } from "../lib/format";
import { initials, useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle } from "../lib/types";

interface BoardStudent { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number; monthlyReviewPlanPages: number; nextStart: Position | null; reviewNext: Position | null; reviewLast: Position | null }
interface DailyRecord {
  id: string; studentId: string; date: string; attendance: Attendance; direction: Direction;
  fromSurah: number | null; fromAyah: number | null; toSurah: number | null; toAyah: number | null;
  verses: number; pages: number; grade: string; note: string;
  reviewFromSurah: number | null; reviewFromAyah: number | null; reviewToSurah: number | null; reviewToAyah: number | null; reviewPages: number; reviewGrade: string; pending?: boolean;
  nextMemorizeFromSurah: number | null; nextMemorizeFromAyah: number | null; nextMemorizeToSurah: number | null; nextMemorizeToAyah: number | null;
  nextReviewFromSurah: number | null; nextReviewFromAyah: number | null; nextReviewToSurah: number | null; nextReviewToAyah: number | null; nextNote: string;
}
interface Board { date: string; circleId: string | null; circleName?: string; scheduled?: boolean; rows: Array<{ student: BoardStudent; record: DailyRecord | null; absenceNotice: string | null }> }

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
      {board.data?.circleId && board.data.scheduled === false && (
        <div className="notice-box" style={{ marginBottom: 12 }}>تنبيه: هذا اليوم ليس من جدول الحلقة. يمكنك التسجيل إن كانت حصة تعويضية أو إضافية.</div>
      )}
      <div className="list">
        {rows.map(({ student, record, absenceNotice }) => (
          <button key={student.id} type="button" className="card row-card" onClick={() => setEditing({ student, record })}>
            <span className="avatar">{initials(student.name)}</span>
            <span className="grow">
              <b>{student.name}</b>
              {record?.pending && <small>بانتظار المزامنة</small>}
              {record ? (
                <>
                  <small>
                    {record.attendance === "absent" ? "غائب" : record.attendance === "excused" ? `بعذر: ${record.note}` : record.fromSurah
                      ? `حفظ: ${fmtPos({ surah: record.fromSurah, ayah: record.fromAyah! })} ← ${fmtPos(record.toSurah ? { surah: record.toSurah, ayah: record.toAyah! } : null)} · ${record.pages} ص`
                      : "بلا حفظ جديد"}
                    {record.grade ? ` · ${record.grade}` : ""}
                  </small>
                  {record.reviewFromSurah && (record.attendance === "present" || record.attendance === "late") && (
                    <small>مراجعة: {fmtPos({ surah: record.reviewFromSurah, ayah: record.reviewFromAyah! })} ← {fmtPos({ surah: record.reviewToSurah!, ayah: record.reviewToAyah! })} · {record.reviewPages} ص{record.reviewGrade ? ` · ${record.reviewGrade}` : ""}</small>
                  )}
                  {record.nextMemorizeFromSurah && (
                    <small>المطلوب القادم (حفظ): {fmtPos({ surah: record.nextMemorizeFromSurah, ayah: record.nextMemorizeFromAyah! })} ← {fmtPos({ surah: record.nextMemorizeToSurah!, ayah: record.nextMemorizeToAyah! })}</small>
                  )}
                  {record.nextReviewFromSurah && (
                    <small>المطلوب القادم (مراجعة): {fmtPos({ surah: record.nextReviewFromSurah, ayah: record.nextReviewFromAyah! })} ← {fmtPos({ surah: record.nextReviewToSurah!, ayah: record.nextReviewToAyah! })}</small>
                  )}
                </>
              ) : <small>{student.nextStart ? `يبدأ من ${fmtPos(student.nextStart)}` : "أتمّ المسار"}{student.reviewNext ? ` · المراجعة من ${fmtPos(student.reviewNext)}` : ""}</small>}
              {absenceNotice && <small style={{ color: "var(--gold)" }}>أبلغ ولي الأمر عن غيابه: {absenceNotice}</small>}
            </span>
            <span className={`chip ${record ? (record.attendance === "absent" ? "off" : record.attendance === "present" ? "" : "gold") : "gold"}`}>{record ? ATTENDANCE_LABELS[record.attendance] : "لم يُسجَّل"}</span>
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
  const start = dir === "descending" ? 114 : 1;
  const hadReview = !!record?.reviewFromSurah;
  const initialFrom: Position = record?.fromSurah ? { surah: record.fromSurah, ayah: record.fromAyah! } : student.nextStart ?? { surah: student.lastSurah, ayah: Math.max(1, student.lastAyah) };
  const initialTo: Position = record?.toSurah ? { surah: record.toSurah, ayah: record.toAyah! } : initialFrom;
  // المراجعة: بداية اليوم مقترحة من نهاية آخر مراجعة، وللمحفّظ تغييرها بحرية
  const rInitFrom: Position = hadReview ? { surah: record!.reviewFromSurah!, ayah: record!.reviewFromAyah! } : student.reviewNext ?? { surah: start, ayah: 1 };
  const rInitTo: Position = hadReview ? { surah: record!.reviewToSurah!, ayah: record!.reviewToAyah! } : rInitFrom;
  const hadNextMemorize = !!record?.nextMemorizeFromSurah;
  const hadNextReview = !!record?.nextReviewFromSurah;
  const nMemInitFrom: Position = hadNextMemorize ? { surah: record!.nextMemorizeFromSurah!, ayah: record!.nextMemorizeFromAyah! } : nextStart(dir, initialTo) ?? initialTo;
  const nMemInitTo: Position = hadNextMemorize ? { surah: record!.nextMemorizeToSurah!, ayah: record!.nextMemorizeToAyah! } : nMemInitFrom;
  const nRevInitFrom: Position = hadNextReview ? { surah: record!.nextReviewFromSurah!, ayah: record!.nextReviewFromAyah! } : nextStart(dir, rInitTo) ?? rInitTo;
  const nRevInitTo: Position = hadNextReview ? { surah: record!.nextReviewToSurah!, ayah: record!.nextReviewToAyah! } : nRevInitFrom;
  const [attendance, setAttendance] = useState<Attendance>(record?.attendance ?? "present");
  const [doHifz, setDoHifz] = useState(record ? !!record.fromSurah || !hadReview : true);
  const [doReview, setDoReview] = useState(record ? hadReview : student.monthlyReviewPlanPages > 0);
  const [doNextMemorize, setDoNextMemorize] = useState(hadNextMemorize);
  const [doNextReview, setDoNextReview] = useState(hadNextReview);
  const [from, setFrom] = useState<Position>(initialFrom);
  const [to, setTo] = useState<Position>(initialTo);
  const [rFrom, setRFrom] = useState<Position>(rInitFrom);
  const [rTo, setRTo] = useState<Position>(rInitTo);
  const [nMemFrom, setNMemFrom] = useState<Position>(nMemInitFrom);
  const [nMemTo, setNMemTo] = useState<Position>(nMemInitTo);
  const [nRevFrom, setNRevFrom] = useState<Position>(nRevInitFrom);
  const [nRevTo, setNRevTo] = useState<Position>(nRevInitTo);
  const [nNote, setNNote] = useState(record?.nextNote ?? "");
  const [grade, setGrade] = useState(record?.grade ?? "");
  const [rGrade, setRGrade] = useState(record?.reviewGrade ?? "");
  const [note, setNote] = useState(record?.note ?? "");

  const attends = attendance === "present" || attendance === "late";
  const needsNote = attendance === "excused" || attendance === "late";
  const noteOk = !needsNote || note.trim().length >= 2;
  const hifzValid = !attends || !doHifz || isValidRange(dir, from, to);
  const rDir = rangeDirection(dir, rFrom, rTo);
  const reviewValid = !attends || !doReview || rDir !== null;
  const nMemValid = !doNextMemorize || isValidRange(dir, nMemFrom, nMemTo);
  const nRevDir = rangeDirection(dir, nRevFrom, nRevTo);
  const nRevValid = !doNextReview || nRevDir !== null;
  const nextValid = !attends || (nMemValid && nRevValid);
  const nothing = attends && !doHifz && !doReview;
  const valid = hifzValid && reviewValid && nextValid && !nothing;
  const calc = useMemo(() => (attends && doHifz && hifzValid ? { verses: countVerses(dir, from, to), pages: countPages(dir, from, to) } : null), [attends, doHifz, hifzValid, dir, from, to]);
  const rCalc = useMemo(() => (attends && doReview && rDir ? { verses: countVerses(rDir, rFrom, rTo), pages: countPages(rDir, rFrom, rTo) } : null), [attends, doReview, rDir, rFrom, rTo]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      studentId: student.id, date, attendance,
      from: attends && doHifz ? from : null, to: attends && doHifz ? to : null, grade: attends && doHifz ? grade : "",
      review: attends && doReview ? { from: rFrom, to: rTo, grade: rGrade } : null,
      next: attends && (doNextMemorize || doNextReview) ? {
        memorize: doNextMemorize ? { from: nMemFrom, to: nMemTo } : null,
        review: doNextReview ? { from: nRevFrom, to: nRevTo } : null,
        note: nNote
      } : null,
      note
    };
    if (await run(() => api("/api/daily", { method: "POST", body }), "تم حفظ السجل")) onSaved();
  };
  const remove = async () => {
    if (!record || !(await confirm({ title: "حذف سجل اليوم؟", confirmLabel: "حذف", danger: true }))) return;
    if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`/api/daily/${record.id}`, { method: "DELETE" }), "حذف")) onSaved();
  };
  const gradeSelect = (value: string, set: (v: string) => void) => (
    <Field label="التقييم">
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">بلا تقييم</option>
        {settings.recitationGrades.map((g) => <option key={g}>{g}</option>)}
      </select>
    </Field>
  );

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
            <section className="card" style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={doReview} onChange={(e) => setDoReview(e.target.checked)} style={{ width: 18, height: 18 }} />المراجعة (تُسجَّل أولاً)
              </label>
              {doReview && (
                <>
                  <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>
                    {student.reviewLast ? `آخر مراجعة انتهت عند ${fmtPos(student.reviewLast)}؛ البداية مقترحة بعدها ويمكنك تغييرها.` : "أول مراجعة مسجَّلة: اختر بداية المراجعة ونهايتها."}
                  </p>
                  <PositionPicker label="من" value={rFrom} onChange={setRFrom} />
                  <PositionPicker label="إلى" value={rTo} onChange={setRTo} />
                  {!reviewValid ? <div className="error-box">نهاية المراجعة تسبق بدايتها.</div> : rCalc && (
                    <div className="card" style={{ background: "var(--green-soft)" }}><b>{rCalc.verses} آية · {rCalc.pages} صفحة</b></div>
                  )}
                  {gradeSelect(rGrade, setRGrade)}
                </>
              )}
            </section>
            <section className="card" style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={doHifz} onChange={(e) => setDoHifz(e.target.checked)} style={{ width: 18, height: 18 }} />الحفظ الجديد
              </label>
              {doHifz && (
                <>
                  <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>{dir === "descending" ? "اتجاه الحفظ: من الناس إلى الفاتحة" : "اتجاه الحفظ: من الفاتحة إلى الناس"} — البداية مقترحة تلقائياً بعد آخر ما حفظه.</p>
                  <PositionPicker label="من" value={from} onChange={setFrom} />
                  <PositionPicker label="إلى" value={to} onChange={setTo} />
                  {!hifzValid ? <div className="error-box">النهاية يجب ألا تسبق البداية وفق اتجاه حفظ الطالب.</div> : calc && (
                    <div className="card" style={{ background: "var(--green-soft)" }}>
                      <b>{calc.verses} آية · {calc.pages} صفحة</b>
                      <div className="muted" style={{ fontSize: ".85rem" }}>من صفحة {mushafPageFor(from.surah, from.ayah)} إلى صفحة {mushafPageFor(to.surah, to.ayah)} (مصحف المدينة)</div>
                    </div>
                  )}
                  {gradeSelect(grade, setGrade)}
                </>
              )}
            </section>
            {nothing && <div className="error-box">فعّل المراجعة أو الحفظ الجديد (واحداً على الأقل).</div>}
            <section className="card" style={{ display: "grid", gap: 10 }}>
              <b>المطلوب في اللقاء القادم</b>
              <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>يمكن تحديد حفظ ومراجعة معاً؛ يُرسَل إشعاراً فورياً لولي الأمر بما هو مطلوب من الطالب في اللقاء القادم.</p>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={doNextMemorize} onChange={(e) => setDoNextMemorize(e.target.checked)} style={{ width: 18, height: 18 }} />حفظ
              </label>
              {doNextMemorize && (
                <>
                  <PositionPicker label="من" value={nMemFrom} onChange={setNMemFrom} />
                  <PositionPicker label="إلى" value={nMemTo} onChange={setNMemTo} />
                  {!nMemValid && <div className="error-box">نهاية حفظ اللقاء القادم يجب ألا تسبق بدايته وفق اتجاه حفظ الطالب.</div>}
                </>
              )}
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={doNextReview} onChange={(e) => setDoNextReview(e.target.checked)} style={{ width: 18, height: 18 }} />مراجعة
              </label>
              {doNextReview && (
                <>
                  <PositionPicker label="من" value={nRevFrom} onChange={setNRevFrom} />
                  <PositionPicker label="إلى" value={nRevTo} onChange={setNRevTo} />
                  {!nRevValid && <div className="error-box">نهاية مراجعة اللقاء القادم تسبق بدايتها.</div>}
                </>
              )}
              {(doNextMemorize || doNextReview) && (
                <Field label="ملاحظة لولي الأمر (اختياري)"><textarea value={nNote} onChange={(e) => setNNote(e.target.value)} maxLength={300} /></Field>
              )}
            </section>
          </>
        )}
        <Field label={attendance === "excused" ? "سبب العذر (إجباري)" : attendance === "late" ? "سبب التأخر (إجباري)" : "ملاحظة لولي الأمر (اختياري)"}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <div className="actions">
          <button className="btn" disabled={busy || !valid || !noteOk}>{record ? "حفظ التعديل" : "حفظ"}</button>
          {record && !record.pending && <button className="btn ghost danger" type="button" onClick={() => void remove()}>حذف السجل</button>}
        </div>
      </form>
    </Sheet>
  );
}

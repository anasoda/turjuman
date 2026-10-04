import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api, SYNC_UPDATED_EVENT } from "../lib/api";
import { TEST_STATUS_LABELS, TEST_TYPE_LABELS, todayIso } from "../lib/format";
import { examQuestionScore, examRangeDetails, examTotalScore, type ExamRange } from "@shared/exams";
import { SURAHS } from "@shared/quran-data";
import { useDebounced, useFetch, useUrlPage, useUrlState } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";
import { countAr, PARTS_AR } from "../lib/format";

interface TestRow {
  id: string; studentId: string; studentName: string; circleName: string | null; kind: "trial" | "official"; status: string;
  testType: string; parts: number; rangeText: string; testDate: string | null; score: number | null; passed: number | null;
  notes: string; proposedByName: string | null; decidedByName: string | null; sessionId: string | null;
  pending?: boolean;
}

const TABS: Array<[string, string]> = [["", "الكل"], ["proposed", "مقترحة"], ["approved", "معتمدة"], ["completed", "منتهية"], ["rejected", "مرفوضة"]];

/** الاختبارات: تجريبي يسجّله المحفّظ، ورسمي يقترحه المحفّظ فتعتمده لجنة الاختبار وتسجّل نتيجته. */
export function Tests() {
  const { user, settings } = useMe();
  const canPropose = user.role === "admin" || user.role === "secretary" || user.role === "teacher" || user.role === "stage_manager";
  const canDecide = user.role === "admin" || user.role === "exam_committee";
  const canDelete = user.role === "admin" || user.role === "secretary" || user.role === "teacher";
  const [status, setStatus] = useUrlState("status", user.role === "exam_committee" ? "proposed" : "");
  const [q, setQ] = useUrlState("q");
  const dq = useDebounced(q);
  const [items, setItems] = useState<TestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useUrlPage();
  const [sheet, setSheet] = useState<"" | "trial" | "propose">("");
  const [decide, setDecide] = useState<{ t: TestRow; mode: "approve" | "reject" } | null>(null);
  const [sessionTest, setSessionTest] = useState<TestRow | null>(null);
  const { confirm } = useUi();
  const { run } = useAction();

  const load = useCallback(async (p: number, replace: boolean) => {
    const r = await api<{ tests: TestRow[]; total: number }>(`/api/tests?page=${p}&status=${status}&q=${encodeURIComponent(dq)}`);
    setItems((prev) => (replace ? r.tests : [...prev, ...r.tests]));
    setTotal(r.total);
    setPage(p);
  }, [status, dq]);
  useEffect(() => { void load(1, true); }, [load]);
  useEffect(() => {
    const refreshAfterSync = () => { void load(1, true); };
    window.addEventListener(SYNC_UPDATED_EVENT, refreshAfterSync);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, refreshAfterSync);
  }, [load]);
  const refresh = () => void load(1, true);

  const remove = async (t: TestRow) => {
    if (!(await confirm({ title: `حذف اختبار ${t.studentName}؟`, confirmLabel: "حذف", danger: true }))) return;
    if (await run(() => api(`/api/tests/${t.id}`, { method: "DELETE" }), "تم الحذف")) refresh();
  };
  const canRemove = (t: TestRow) => canDelete && (user.role !== "teacher" || t.kind === "trial" || t.status === "proposed");
  const openSession = async (t: TestRow) => {
    if (t.status === "approved") {
      const started = await run(() => api(`/api/tests/${t.id}/session`, { method: "POST" }), "تم فتح جلسة الاختبار");
      if (!started) return;
    }
    setSessionTest(t);
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>الاختبارات</h1><p>{total} اختباراً · أدنى نجاح {settings.minPassScore}</p></div></div>
      {canPropose && (
        <div className="actions">
          <button className="btn small" type="button" onClick={() => setSheet("propose")}>اقتراح اختبار رسمي</button>
          <button className="btn ghost small" type="button" onClick={() => setSheet("trial")}>تسجيل اختبار تجريبي</button>
        </div>
      )}
      <div className="tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{label}</button>)}</div>
      <input className="input" placeholder="ابحث باسم الطالب أو نطاق الاختبار" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      <div className="list">
        {items.map((t) => (
          <div key={t.id} className="card">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ flex: 1 }}>{t.studentName}</b>
              <span className="chip gold">{t.kind === "trial" ? "تجريبي" : "رسمي"}</span>
              <span className={`chip ${t.status === "rejected" ? "off" : ""}`}>{TEST_STATUS_LABELS[t.status]}</span>
              {t.pending && <span className="chip">بانتظار المزامنة</span>}
            </div>
            <div className="muted" style={{ fontSize: ".88rem" }}>
              {t.circleName ?? "—"} · {TEST_TYPE_LABELS[t.testType]} {t.parts} {t.parts <= 10 ? "أجزاء" : "جزءاً"}{t.rangeText ? ` · ${t.rangeText}` : ""}
            </div>
            {t.status === "completed" && <div><b>{t.score}</b> {t.passed ? <span className="chip">ناجح</span> : <span className="chip off">دون النجاح</span>} <span className="muted">{t.testDate}</span></div>}
            {t.status === "approved" && <div className="muted" style={{ fontSize: ".88rem" }}>موعد الاختبار: {t.testDate ?? "لم يُحدَّد"}</div>}
            {t.proposedByName && t.kind === "official" && <div className="muted" style={{ fontSize: ".85rem" }}>اقترحه: {t.proposedByName}{t.decidedByName ? ` · قرار: ${t.decidedByName}` : ""}</div>}
            {t.notes && <div style={{ fontSize: ".9rem" }}>ملاحظة: {t.notes}</div>}
            <div className="actions" style={{ marginTop: 8 }}>
              {canDecide && t.status === "proposed" && (<><button className="btn small" type="button" onClick={() => setDecide({ t, mode: "approve" })}>اعتماد</button><button className="btn ghost danger small" type="button" onClick={() => setDecide({ t, mode: "reject" })}>رفض</button></>)}
              {canDecide && t.status === "approved" && <button className="btn small" type="button" onClick={() => void openSession(t)}>{t.sessionId ? "متابعة جلسة الاختبار" : "بدء جلسة الاختبار"}</button>}
              {t.status === "completed" && t.sessionId && <button className="btn ghost small" type="button" onClick={() => setSessionTest(t)}>تفاصيل النتيجة</button>}
              {canRemove(t) && !t.pending && <button className="btn ghost danger small" type="button" onClick={() => void remove(t)}>حذف</button>}
            </div>
          </div>
        ))}
        {!items.length && <div className="empty">لا توجد اختبارات.</div>}
      </div>
      {items.length < total && <button className="btn ghost" type="button" onClick={() => void load(page + 1, false)}>عرض المزيد</button>}
      {sheet === "trial" && <TrialSheet onClose={() => setSheet("")} onSaved={() => { setSheet(""); refresh(); }} />}
      {sheet === "propose" && <ProposeSheet onClose={() => setSheet("")} onSaved={() => { setSheet(""); refresh(); }} />}
      {decide && <DecideSheet t={decide.t} mode={decide.mode} onClose={() => setDecide(null)} onSaved={() => { setDecide(null); refresh(); }} />}
      {sessionTest && <ExamSessionSheet test={sessionTest} onClose={() => { setSessionTest(null); refresh(); }} onCompleted={() => { setSessionTest(null); refresh(); }} />}
    </main>
  );
}

function RangeFields({ testType, setTestType, range, setRange }: { testType: string; setTestType: (v: string) => void; range: ExamRange; setRange: (v: ExamRange) => void }) {
  const detail = examRangeDetails(range);
  return (
    <>
      <div className="form-grid two">
        <Field label="نوع الاختبار"><select value={testType} onChange={(e) => setTestType(e.target.value)}><option value="single">منفرد</option><option value="chain">مجتمع (سلسلة)</option></select></Field>
        <Field label="نطاق الاختبار"><select value={range.kind} onChange={(e) => setRange(e.target.value === "juz" ? { kind: "juz", fromJuz: 1, toJuz: 1 } : { kind: "surah", fromSurah: 1, toSurah: 1 })}><option value="juz">أجزاء</option><option value="surah">سور</option></select></Field>
      </div>
      {range.kind === "juz" ? <div className="form-grid two">
        <Field label="من الجزء"><select value={range.fromJuz} onChange={(e) => { const fromJuz = Number(e.target.value); setRange({ kind: "juz", fromJuz, toJuz: Math.max(fromJuz, range.toJuz) }); }}>{Array.from({ length: 30 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></Field>
        <Field label="إلى الجزء"><select value={range.toJuz} onChange={(e) => setRange({ ...range, toJuz: Number(e.target.value) })}>{Array.from({ length: 30 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></Field>
      </div> : <div className="form-grid two">
        <Field label="من السورة"><select value={range.fromSurah} onChange={(e) => { const fromSurah = Number(e.target.value); setRange({ kind: "surah", fromSurah, toSurah: Math.max(fromSurah, range.toSurah) }); }}>{SURAHS.map((s, i) => <option key={i + 1} value={i + 1}>{s[0]}</option>)}</select></Field>
        <Field label="إلى السورة"><select value={range.toSurah} onChange={(e) => setRange({ ...range, toSurah: Number(e.target.value) })}>{SURAHS.map((s, i) => <option key={i + 1} value={i + 1}>{s[0]}</option>)}</select></Field>
      </div>}
      <div className="card" aria-live="polite">{detail ? <><b>{detail.text}</b> · {detail.parts} {detail.parts <= 10 ? "أجزاء" : "جزءاً"}</> : <span className="error-box">يجب أن تكون بداية النطاق قبل نهايته</span>}</div>
    </>
  );
}

function TrialSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { settings } = useMe();
  const { busy, run } = useAction();
  const students = useFetch<{ students: Student[] }>("/api/students?pageSize=100");
  const [studentId, setStudentId] = useState("");
  const [testType, setTestType] = useState("single");
  const [range, setRange] = useState<ExamRange>({ kind: "juz", fromJuz: 1, toJuz: 1 });
  const [date, setDate] = useState(todayIso());
  const [score, setScore] = useState("");
  const sid = studentId || students.data?.students[0]?.id || "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const detail = examRangeDetails(range);
    if (!detail) return;
    if (await run(() => api("/api/tests/trial", { method: "POST", body: { studentId: sid, date, testType, parts: detail.parts, range, score: Number(score) } }), "تم حفظ الاختبار التجريبي")) onSaved();
  };
  return (
    <Sheet title="تسجيل اختبار تجريبي" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="الطالب"><select value={sid} onChange={(e) => setStudentId(e.target.value)}>{students.data?.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <RangeFields {...{ testType, setTestType, range, setRange }} />
        <div className="form-grid two">
          <Field label="تاريخ الاختبار"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="العلامة" hint={`النجاح من ${settings.minPassScore}`}><input type="number" min={0} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} required inputMode="decimal" /></Field>
        </div>
        <button className="btn" disabled={busy || !sid || !examRangeDetails(range)}>حفظ</button>
      </form>
    </Sheet>
  );
}

function ProposeSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const students = useFetch<{ students: Student[] }>("/api/students?pageSize=100");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [testType, setTestType] = useState("chain");
  const [range, setRange] = useState<ExamRange>({ kind: "juz", fromJuz: 1, toJuz: 3 });
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const detail = examRangeDetails(range);
    if (!detail) return;
    if (await run(() => api("/api/tests/propose", { method: "POST", body: { studentIds: [...picked], testType, parts: detail.parts, range } }), "أُرسل الاقتراح إلى لجنة الاختبار")) onSaved();
  };
  return (
    <Sheet title="اقتراح اختبار رسمي" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>اختر الطلاب الجاهزين من عندك؛ تراجع اللجنة الاقتراح وتعتمده.</p>
        <div className="list" style={{ maxHeight: 220, overflow: "auto" }}>
          {students.data?.students.map((s) => (
            <label key={s.id} className="card row-card" style={{ padding: 10 }}>
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} style={{ width: 20, height: 20 }} />
              <span className="grow"><b>{s.name}</b><small>المحفوظ: {countAr(s.memorizedParts, PARTS_AR)}</small></span>
            </label>
          ))}
        </div>
        <RangeFields {...{ testType, setTestType, range, setRange }} />
        <button className="btn" disabled={busy || !picked.size || !examRangeDetails(range)}>إرسال الاقتراح ({picked.size})</button>
      </form>
    </Sheet>
  );
}

function DecideSheet({ t, mode, onClose, onSaved }: { t: TestRow; mode: "approve" | "reject"; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [date, setDate] = useState(t.testDate ?? todayIso());
  const [notes, setNotes] = useState("");
  const title = mode === "approve" ? "اعتماد الاختبار" : "رفض الاقتراح";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === "approve" ? { testDate: date || null, notes } : { notes };
    if (await run(() => api(`/api/tests/${t.id}/${mode}`, { method: "POST", body }), "تم")) onSaved();
  };
  return (
    <Sheet title={`${title} — ${t.studentName}`} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {mode === "approve" && <Field label="موعد الاختبار"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        <Field label="ملاحظات (اختياري)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
        <button className={`btn ${mode === "reject" ? "danger" : ""}`} disabled={busy}>{title}</button>
      </form>
    </Sheet>
  );
}

interface SessionQuestion {
  id: string; seq: number; label: string;
  surah: number | null; ayah: number | null;
  maxScore: number; warnings: number; errors: number; score: number | null;
}
interface SessionDetails {
  test: { studentName: string; circleName: string | null; testType: string; parts: number; rangeText: string; testDate: string | null; testStatus: string; score: number | null; passed: number | null; notes: string };
  session: { id: string; status: "draft" | "completed"; examinerId: string; createdAt: number; completedAt: number | null };
  questions: SessionQuestion[];
}

function ExamSessionSheet({ test, onClose, onCompleted }: { test: TestRow; onClose: () => void; onCompleted: () => void }) {
  const { user, settings } = useMe();
  const { confirm } = useUi();
  const { busy, run } = useAction();
  const { data, error, loading } = useFetch<SessionDetails>(`/api/tests/${test.id}/session`);
  const [questions, setQuestions] = useState<SessionQuestion[]>([]);
  const [testDate, setTestDate] = useState(test.testDate ?? todayIso());
  const [notes, setNotes] = useState(test.notes ?? "");
  useEffect(() => {
    if (data) setQuestions(data.questions);
  }, [data]);
  const canEdit = data?.session.status === "draft" && (user.role === "admin" || user.role === "exam_committee");
  const update = (id: string, patch: Partial<SessionQuestion>) => setQuestions((old) => old.map((q) => q.id === id ? { ...q, ...patch } : q));
  const total = examTotalScore(questions);
  const save = async (finalize: boolean) => {
    if (finalize && !(await confirm({ title: `اعتماد نتيجة ${test.studentName}: ${total} من 100؟`, confirmLabel: "اعتماد النتيجة" }))) return;
    const payload = { questions: questions.map((q) => ({ id: q.id, seq: q.seq, surah: q.surah, ayah: q.ayah, warnings: q.warnings, errors: q.errors })), finalize, testDate, notes };
    const ok = await run(() => api(`/api/tests/${test.id}/session`, { method: "PUT", body: payload }), finalize ? "اعتمدت نتيجة الاختبار" : "حُفظت مسودة الاختبار");
    if (ok && finalize) onCompleted();
  };

  return <Sheet title={`جلسة اختبار — ${test.studentName}`} onClose={onClose}>
    {loading && !data ? <div className="muted">جارٍ تحميل الجلسة…</div> : error ? <div className="error-box">{error}</div> : data && <div className="form-grid">
      <div className="card"><b>{data.test.studentName}</b> · {data.test.circleName ?? "بلا حلقة"}<div className="muted">{TEST_TYPE_LABELS[data.test.testType]} · {data.test.rangeText || `${data.test.parts} أجزاء`}</div></div>
      {questions.map((q) => {
        const qScore = examQuestionScore(q.maxScore, q.warnings, q.errors);
        return <section className="card exam-question" key={q.id}>
          <div className="exam-question-head"><b>{q.seq}. {q.label}</b><b>{qScore} / {q.maxScore}</b></div>
          <div className="exam-question-position">
            <Field label="السورة (اختياري)"><select value={q.surah ?? ""} disabled={!canEdit} onChange={(e) => update(q.id, { surah: e.target.value ? Number(e.target.value) : null, ayah: null })}><option value="">—</option>{SURAHS.map((s, i) => <option key={i + 1} value={i + 1}>{s[0]}</option>)}</select></Field>
            <Field label="الآية (اختياري)"><input type="number" min={1} max={q.surah ? SURAHS[q.surah - 1][1] : undefined} value={q.ayah ?? ""} placeholder="—" disabled={!canEdit || !q.surah} onChange={(e) => update(q.id, { ayah: e.target.value ? Number(e.target.value) : null })} /></Field>
          </div>
          <div className="exam-counters">
            <div className="exam-counter"><span>التنبيهات <small>½ علامة</small></span><div><button type="button" aria-label={`إنقاص تنبيه للسؤال ${q.seq}`} disabled={!canEdit || q.warnings === 0} onClick={() => update(q.id, { warnings: q.warnings - 1 })}>−</button><b aria-live="polite">{q.warnings}</b><button type="button" aria-label={`إضافة تنبيه للسؤال ${q.seq}`} disabled={!canEdit} onClick={() => update(q.id, { warnings: q.warnings + 1 })}>+</button></div></div>
            <div className="exam-counter"><span>الأخطاء <small>علامة</small></span><div><button type="button" aria-label={`إنقاص خطأ للسؤال ${q.seq}`} disabled={!canEdit || q.errors === 0} onClick={() => update(q.id, { errors: q.errors - 1 })}>−</button><b aria-live="polite">{q.errors}</b><button type="button" aria-label={`إضافة خطأ للسؤال ${q.seq}`} disabled={!canEdit} onClick={() => update(q.id, { errors: q.errors + 1 })}>+</button></div></div>
          </div>
        </section>;
      })}
      <div className="card" aria-live="polite"><b>{canEdit ? "النتيجة الحالية" : "النتيجة النهائية"}: {total} / 100</b> · {(canEdit ? total >= settings.minPassScore : !!data.test.passed) ? "ناجح" : "دون النجاح"}</div>
      <Field label="تاريخ الاختبار"><input type="date" value={testDate} max={todayIso()} disabled={!canEdit} onChange={(e) => setTestDate(e.target.value)} /></Field>
      <Field label="ملاحظات الجلسة"><textarea value={notes} maxLength={300} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} /></Field>
      {canEdit && <div className="actions"><button className="btn ghost" type="button" disabled={busy} onClick={() => void save(false)}>حفظ مسودة</button><button className="btn" type="button" disabled={busy || !testDate} onClick={() => void save(true)}>اعتماد النتيجة</button></div>}
    </div>}
  </Sheet>;
}

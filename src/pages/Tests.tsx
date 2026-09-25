import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { RANGE_SUGGESTIONS, TEST_STATUS_LABELS, TEST_TYPE_LABELS, todayIso } from "../lib/format";
import { useDebounced, useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";
import { countAr, PARTS_AR } from "../lib/format";

interface TestRow {
  id: string; studentId: string; studentName: string; circleName: string | null; kind: "trial" | "official"; status: string;
  testType: string; parts: number; rangeText: string; testDate: string | null; score: number | null; passed: number | null;
  notes: string; proposedByName: string | null; decidedByName: string | null;
}

const TABS: Array<[string, string]> = [["", "الكل"], ["proposed", "مقترحة"], ["approved", "معتمدة"], ["completed", "منتهية"], ["rejected", "مرفوضة"]];

/** الاختبارات: تجريبي يسجّله المحفّظ، ورسمي يقترحه المحفّظ فتعتمده لجنة الاختبار وتسجّل نتيجته. */
export function Tests() {
  const { user, settings } = useMe();
  const canPropose = user.role === "admin" || user.role === "secretary" || user.role === "teacher";
  const canDecide = user.role === "admin" || user.role === "exam_committee";
  const canDelete = user.role === "admin" || user.role === "secretary" || user.role === "teacher";
  const [status, setStatus] = useState(user.role === "exam_committee" ? "proposed" : "");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [items, setItems] = useState<TestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState<"" | "trial" | "propose">("");
  const [decide, setDecide] = useState<{ t: TestRow; mode: "approve" | "reject" | "result" } | null>(null);
  const { confirm } = useUi();
  const { run } = useAction();

  const load = useCallback(async (p: number, replace: boolean) => {
    const r = await api<{ tests: TestRow[]; total: number }>(`/api/tests?page=${p}&status=${status}&q=${encodeURIComponent(dq)}`);
    setItems((prev) => (replace ? r.tests : [...prev, ...r.tests]));
    setTotal(r.total);
    setPage(p);
  }, [status, dq]);
  useEffect(() => { void load(1, true); }, [load]);
  const refresh = () => void load(1, true);

  const remove = async (t: TestRow) => {
    if (!(await confirm({ title: `حذف اختبار ${t.studentName}؟`, confirmLabel: "حذف", danger: true }))) return;
    if (await run(() => api(`/api/tests/${t.id}`, { method: "DELETE" }), "تم الحذف")) refresh();
  };
  const canRemove = (t: TestRow) => canDelete && (user.role !== "teacher" || t.kind === "trial" || t.status === "proposed");

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
              {canDecide && t.status === "approved" && <button className="btn small" type="button" onClick={() => setDecide({ t, mode: "result" })}>تسجيل النتيجة</button>}
              {canRemove(t) && <button className="btn ghost danger small" type="button" onClick={() => void remove(t)}>حذف</button>}
            </div>
          </div>
        ))}
        {!items.length && <div className="empty">لا توجد اختبارات.</div>}
      </div>
      {items.length < total && <button className="btn ghost" type="button" onClick={() => void load(page + 1, false)}>عرض المزيد</button>}
      {sheet === "trial" && <TrialSheet onClose={() => setSheet("")} onSaved={() => { setSheet(""); refresh(); }} />}
      {sheet === "propose" && <ProposeSheet onClose={() => setSheet("")} onSaved={() => { setSheet(""); refresh(); }} />}
      {decide && <DecideSheet t={decide.t} mode={decide.mode} onClose={() => setDecide(null)} onSaved={() => { setDecide(null); refresh(); }} />}
    </main>
  );
}

function RangeFields({ testType, setTestType, parts, setParts, rangeText, setRangeText }: { testType: string; setTestType: (v: string) => void; parts: number; setParts: (v: number) => void; rangeText: string; setRangeText: (v: string) => void }) {
  return (
    <>
      <div className="form-grid two">
        <Field label="نوع الاختبار"><select value={testType} onChange={(e) => setTestType(e.target.value)}><option value="single">منفرد</option><option value="chain">مجتمع (سلسلة)</option></select></Field>
        <Field label="عدد الأجزاء" hint="من 1 إلى 30"><input type="number" min={1} max={30} value={parts} onChange={(e) => setParts(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></Field>
      </div>
      <Field label="نطاق الاختبار" hint="اكتب النطاق بحرية أو اختر من الاقتراحات">
        <input value={rangeText} onChange={(e) => setRangeText(e.target.value)} list="range-suggestions" maxLength={120} placeholder="مثال: عمّ – المجادلة" />
        <datalist id="range-suggestions">{RANGE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
      </Field>
    </>
  );
}

function TrialSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { settings } = useMe();
  const { busy, run } = useAction();
  const students = useFetch<{ students: Student[] }>("/api/students?pageSize=100");
  const [studentId, setStudentId] = useState("");
  const [testType, setTestType] = useState("single");
  const [parts, setParts] = useState(1);
  const [rangeText, setRangeText] = useState("");
  const [date, setDate] = useState(todayIso());
  const [score, setScore] = useState("");
  const sid = studentId || students.data?.students[0]?.id || "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/api/tests/trial", { method: "POST", body: { studentId: sid, date, testType, parts, rangeText, score: Number(score) } }), "تم حفظ الاختبار التجريبي")) onSaved();
  };
  return (
    <Sheet title="تسجيل اختبار تجريبي" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="الطالب"><select value={sid} onChange={(e) => setStudentId(e.target.value)}>{students.data?.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <RangeFields {...{ testType, setTestType, parts, setParts, rangeText, setRangeText }} />
        <div className="form-grid two">
          <Field label="تاريخ الاختبار"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="العلامة" hint={`النجاح من ${settings.minPassScore}`}><input type="number" min={0} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} required inputMode="decimal" /></Field>
        </div>
        <button className="btn" disabled={busy || !sid}>حفظ</button>
      </form>
    </Sheet>
  );
}

function ProposeSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const students = useFetch<{ students: Student[] }>("/api/students?pageSize=100");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [testType, setTestType] = useState("chain");
  const [parts, setParts] = useState(3);
  const [rangeText, setRangeText] = useState("");
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/api/tests/propose", { method: "POST", body: { studentIds: [...picked], testType, parts, rangeText } }), "أُرسل الاقتراح إلى لجنة الاختبار")) onSaved();
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
        <RangeFields {...{ testType, setTestType, parts, setParts, rangeText, setRangeText }} />
        <button className="btn" disabled={busy || !picked.size}>إرسال الاقتراح ({picked.size})</button>
      </form>
    </Sheet>
  );
}

function DecideSheet({ t, mode, onClose, onSaved }: { t: TestRow; mode: "approve" | "reject" | "result"; onClose: () => void; onSaved: () => void }) {
  const { settings } = useMe();
  const { busy, run } = useAction();
  const [date, setDate] = useState(t.testDate ?? todayIso());
  const [notes, setNotes] = useState("");
  const [score, setScore] = useState("");
  const title = mode === "approve" ? "اعتماد الاختبار" : mode === "reject" ? "رفض الاقتراح" : "تسجيل النتيجة";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === "approve" ? { testDate: date, notes } : mode === "reject" ? { notes } : { score: Number(score), testDate: date, notes };
    if (await run(() => api(`/api/tests/${t.id}/${mode}`, { method: "POST", body }), "تم")) onSaved();
  };
  return (
    <Sheet title={`${title} — ${t.studentName}`} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {mode !== "reject" && <Field label={mode === "approve" ? "موعد الاختبار" : "تاريخ الاختبار"}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required={mode === "result"} /></Field>}
        {mode === "result" && <Field label="العلامة" hint={`النجاح من ${settings.minPassScore}`}><input type="number" min={0} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} required inputMode="decimal" /></Field>}
        <Field label="ملاحظات (اختياري)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
        <button className={`btn ${mode === "reject" ? "danger" : ""}`} disabled={busy}>{title}</button>
      </form>
    </Sheet>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { canEditMonthlyPlan } from "@shared/monthly-plan";
import { Field, Sheet, useAction } from "../components/ui";
import { api } from "../lib/api";
import { monthIso, todayIso } from "../lib/format";
import { useFetch } from "../lib/hooks";
import type { Student } from "../lib/types";

interface HistoryRow { month: string; set: boolean; saved: boolean; planPages: number; reviewPlanPages: number; pages: number; reviewPages: number }

interface PlanResponse {
  month: string;
  monthlyPlanPages: number;
  monthlyReviewPlanPages: number;
  editable: boolean;
  set: boolean;
  suggestion: { pages: number; basedOn: number } | null;
}

const nextMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);

export function StudentPlan({ student, onClose, onSaved }: { student: Student; onClose: () => void; onSaved: () => void }) {
  const current = monthIso();
  const upcoming = nextMonth(current);
  const canSetUpcoming = canEditMonthlyPlan(todayIso(), upcoming);
  const [month, setMonth] = useState(canSetUpcoming ? upcoming : current);
  const [memorize, setMemorize] = useState(0);
  const [review, setReview] = useState(0);
  const { busy, run } = useAction();
  const plan = useFetch<PlanResponse>(`/api/students/${student.id}/plan?month=${month}`);
  const [showHistory, setShowHistory] = useState(false);
  const history = useFetch<{ current: string; months: HistoryRow[] }>(showHistory ? `/api/students/${student.id}/plan-history` : null);
  const ready = plan.data?.month === month && !plan.loading;

  useEffect(() => {
    if (plan.data?.month !== month) return;
    setMemorize(plan.data.monthlyPlanPages);
    setReview(plan.data.monthlyReviewPlanPages);
  }, [plan.data, month]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !plan.data?.editable) return;
    if (await run(() => api(`/api/students/${student.id}/plan`, {
      method: "PUT", body: { month, monthlyPlanPages: memorize, monthlyReviewPlanPages: review }
    }), "حُفظت خطة الشهر")) onSaved();
  };

  return <Sheet title={`خطة ${student.name}`} onClose={onClose}>
    <form className="form-grid" onSubmit={save}>
      <Field label="شهر الخطة">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value={current}>{current} — الشهر الجاري</option>
          {canSetUpcoming && <option value={upcoming}>{upcoming} — الشهر القادم</option>}
        </select>
      </Field>
      {canSetUpcoming && <p className="muted" style={{ margin: 0 }}>تُحفظ خطة الشهر القادم الآن، ويبدأ احتساب إنجازها من أول يوم فيه.</p>}
      {plan.error && <div className="error-box">{plan.error}</div>}
      {ready && <>
        {!plan.data?.set && <p className="muted" style={{ margin: 0 }}>لم تُوضع خطة لهذا الشهر بعد.</p>}
        {plan.data?.editable && plan.data.suggestion && plan.data.suggestion.pages !== memorize && (
          <p className="muted" style={{ margin: 0 }}>
            متوسط حفظه الفعلي في آخر {plan.data.suggestion.basedOn === 1 ? "شهر مسجَّل" : `${plan.data.suggestion.basedOn} أشهر مسجَّلة`}: <b>{plan.data.suggestion.pages}</b> صفحة.{" "}
            <button className="btn ghost small" type="button" onClick={() => setMemorize(plan.data!.suggestion!.pages)}>اعتماده هدفاً للحفظ</button>
          </p>
        )}
        <div className="form-grid two">
          <Field label="خطة الحفظ (صفحات)"><input type="number" min={0} max={604} required value={memorize} onChange={(e) => setMemorize(Number(e.target.value))} /></Field>
          <Field label="خطة المراجعة (صفحات)"><input type="number" min={0} max={604} required value={review} onChange={(e) => setReview(Number(e.target.value))} /></Field>
        </div>
        <button className="btn" disabled={busy || !plan.data?.editable}>حفظ خطة <bdi>{month}</bdi></button>
      </>}
    </form>
    <div style={{ marginTop: 14 }}>
      <button className="btn ghost small" type="button" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "إخفاء سجل الخطط" : "سجل الخطط"}</button>
      {showHistory && <PlanHistory loading={history.loading} error={history.error} rows={history.data?.months ?? []} current={history.data?.current ?? current} />}
    </div>
  </Sheet>;
}

const pct = (done: number, plan: number) => (plan > 0 ? `${Math.round((done / plan) * 100)}%` : "—");

/** خطة كل شهر مقابل المنجز. الشهر القادم وما لم يكتمل بعد يُعرض دون نسبة نهائية. */
function PlanHistory({ rows, current, loading, error }: { rows: HistoryRow[]; current: string; loading: boolean; error: string | null }) {
  if (error) return <div className="error-box">{error}</div>;
  if (loading) return <p className="muted">جارٍ التحميل…</p>;
  if (!rows.length) return <p className="muted">لا خطط مسجَّلة لهذا الطالب بعد.</p>;
  return (
    <div className="list" style={{ marginTop: 8 }}>
      {rows.map((r) => (
        <div className="card" key={r.month} style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <b style={{ flex: 1 }}><bdi>{r.month}</bdi></b>
            {r.month > current && <span className="chip gold">قادم</span>}
            {r.month === current && <span className="chip">الجاري</span>}
            {r.saved && <span className="chip">كشف محفوظ</span>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".9rem" }}>
            <span>الحفظ: {r.pages}{r.planPages > 0 ? ` من ${r.planPages}` : ""} صفحة</span><b>{r.month > current ? "—" : pct(r.pages, r.planPages)}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".9rem" }}>
            <span>المراجعة: {r.reviewPages}{r.reviewPlanPages > 0 ? ` من ${r.reviewPlanPages}` : ""} صفحة</span><b>{r.month > current ? "—" : pct(r.reviewPages, r.reviewPlanPages)}</b>
          </div>
          {!r.set && !r.saved && <small className="muted">لم تُوضع خطة لهذا الشهر؛ المعروض منجزه فقط.</small>}
        </div>
      ))}
    </div>
  );
}

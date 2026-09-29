import { useEffect, useState, type FormEvent } from "react";
import { canEditMonthlyPlan } from "@shared/monthly-plan";
import { Field, Sheet, useAction } from "../components/ui";
import { api } from "../lib/api";
import { monthIso, todayIso } from "../lib/format";
import { useFetch } from "../lib/hooks";
import type { Student } from "../lib/types";

interface PlanResponse {
  month: string;
  monthlyPlanPages: number;
  monthlyReviewPlanPages: number;
  editable: boolean;
  set: boolean;
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
        <div className="form-grid two">
          <Field label="خطة الحفظ (صفحات)"><input type="number" min={0} max={604} required value={memorize} onChange={(e) => setMemorize(Number(e.target.value))} /></Field>
          <Field label="خطة المراجعة (صفحات)"><input type="number" min={0} max={604} required value={review} onChange={(e) => setReview(Number(e.target.value))} /></Field>
        </div>
        <button className="btn" disabled={busy || !plan.data?.editable}>حفظ خطة <bdi>{month}</bdi></button>
      </>}
    </form>
  </Sheet>;
}

import { useState } from "react";
import { Field, Sheet, useAction, useUi } from "./ui";
import { api } from "../lib/api";
import { fmtDay, todayIso } from "../lib/format";
import { useFetch } from "../lib/hooks";

const QUICK_REASONS = ["اعتذار المعلّم عن الحصة", "عطلة", "ظرف طارئ"];

/**
 * إلغاء حصة حلقة (§14.6): زر واحد يعلن الإلغاء بسبب فيظهر لأولياء الطلاب ويصلهم إشعار، ولا يُحسب غياب.
 * يظهر شريط الإلغاء لليوم المعروض مع «إعادة الحصة»، وتحته قائمة الإلغاءات القادمة للحلقة.
 */
export function CancelSessionBar({ circleId, date, cancellation, onChanged }: { circleId: string; date: string; cancellation: { id: string; reason: string } | null; onChanged: () => void }) {
  const { confirm } = useUi();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(todayIso());
  const [reason, setReason] = useState("");
  const upcoming = useFetch<{ cancellations: Array<{ id: string; date: string; reason: string }> }>(`/api/cancellations?circleId=${circleId}&from=${todayIso()}`);
  const list = (upcoming.data?.cancellations ?? []).filter((x) => x.id !== cancellation?.id);

  const restore = async (id: string) => {
    if (!(await confirm({ title: "إعادة الحصة؟", message: "سيصل أولياء الطلاب إشعار بأن الحصة عادت.", confirmLabel: "إعادة الحصة" }))) return;
    if (await run(() => api(`/api/cancellations/${id}`, { method: "DELETE" }), "أُعيدت الحصة")) { upcoming.reload(); onChanged(); }
  };
  const submit = async () => {
    if (await run(() => api("/api/cancellations", { method: "POST", body: { circleId, date: day, reason } }), "أُلغيت الحصة وأُرسل إشعار للأولياء")) {
      setOpen(false); setReason(""); upcoming.reload(); onChanged();
    }
  };

  return (
    <>
      {cancellation && (
        <div className="error-box" style={{ marginBottom: 12 }} role="status">
          <b>حصة هذا اليوم ملغاة</b> — السبب: {cancellation.reason}
          <div className="actions"><button className="btn small" type="button" disabled={busy} onClick={() => void restore(cancellation.id)}>إعادة الحصة</button></div>
        </div>
      )}
      {list.length > 0 && (
        <div className="notice-box" style={{ marginBottom: 12 }}>
          <b>حصص ملغاة قادمة</b>
          {list.map((x) => (
            <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginTop: 6 }}>
              <span>{fmtDay(x.date)} — {x.reason}</span>
              <button className="btn ghost small" type="button" disabled={busy} onClick={() => void restore(x.id)}>إعادة</button>
            </div>
          ))}
        </div>
      )}
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="btn ghost small" type="button" onClick={() => { setDay(date < todayIso() ? todayIso() : date); setOpen(true); }}>إلغاء حصة</button>
      </div>
      {open && (
        <Sheet title="إلغاء حصة" onClose={() => setOpen(false)}>
          <div className="form-grid">
            <p className="muted" style={{ margin: 0 }}>يظهر الإلغاء لأولياء كل طلاب الحلقة ويصلهم إشعار، ولا يُحسب على أحد غياب.</p>
            <Field label="يوم الحصة"><input className="input" type="date" min={todayIso()} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            <Field label="سبب الإلغاء (يراه الأولياء)">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="مثال: اعتذار المعلّم عن حصة اليوم" />
            </Field>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{QUICK_REASONS.map((q) => <button key={q} type="button" className="chip" onClick={() => setReason(q)}>{q}</button>)}</div>
            <button className="btn danger" type="button" disabled={busy || reason.trim().length < 3 || !day} onClick={() => void submit()}>إلغاء الحصة وإشعار الأولياء</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

import { useState, type FormEvent } from "react";
import { CATEGORY_LABELS, type Gender } from "@shared/constants";
import { Field, Icons, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useFetch, useWantsNew } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle, Staff } from "../lib/types";
import { ScheduleEditor } from "./ScheduleAbsence";

/** الحلقات: بالاسم فقط (بلا رمز). لكل معلّم حلقة واحدة، وللحلقة أساسي ومساعد اختياري. */
export function Circles() {
  const { settings, user } = useMe();
  // مدير المرحلة يقرأ حلقات مراحله فقط؛ الإنشاء والتعديل والتعطيل للإدارة (§15.3)
  const readOnly = user.role === "stage_manager";
  const circles = useFetch<{ circles: Circle[] }>("/api/circles");
  const staff = useFetch<{ staff: Staff[] }>(readOnly ? null : "/api/staff");
  const wantsNew = useWantsNew();
  const { run } = useAction();
  const [form, setForm] = useState<Circle | "new" | null>(wantsNew ? "new" : null);
  const [schedule, setSchedule] = useState<Circle | null>(null);
  const levelLabel = (k: string) => settings.levels.find((l) => l.key === k)?.label ?? k;

  /** تعطيل/تفعيل من بطاقة الحلقة مباشرة (§15.5) — الحلقة المعطّلة تختفي من قوائم الإضافة. */
  const toggle = async (c: Circle) => {
    const body = { name: c.name, category: c.category, levelKey: c.levelKey, active: !c.active, primaryTeacherId: c.primaryTeacherId, assistantTeacherId: c.assistantTeacherId };
    if (await run(() => api(`/api/circles/${c.id}`, { method: "PUT", body }), c.active ? "عُطّلت الحلقة" : "فُعّلت الحلقة")) void circles.reload();
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>{readOnly ? "حلقات مرحلتي" : "الحلقات"}</h1><p>{circles.data?.circles.length ?? 0} حلقة · الحد الأقصى {settings.maxStudentsPerCircle} طالباً</p></div></div>
      {circles.error && <div className="error-box">{circles.error}</div>}
      <div className="list">
        {circles.data?.circles.map((c) => (
          <div key={c.id} className="card" style={{ display: "grid", gap: 6 }}>
          <button className="row-card" type="button" style={{ all: "unset", cursor: readOnly ? "default" : "pointer", display: "flex", gap: 12, alignItems: "center", width: "100%" }} onClick={() => { if (!readOnly) setForm(c); }}>
            <span className="grow">
              <b>{c.name} {!c.active && <span className="chip off">معطّلة</span>}</b>
              <small>{CATEGORY_LABELS[c.category]} · {levelLabel(c.levelKey)} · {c.studentCount}/{settings.maxStudentsPerCircle} طالباً</small>
              <small>{c.primaryTeacherName ? `الأساسي: ${c.primaryTeacherName}` : "بلا معلّم"}{c.assistantTeacherName ? ` · المساعد: ${c.assistantTeacherName}` : ""}</small>
            </span>
          </button>
          <div className="actions">
            {!readOnly && <button className="btn ghost small" type="button" onClick={() => setSchedule(c)}>جدول الحلقة</button>}
            {!readOnly && <button className={`btn ghost small ${c.active ? "danger" : ""}`} type="button" onClick={() => void toggle(c)}>{c.active ? "تعطيل" : "تفعيل"}</button>}
          </div>
          </div>
        ))}
        {circles.data && !circles.data.circles.length && <div className="empty">لا توجد حلقات بعد. أضف أول حلقة.</div>}
      </div>
      {!readOnly && <button className="fab" type="button" onClick={() => setForm("new")}>{Icons.plus}إضافة حلقة</button>}
      {schedule && <ScheduleEditor circleId={schedule.id} circleName={schedule.name} onClose={() => setSchedule(null)} />}
      {form && staff.data && (
        <CircleForm circle={form === "new" ? null : form} teachers={staff.data.staff.filter((s) => s.role === "teacher")} onClose={() => setForm(null)} onSaved={() => { setForm(null); void circles.reload(); void staff.reload(); }} />
      )}
    </main>
  );
}

function CircleForm({ circle, teachers, onClose, onSaved }: { circle: Circle | null; teachers: Staff[]; onClose: () => void; onSaved: () => void }) {
  const { settings } = useMe();
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const [category, setCategory] = useState<Gender>(circle?.category ?? "male");
  const [primary, setPrimary] = useState(circle?.primaryTeacherId ?? "");
  const [assistant, setAssistant] = useState(circle?.assistantTeacherId ?? "");

  // المعلّم المتاح: فعّال ومن جنس الفئة. قيد «حلقة واحدة» رُفع في هجرة 0009 (§15.5).
  const available = teachers.filter((t) => t.active && t.gender === category);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get("name")), category, levelKey: String(f.get("levelKey")), active: f.get("active") === "on", primaryTeacherId: primary || null, assistantTeacherId: assistant || null };
    const ok = await run(() => (circle ? api(`/api/circles/${circle.id}`, { method: "PUT", body }) : api("/api/circles", { method: "POST", body })), circle ? "تم حفظ الحلقة" : "تمت إضافة الحلقة");
    if (ok) onSaved();
  };
  const remove = async () => {
    if (!circle) return;
    const busyCount = circle.studentCount;
    const message = busyCount > 0
      ? `في الحلقة ${busyCount} طالباً. انقلهم أولاً، أو عطّل الحلقة بدل حذفها.`
      : "الحلقة فارغة، وسيُحذف جدولها وإسناد معلّميها. لا يمكن التراجع.";
    if (!(await confirm({ title: `حذف ${circle.name}؟`, message, confirmLabel: busyCount > 0 ? "حاول الحذف" : "حذف", danger: true }))) return;
    if (await run(() => api(`/api/circles/${circle.id}`, { method: "DELETE" }), "تم حذف الحلقة")) onSaved();
  };

  return (
    <Sheet title={circle ? "تعديل الحلقة" : "إضافة حلقة"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="اسم الحلقة"><input name="name" required minLength={2} defaultValue={circle?.name} /></Field>
        <div className="form-grid two">
          <Field label="الفئة">
            <select value={category} onChange={(e) => { setCategory(e.target.value as Gender); setPrimary(""); setAssistant(""); }}>
              <option value="male">{CATEGORY_LABELS.male}</option><option value="female">{CATEGORY_LABELS.female}</option>
            </select>
          </Field>
          <Field label="المرحلة">
            <select name="levelKey" defaultValue={circle?.levelKey ?? settings.levels[0]?.key}>
              {settings.levels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="المعلّم الأساسي" hint={category === "male" ? "المعلمون الفعّالون من فئة الحلقة" : "المعلمات الفعّالات من فئة الحلقة"}>
          <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">بلا معلّم</option>
            {available.filter((t) => t.id !== assistant).map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </Field>
        <Field label="المعلّم المساعد (اختياري)">
          <select value={assistant} onChange={(e) => setAssistant(e.target.value)} disabled={!primary}>
            <option value="">بلا مساعد</option>
            {available.filter((t) => t.id !== primary).map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </Field>
        <label className="radio-row"><span style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="active" defaultChecked={circle?.active ?? true} style={{ width: 18, height: 18 }} />الحلقة فعّالة</span></label>
        <div className="actions">
          <button className="btn" disabled={busy}>{circle ? "حفظ" : "إضافة"}</button>
          {circle && <button className="btn ghost danger" type="button" onClick={() => void remove()}>حذف</button>}
        </div>
      </form>
    </Sheet>
  );
}

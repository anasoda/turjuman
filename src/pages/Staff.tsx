import { useState, type FormEvent } from "react";
import { AJKAM_COURSES, GENDER_LABELS, MIN_PASSWORD, QUALIFICATIONS, ROLE_LABELS, STAFF_ROLES, USERNAME_RE, WA_PREFIXES, WA_PREFIX_LABELS, type Gender, type StaffRole } from "@shared/constants";
import { ContactIcons, ContactRow } from "../components/Contact";
import { Field, Icons, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { initials, useFetch, useWantsNew } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Staff } from "../lib/types";

const TAB_LABELS: Record<StaffRole, string> = { teacher: "المعلمون", secretary: "السكرتارية", stage_manager: "مديرو المراحل", exam_committee: "لجنة الاختبار" };

/** الكادر: المدير ينشئ الحسابات ويعيّن كلمات المرور (لا رموز مؤقتة). السكرتير يدير المعلمين واللجنة فقط (لا مديري المراحل). */
/** حلقات المعلّم مع صفته في كل منها (قد تكون أكثر من حلقة — §15.5). */
function circleLabels(circles: Staff["circles"]): string {
  return circles.map((c) => `${c.name} (${c.kind === "primary" ? "أساسي" : "مساعد"})`).join("، ");
}

/** أسماء مراحل مدير المرحلة كما في إعدادات المركز. */
function stageLabels(stages: string[] | undefined, levels: { key: string; label: string }[]): string {
  if (!stages?.length) return "بلا مراحل";
  return stages.map((k) => levels.find((l) => l.key === k)?.label ?? k).join("، ");
}

export function StaffPage() {
  const { user, settings } = useMe();
  const { data, error, reload } = useFetch<{ staff: Staff[] }>("/api/staff");
  const [tab, setTab] = useState<StaffRole>("teacher");
  const wantsNew = useWantsNew();
  const [form, setForm] = useState<Staff | "new" | null>(wantsNew ? "new" : null);
  const allowed = STAFF_ROLES.filter((r) => user.role === "admin" || (r !== "secretary" && r !== "stage_manager"));
  const list = (data?.staff ?? []).filter((s) => s.role === tab);

  return (
    <main className="page">
      <div className="page-head"><div><h1>الكادر</h1><p>الحسابات تنشئها الإدارة مباشرة</p></div></div>
      <div className="tabs" role="tablist">
        {allowed.map((r) => <button key={r} type="button" aria-pressed={tab === r} onClick={() => setTab(r)}>{TAB_LABELS[r]}</button>)}
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {list.map((s) => (
          <div key={s.id} className="card row-card">
            <button className="row-main" type="button" onClick={() => setForm(s)}>
              <span className="avatar">{initials(s.displayName)}</span>
              <span className="grow">
                <b>{s.displayName} {!s.active && <span className="chip off">موقوف</span>}</b>
                <small>{s.username}{s.role === "stage_manager" ? ` · ${stageLabels(s.stages, settings.levels)}` : ""}{s.circles.length ? ` · ${circleLabels(s.circles)}` : ""}</small>
              </span>
            </button>
            <ContactIcons cc={s.waCc} national={s.waNational || s.phone || ""} label={s.displayName} subject={ROLE_LABELS[s.role]} />
          </div>
        ))}
        {data && !list.length && <div className="empty">لا يوجد حسابات في هذا القسم.</div>}
      </div>
      <button className="fab" type="button" onClick={() => setForm("new")}>{Icons.plus}إضافة حساب</button>
      {form && <StaffForm staff={form === "new" ? null : form} defaultRole={tab} allowed={allowed} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
    </main>
  );
}

function StaffForm({ staff, defaultRole, allowed, onClose, onSaved }: { staff: Staff | null; defaultRole: StaffRole; allowed: readonly StaffRole[]; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const { settings } = useMe();
  const [role, setRole] = useState<StaffRole>((staff?.role as StaffRole) ?? defaultRole);
  const [stages, setStages] = useState<string[]>(staff?.stages ?? []);
  const toggleStage = (key: string) => setStages((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const [gender, setGender] = useState<Gender>(staff?.gender ?? "male");
  const [pw, setPw] = useState(false);
  const editing = !!staff;

  if (pw && staff) return <PasswordSheet staff={staff} onClose={() => setPw(false)} />;

  const remove = async () => {
    if (!staff) return;
    const message = "يُحذف الحساب وبياناته الشخصية وحضوره وإشعاراته نهائياً، وتبقى سجلات التسميع والاختبارات والكشوف بلا اسم كاتبها. لا يمكن التراجع. وإن أردت إيقافه مؤقتاً فألغِ «الحساب فعّال» بدل الحذف.";
    if (!(await confirm({ title: `حذف ${staff.displayName}؟`, message, confirmLabel: "حذف", danger: true }))) return;
    if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`/api/staff/${staff.id}`, { method: "DELETE" }), "حذف")) onSaved();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    const profile = { displayName: s("displayName"), nationalId: s("nationalId"), phone: s("phone"), waCc: s("waCc") || "970", waNational: s("waNational"), birth: s("birth"), gender, email: s("email"), address: s("address"), qualification: s("qualification"), ajkamCourse: s("ajkamCourse"), memorizedParts: Number(f.get("memorizedParts") || 0) };
    if (role === "stage_manager" && !stages.length) return void (await run(async () => { throw new Error("اختر مرحلة واحدة على الأقل لمدير المرحلة"); }));
    if (editing) {
      const body = { ...profile, active: f.get("active") === "on", ...(staff.role === "stage_manager" || staff.role === "teacher" ? { stages } : {}) };
      if (await run(() => api(`/api/staff/${staff.id}`, { method: "PATCH", body }), "تم حفظ التعديلات")) onSaved();
      return;
    }
    const username = s("username").trim();
    if (!USERNAME_RE.test(username)) return void (await run(async () => { throw new Error("اسم المستخدم من 3 إلى 64 خانة بلا فراغات"); }));
    if (await run(() => api("/api/staff", { method: "POST", body: { ...profile, role, stages, username, password: s("password") } }), "تم إنشاء الحساب")) onSaved();
  };

  return (
    <Sheet title={editing ? `تعديل ${staff.displayName}` : "إضافة حساب"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {!editing && (
          <Field label="نوع الحساب">
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>{allowed.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
          </Field>
        )}
        {(role === "stage_manager" || (editing && staff?.role === "teacher")) && (
          <Field label="المراحل التي يديرها" hint="اختيار مرحلة يحوّل هذا المعلّم إلى مدير مرحلة؛ إلغاء كل الاختيارات يلغي التعيين">
            <div className="radio-row">
              {settings.levels.map((l) => (
                <label key={l.key} style={{ minWidth: 110 }}>
                  <input type="checkbox" checked={stages.includes(l.key)} onChange={() => toggleStage(l.key)} />{l.label}
                </label>
              ))}
            </div>
          </Field>
        )}
        <Field label="الاسم الرباعي"><input name="displayName" required minLength={8} defaultValue={staff?.displayName} /></Field>
        <div className="form-grid two">
          <Field label="رقم الهوية"><input name="nationalId" required pattern="[0-9]{9}" title="رقم الهوية يجب أن يتكون من 9 خانات" inputMode="numeric" defaultValue={staff?.nationalId ?? ""} dir="ltr" /></Field>
          <Field label="جوال الاتصال"><input name="phone" required pattern="05[96][0-9]{7}" title="يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 خانات" inputMode="tel" placeholder="0591234567" defaultValue={staff?.phone ?? ""} dir="ltr" /></Field>
        </div>
        <div className="form-grid two">
          <Field label="مقدمة الواتساب">
            <select name="waCc" defaultValue={staff?.waCc || "970"}>
              {WA_PREFIXES.map((code) => <option key={code} value={code}>{WA_PREFIX_LABELS[code]}</option>)}
            </select>
          </Field>
          <Field label="جوال الواتساب"><input name="waNational" pattern="05[96][0-9]{7}" title="يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 خانات" inputMode="tel" placeholder="0599876543" defaultValue={staff?.waNational ?? ""} dir="ltr" /></Field>
        </div>
        {editing && (
          <div className="contact-block">
            <ContactRow cc={staff.waCc} national={staff.waNational || staff.phone || ""} label={staff.displayName} title="التواصل" subject={ROLE_LABELS[staff.role]} />
          </div>
        )}
        <div className="form-grid two">
          <Field label="تاريخ الميلاد"><input name="birth" type="date" required defaultValue={staff?.birth ?? ""} /></Field>
          <Field label="الجنس">
            <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
              <option value="male">{GENDER_LABELS.male}</option><option value="female">{GENDER_LABELS.female}</option>
            </select>
          </Field>
        </div>
        <div className="form-grid two">
          <Field label="المؤهل"><select name="qualification" defaultValue={staff?.qualification || "بكالوريوس"}>{QUALIFICATIONS.map((q) => <option key={q}>{q}</option>)}</select></Field>
          <Field label="دورة الأحكام"><select name="ajkamCourse" defaultValue={staff?.ajkamCourse || "تأهيلية"}>{AJKAM_COURSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
        <div className="form-grid two">
          <Field label="الأجزاء المحفوظة"><input name="memorizedParts" type="number" min={0} max={30} defaultValue={staff?.memorizedParts ?? 30} /></Field>
          <Field label="البريد الإلكتروني (اختياري)"><input name="email" type="email" defaultValue={staff?.email ?? ""} dir="ltr" /></Field>
        </div>
        <Field label="العنوان"><input name="address" defaultValue={staff?.address ?? ""} /></Field>
        {!editing && (
          <div className="form-grid two">
            <Field label="اسم المستخدم"><input name="username" required minLength={3} autoCapitalize="none" dir="ltr" /></Field>
            <Field label="كلمة المرور" hint={`${MIN_PASSWORD} خانات على الأقل`}><input name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" dir="ltr" /></Field>
          </div>
        )}
        {editing && <label className="radio-row"><span style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="active" defaultChecked={staff.active} style={{ width: 18, height: 18 }} />الحساب فعّال</span></label>}
        <div className="actions">
          <button className="btn" disabled={busy}>{editing ? "حفظ" : "إنشاء الحساب"}</button>
          {editing && <button className="btn ghost" type="button" onClick={() => setPw(true)}>كلمة مرور جديدة</button>}
          {editing && <button className="btn ghost danger" type="button" disabled={busy} onClick={() => void remove()}>حذف الحساب</button>}
        </div>
      </form>
    </Sheet>
  );
}

function PasswordSheet({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { busy, run } = useAction();
  return (
    <Sheet title={`كلمة مرور جديدة لـ ${staff.displayName}`} onClose={onClose}>
      <form className="form-grid" onSubmit={async (e) => {
        e.preventDefault();
        const password = String(new FormData(e.currentTarget).get("password"));
        if (await run(() => api(`/api/staff/${staff.id}/password`, { method: "POST", body: { password } }), "تم تعيين كلمة المرور الجديدة")) onClose();
      }}>
        <p className="muted" style={{ margin: 0 }}>كلمة المرور لا يراها أحد. عيّن كلمة جديدة وأبلغ بها صاحب الحساب؛ تنتهي جلساته الحالية.</p>
        <Field label="كلمة المرور الجديدة" hint={`${MIN_PASSWORD} خانات على الأقل`}><input name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" dir="ltr" /></Field>
        <button className="btn" disabled={busy}>تعيين</button>
      </form>
    </Sheet>
  );
}

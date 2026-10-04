import { useEffect, useState, type FormEvent } from "react";
import { MIN_PASSWORD, RELATION_LABELS, type GuardianRelation } from "@shared/constants";
import { ContactIcons, ContactRow } from "../components/Contact";
import { GuardianFields, emptyGuardian } from "../components/GuardianFields";
import { Field, Icons, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useDebounced, useFetch, useUrlState, useWantsNew } from "../lib/hooks";
import type { Guardian, GuardianInput, Student } from "../lib/types";
import { useMe } from "../lib/session";

import { Link } from "react-router-dom";

interface OrphanStudent { id: string; name: string }

/** قوالب واتساب لولي الأمر بأبنائه غير المؤرشفين؛ بلا أبناء يبقى الرابط المباشر. */
const templatesOf = (g: Guardian) => {
  const students = g.children.filter((k) => !k.archived).map((k) => ({ name: k.name, circle: k.circleName }));
  return students.length ? { guardian: g.name, students } : undefined;
};

/**
 * أولياء الأمور (§15.7): ولي الأمر كيان مستقل، وحسابه اختياري يُنشأ لاحقاً.
 * اسم المستخدم وكلمة المرور الأولية = رقم هوية ولي الأمر، ولا إجبار على تغييرها (§15.8).
 */
export function Guardians() {
  const { user } = useMe();
  const teacher = user.role === "teacher";
  const [q, setQ] = useUrlState("q");
  const dq = useDebounced(q);
  const list = useFetch<{ guardians: Guardian[] }>(`/api/guardians${dq ? `?q=${encodeURIComponent(dq)}` : ""}`);
  const orphans = useFetch<{ students: OrphanStudent[] }>(teacher ? "" : "/api/guardians/orphans");
  const wantsNew = useWantsNew();
  const [form, setForm] = useState(wantsNew);
  const [detail, setDetail] = useState<Guardian | null>(null);
  const refresh = () => { void list.reload(); void orphans.reload(); };

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>أولياء الأمور</h1><p>لكل طالب ولي أمر واحد، ولولي الأمر عدة أبناء</p></div>
      </div>

      {!teacher && !!orphans.data?.students.length && (
        <section className="card">
          <h3>طلاب بلا ولي أمر مسجَّل</h3>
          <small className="muted">أضف ولي أمر ثم اختر أبناءه من قائمة الطلاب.</small>
          <div className="list" style={{ marginTop: 8 }}>
            {orphans.data.students.slice(0, 10).map((s) => <div key={s.id} className="muted" style={{ padding: "4px 8px" }}>• {s.name}</div>)}
            {orphans.data.students.length > 10 && <small className="muted">…و{orphans.data.students.length - 10} طالباً آخر</small>}
          </div>
        </section>
      )}

      <div className="search-row">
        <input className="input" placeholder="ابحث بالاسم أو الجوال أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      </div>
      {list.error && <div className="error-box">{list.error}</div>}
      <div className="list">
        {list.data?.guardians.map((g) => (
          <div key={g.id} className="card row-card">
            <button type="button" className="row-main" onClick={() => setDetail(g)}>
              <span className="avatar">{g.name.trim().charAt(0) || "؟"}</span>
              <span className="grow">
                <b>
                  {g.name}
                  {!g.hasAccount && <span className="chip off" style={{ marginInlineStart: 6 }}>بلا حساب</span>}
                  {g.hasAccount && !g.active && <span className="chip off" style={{ marginInlineStart: 6 }}>موقوف</span>}
                </b>
                <small>{g.children.length ? g.children.map((k) => k.name.split(" ")[0]).join(" · ") : "لا أبناء مرتبطون"}</small>
              </span>
            </button>
            <ContactIcons cc={g.waCc} national={g.waNational} callNational={g.callPhone} label={g.name} subject={`ولي أمر ${g.children[0]?.name ?? ""}`} templates={templatesOf(g)} />
          </div>
        ))}
        {!list.loading && !list.data?.guardians.length && <div className="empty">لا يوجد أولياء أمور بعد.</div>}
      </div>

      {!teacher && <button className="fab" type="button" onClick={() => setForm(true)}>{Icons.plus}إضافة ولي أمر</button>}

      {form && <GuardianForm onClose={() => setForm(false)} onSaved={() => { setForm(false); refresh(); }} />}
      {detail && <GuardianDetail g={detail} teacher={teacher} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); refresh(); }} />}
    </main>
  );
}

/* ------------------------------ اختيار الأبناء ------------------------------ */
function ChildrenPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data } = useFetch<{ students: Student[] }>(`/api/students?pageSize=60${dq ? `&q=${encodeURIComponent(dq)}` : ""}`);
  const [chosen, setChosen] = useState<Student[]>([]);
  useEffect(() => {
    const found = (data?.students ?? []).filter((s) => value.includes(s.id));
    setChosen((prev) => [...found, ...prev.filter((p) => value.includes(p.id) && !found.some((f) => f.id === p.id))]);
  }, [data, value]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Field label="الأبناء في المركز" hint={`${value.length} مختار`}>
      <input className="input" placeholder="ابحث عن الطالب بالاسم أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list">
        {chosen.filter((s) => !(data?.students ?? []).some((x) => x.id === s.id)).map((s) => (
          <label key={s.id} className="check"><input type="checkbox" checked onChange={() => toggle(s.id)} />{s.name}</label>
        ))}
        {(data?.students ?? []).map((s) => (
          <label key={s.id} className="check">
            <input type="checkbox" checked={value.includes(s.id)} onChange={() => toggle(s.id)} />
            {s.name} <small className="muted">{s.circleName ?? ""}</small>
          </label>
        ))}
        {!data?.students.length && <small className="muted">لا نتائج</small>}
      </div>
    </Field>
  );
}

/* ------------------------------ إضافة ولي أمر ------------------------------ */
function GuardianForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [g, setG] = useState<GuardianInput>(emptyGuardian());
  const [withAccount, setWithAccount] = useState(false);
  const [studentIds, setStudentIds] = useState<string[]>([]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await run(() => api("/api/guardians", { method: "POST", body: { ...g, withAccount, studentIds } }), withAccount ? "أُنشئ ولي الأمر وحسابه" : "أُضيف ولي الأمر")) onSaved();
  };

  return (
    <Sheet title="إضافة ولي أمر" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <GuardianFields value={g} onChange={setG} />
        <label className="check">
          <input type="checkbox" checked={withAccount} onChange={(e) => setWithAccount(e.target.checked)} />
          إنشاء حساب دخول الآن
        </label>
        {withAccount && (
          <small className="muted">
            اسم المستخدم وكلمة المرور الأولية = رقم هوية ولي الأمر، ويستطيع تغييرها من حسابه. {!g.nationalId && <b>أدخل رقم الهوية أعلاه أولاً.</b>}
          </small>
        )}
        <ChildrenPicker value={studentIds} onChange={setStudentIds} />
        <button className="btn" disabled={busy}>إضافة</button>
      </form>
    </Sheet>
  );
}

/* ------------------------------ تفاصيل ولي الأمر ------------------------------ */
function GuardianDetail({ g, teacher, onClose, onChanged }: { g: Guardian; teacher: boolean; onClose: () => void; onChanged: () => void }) {
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const [mode, setMode] = useState<"" | "children" | "password" | "edit">("");
  const [studentIds, setStudentIds] = useState<string[]>(g.children.map((k) => k.id));
  const [edit, setEdit] = useState<GuardianInput>({ name: g.name, relation: g.relation, callPhone: g.callPhone, waCc: g.waCc, waNational: g.waNational, nationalId: g.nationalId ?? "" });

  if (mode === "children") {
    return (
      <Sheet title={`أبناء ${g.name}`} onClose={() => setMode("")}>
        <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>يمكن إضافة أبناء من ولي آخر (ينتقلون إلى هذا الولي). ولا يمكن إزالة ابن دون نقله إلى ولي أمر آخر، لأن بيانات الولي إجبارية لكل طالب.</p>
        <ChildrenPicker value={studentIds} onChange={setStudentIds} />
        <button className="btn" type="button" disabled={busy} onClick={async () => {
          if (await run(() => api(`/api/guardians/${g.id}/children`, { method: "PUT", body: { studentIds } }), "تم تحديث قائمة الأبناء")) onChanged();
        }}>حفظ</button>
      </Sheet>
    );
  }
  if (mode === "password") {
    return (
      <Sheet title={`كلمة مرور جديدة لـ ${g.name}`} onClose={() => setMode("")}>
        <form className="form-grid" onSubmit={async (e) => {
          e.preventDefault();
          const password = String(new FormData(e.currentTarget).get("password"));
          if (await run(() => api(`/api/guardians/${g.id}/password`, { method: "POST", body: { password } }), "تم تعيين كلمة المرور")) setMode("");
        }}>
          <p className="muted" style={{ margin: 0 }}>لا أحد يرى كلمة المرور الحالية؛ عيّن جديدة وأبلغ بها ولي الأمر. تنتهي جلساته الحالية.</p>
          <Field label="كلمة المرور الجديدة" hint={`${MIN_PASSWORD} خانات على الأقل`}><input name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" dir="ltr" /></Field>
          <button className="btn" disabled={busy}>تعيين</button>
        </form>
      </Sheet>
    );
  }
  if (mode === "edit") {
    return (
      <Sheet title={`تعديل ${g.name}`} onClose={() => setMode("")}>
        <form className="form-grid" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(`/api/guardians/${g.id}`, { method: "PATCH", body: edit }), "تم حفظ التعديلات")) onChanged();
        }}>
          <GuardianFields value={edit} onChange={setEdit} />
          <button className="btn" disabled={busy}>حفظ</button>
        </form>
      </Sheet>
    );
  }

  const createAccount = async () => {
    if (!g.nationalId) return void (await run(async () => { throw new Error("أضف رقم هوية ولي الأمر أولاً من «تعديل البيانات» — فهو اسم المستخدم"); }));
    if (!(await confirm({ title: "إنشاء حساب دخول", message: `اسم المستخدم وكلمة المرور الأولية: ${g.nationalId}. يستطيع ولي الأمر تغيير كلمة المرور من حسابه.`, confirmLabel: "إنشاء" }))) return;
    if (await run(() => api(`/api/guardians/${g.id}/account`, { method: "POST", body: {} }), "أُنشئ الحساب")) onChanged();
  };

  return (
    <Sheet title={g.name} onClose={onClose}>
      <dl className="kv">
        <dt>الصفة</dt><dd>{RELATION_LABELS[g.relation as GuardianRelation]}</dd>
        <dt>رقم الهوية</dt><dd dir="ltr" style={{ textAlign: "end" }}>{g.nationalId || "—"}</dd>
        <dt>الحساب</dt><dd dir="ltr" style={{ textAlign: "end" }}>{g.hasAccount ? `${g.username}${g.active ? "" : " (موقوف)"}` : "لا حساب بعد"}</dd>
      </dl>
      <div className="contact-block">
        <ContactRow cc={g.waCc} national={g.waNational} callNational={g.callPhone} label={g.name} title="التواصل" subject={`ولي أمر ${g.children[0]?.name ?? ""}`} templates={templatesOf(g)} />
      </div>
      <h3 style={{ marginBottom: 4 }}>الأبناء</h3>
      {g.children.length ? (
        <div className="list" style={{ gap: 4 }}>
          {g.children.map((k) => (
            <Link key={k.id} to={`/app/students?q=${encodeURIComponent(k.name)}`} style={{ textDecoration: "none" }} onClick={onClose}>
              <div className="muted" style={{ padding: "8px", borderRadius: "8px", background: "var(--panel)" }}>
                {k.name} — {k.circleName ?? "بلا حلقة"}{k.archived ? " (مؤرشف)" : ""}
              </div>
            </Link>
          ))}
        </div>
      ) : <p className="muted">لا أبناء مرتبطون.</p>}
      <div className="actions">
        {!teacher && <button className="btn small" type="button" onClick={() => setMode("children")}>تعديل الأبناء</button>}
        <button className="btn ghost small" type="button" onClick={() => setMode("edit")}>تعديل البيانات</button>
        {!teacher && !g.hasAccount && <button className="btn small" type="button" disabled={busy} onClick={() => void createAccount()}>إنشاء حساب دخول</button>}
        {!teacher && g.hasAccount && <button className="btn ghost small" type="button" onClick={() => setMode("password")}>كلمة مرور جديدة</button>}
        {!teacher && g.hasAccount && (
          <button className={`btn ghost small ${g.active ? "danger" : ""}`} type="button" disabled={busy} onClick={async () => {
            if (g.active && !(await confirm({ title: "إيقاف الحساب", message: "لن يستطيع ولي الأمر الدخول حتى تُعيد تفعيله.", confirmLabel: "إيقاف", danger: true }))) return;
            if (await run(() => api(`/api/guardians/${g.id}/active`, { method: "POST", body: { active: !g.active } }), g.active ? "أُوقف الحساب" : "أُعيد تفعيل الحساب")) onChanged();
          }}>{g.active ? "إيقاف الحساب" : "تفعيل الحساب"}</button>
        )}
      </div>
    </Sheet>
  );
}

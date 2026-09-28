import { useState, type FormEvent } from "react";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";

interface Announcement { id: string; title: string; body: string; audience: "all" | "students" | "staff"; scopeKind: "center" | "stage" | "circle"; scopeId: string | null; createdAt: number; authorId: string; authorName: string }
const AUDIENCE: Record<string, string> = { all: "الجميع", students: "الطلاب وأولياء الأمور", staff: "الكادر" };

/** رسائل الإدارة: تُرسل كإشعارات للأهالي أو الكادر أو الجميع. */
export function Announcements() {
  const { user } = useMe();
  const canWrite = ["admin", "secretary", "teacher", "stage_manager"].includes(user.role);
  const canDelete = (a: Announcement) => user.role === "admin" || user.role === "secretary" || ((user.role === "teacher" || user.role === "stage_manager") && a.authorId === user.id);
  const { data, error, reload } = useFetch<{ announcements: Announcement[] }>("/api/announcements");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const { confirm } = useUi();
  const { run } = useAction();
  const remove = async (a: Announcement) => {
    if (!(await confirm({ title: "حذف الرسالة من الجميع؟", message: "ستُحذف الرسالة وإشعاراتها من حسابات المستلمين. التنبيه الذي ظهر سابقاً على شاشة الهاتف لا يمكن سحبه من الجهاز.", confirmLabel: "حذف من الجميع", danger: true }))) return;
    if (await run(() => api(`/api/announcements/${a.id}`, { method: "DELETE" }), "حُذفت الرسالة من حسابات المستلمين")) void reload();
  };
  return (
    <main className="page">
      <div className="page-head"><div><h1>الرسائل والتعاميم</h1><p>رسائل الإدارة والمرحلة والحلقة</p></div></div>
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {data?.announcements.map((a) => (
          <div key={a.id} className="card">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ flex: 1 }}>{a.title}</b><span className="chip gold">{a.scopeKind === "center" ? AUDIENCE[a.audience] : a.scopeKind === "stage" ? "أولياء المرحلة" : "أولياء الحلقة"}</span></div>
            <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{a.body}</p>
            <small className="muted">{a.authorName} · {new Date(a.createdAt).toLocaleDateString("ar-EG-u-nu-latn")}</small>
            {canDelete(a) && <div className="actions" style={{ marginTop: 6 }}>
              <button className="btn ghost small" type="button" onClick={() => setEditing(a)}>تعديل</button>
              <button className="btn ghost danger small" type="button" onClick={() => void remove(a)}>حذف من الجميع</button>
            </div>}
          </div>
        ))}
        {data && !data.announcements.length && <div className="empty">لا توجد رسائل بعد.</div>}
      </div>
      {canWrite && <button className="fab" type="button" aria-label="رسالة جديدة" onClick={() => setAdding(true)}>＋</button>}
      {adding && <NewAnnouncement onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
      {editing && <EditAnnouncement announcement={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </main>
  );
}

function EditAnnouncement({ announcement, onClose, onSaved }: { announcement: Announcement; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => api(`/api/announcements/${announcement.id}`, { method: "PATCH", body: { title: f.get("title"), body: f.get("body") } }), "عُدّلت الرسالة لدى المستلمين")) onSaved();
  };
  return (
    <Sheet title="تعديل الرسالة" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <p className="muted">سيُحدّث العنوان والنص في إشعارات المستلمين داخل الموقع. تنبيه الهاتف الذي ظهر سابقاً لن يتغير، ولن تُرسل رسالة جديدة.</p>
        <Field label="العنوان"><input name="title" defaultValue={announcement.title} required minLength={2} maxLength={120} /></Field>
        <Field label="نص الرسالة"><textarea name="body" defaultValue={announcement.body} required minLength={2} maxLength={2000} /></Field>
        <button className="btn" disabled={busy}>حفظ التعديل</button>
      </form>
    </Sheet>
  );
}

function NewAnnouncement({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user, settings } = useMe();
  const { data: scopes } = useFetch<{ circles: Array<{ id: string; name: string; levelKey: string }>; stages: string[] }>("/api/announcements/scopes");
  const [scopeKind, setScopeKind] = useState<"center" | "stage" | "circle">(user.role === "teacher" ? "circle" : user.role === "stage_manager" ? "stage" : "center");
  const { busy, run } = useAction();
  const { toast } = useUi();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let recipients = 0;
    const ok = await run(async () => {
      const r = await api<{ recipients: number }>("/api/announcements", { method: "POST", body: { title: f.get("title"), body: f.get("body"), audience: scopeKind === "center" ? f.get("audience") : "students", scopeKind, scopeId: scopeKind === "center" ? undefined : f.get("scopeId") } });
      recipients = r.recipients;
    });
    if (ok) { toast(`أُرسلت الرسالة إلى ${recipients} مستلماً`); onSaved(); }
  };
  return (
    <Sheet title="رسالة جديدة" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="النطاق"><select value={scopeKind} onChange={(e) => setScopeKind(e.target.value as typeof scopeKind)}>
          {(user.role === "admin" || user.role === "secretary") && <option value="center">المركز كله</option>}
          {user.role !== "teacher" && <option value="stage">مرحلة</option>}
          <option value="circle">حلقة</option>
        </select></Field>
        {scopeKind === "center" ? <Field label="إلى"><select name="audience" defaultValue="students">{Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field> :
          <Field label={scopeKind === "stage" ? "المرحلة" : "الحلقة"}><select name="scopeId" required key={scopeKind}>
            <option value="">اختر</option>
            {scopeKind === "stage" ? (user.role === "stage_manager" ? scopes?.stages : settings.levels.map((l) => l.key))?.map((key) => <option key={key} value={key}>{settings.levels.find((l) => l.key === key)?.label ?? key}</option>) : scopes?.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
          </select></Field>}
        <Field label="العنوان"><input name="title" required minLength={2} maxLength={120} placeholder="مثال: إجازة الأسبوع القادم" /></Field>
        <Field label="نص الرسالة"><textarea name="body" required minLength={2} maxLength={2000} /></Field>
        <button className="btn" disabled={busy}>إرسال</button>
      </form>
    </Sheet>
  );
}

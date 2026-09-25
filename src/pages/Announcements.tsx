import { useState, type FormEvent } from "react";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";

interface Announcement { id: string; title: string; body: string; audience: "all" | "students" | "staff"; createdAt: number; authorName: string }
const AUDIENCE: Record<string, string> = { all: "الجميع", students: "الطلاب وأولياء الأمور", staff: "الكادر" };

/** رسائل الإدارة: تُرسل كإشعارات للأهالي أو الكادر أو الجميع. */
export function Announcements() {
  const { user } = useMe();
  const canWrite = user.role === "admin" || user.role === "secretary";
  const { data, error, reload } = useFetch<{ announcements: Announcement[] }>("/api/announcements");
  const [adding, setAdding] = useState(false);
  const { confirm } = useUi();
  const { run } = useAction();
  const remove = async (a: Announcement) => {
    if (!(await confirm({ title: "حذف الرسالة؟", message: "الإشعارات التي وصلت للمستلمين تبقى عندهم.", confirmLabel: "حذف", danger: true }))) return;
    if (await run(() => api(`/api/announcements/${a.id}`, { method: "DELETE" }), "تم الحذف")) void reload();
  };
  return (
    <main className="page">
      <div className="page-head"><div><h1>رسائل الإدارة</h1><p>إعلانات للأهالي والكادر</p></div></div>
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {data?.announcements.map((a) => (
          <div key={a.id} className="card">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ flex: 1 }}>{a.title}</b><span className="chip gold">{AUDIENCE[a.audience]}</span></div>
            <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>{a.body}</p>
            <small className="muted">{a.authorName} · {new Date(a.createdAt).toLocaleDateString("ar-EG-u-nu-latn")}</small>
            {canWrite && <div><button className="btn ghost danger small" type="button" style={{ marginTop: 6 }} onClick={() => void remove(a)}>حذف</button></div>}
          </div>
        ))}
        {data && !data.announcements.length && <div className="empty">لا توجد رسائل بعد.</div>}
      </div>
      {canWrite && <button className="fab" type="button" aria-label="رسالة جديدة" onClick={() => setAdding(true)}>＋</button>}
      {adding && <NewAnnouncement onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
    </main>
  );
}

function NewAnnouncement({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const { toast } = useUi();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let recipients = 0;
    const ok = await run(async () => {
      const r = await api<{ recipients: number }>("/api/announcements", { method: "POST", body: { title: f.get("title"), body: f.get("body"), audience: f.get("audience") } });
      recipients = r.recipients;
    });
    if (ok) { toast(`أُرسلت الرسالة إلى ${recipients} مستلماً`); onSaved(); }
  };
  return (
    <Sheet title="رسالة جديدة" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="إلى"><select name="audience" defaultValue="students">{Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="العنوان"><input name="title" required minLength={2} maxLength={120} placeholder="مثال: إجازة الأسبوع القادم" /></Field>
        <Field label="نص الرسالة"><textarea name="body" required minLength={2} maxLength={2000} /></Field>
        <button className="btn" disabled={busy}>إرسال</button>
      </form>
    </Sheet>
  );
}

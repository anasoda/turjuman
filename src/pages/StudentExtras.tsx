import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { compressImage } from "../lib/image";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";

interface Note { id: string; body: string; createdAt: number; authorId: string; authorName: string }

/** ملاحظات داخلية سرّية عن الطالب (للكادر فقط؛ لا تظهر للطالب ولا لولي الأمر). */
export function NotesSheet({ student, onClose }: { student: Student; onClose: () => void }) {
  const { user } = useMe();
  const { data, error, reload } = useFetch<{ notes: Note[] }>(`/api/notes?studentId=${student.id}`);
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body"));
    if (await run(() => api("/api/notes", { method: "POST", body: { studentId: student.id, body } }), "تمت الإضافة")) { form.reset(); void reload(); }
  };
  const remove = async (n: Note) => {
    if (!(await confirm({ title: "حذف الملاحظة؟", confirmLabel: "حذف", danger: true }))) return;
    if (await run(() => api(`/api/notes/${n.id}`, { method: "DELETE" }), "تم الحذف")) void reload();
  };
  return (
    <Sheet title={`ملاحظات داخلية — ${student.name}`} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>للكادر فقط: لا يراها الطالب ولا ولي الأمر.</p>
      <form className="form-grid" onSubmit={add}>
        <Field label="ملاحظة جديدة"><textarea name="body" required minLength={2} maxLength={1000} /></Field>
        <button className="btn small" disabled={busy}>إضافة</button>
      </form>
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {data?.notes.map((n) => (
          <div key={n.id} className="card">
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{n.body}</p>
            <small className="muted">{n.authorName} · {new Date(n.createdAt).toLocaleDateString("ar-EG-u-nu-latn")}</small>
            {(user.role !== "teacher" || n.authorId === user.id) && <div><button className="btn ghost danger small" type="button" onClick={() => void remove(n)}>حذف</button></div>}
          </div>
        ))}
        {data && !data.notes.length && <div className="empty">لا توجد ملاحظات.</div>}
      </div>
    </Sheet>
  );
}

/** الصورة الشخصية + موافقة لوحة الشرف + روابط الطباعة. */
export function StudentTools({ student, canHonor, onChanged }: { student: Student; canHonor: boolean; onChanged: () => void }) {
  const full = useFetch<{ student: Student }>(`/api/students/${student.id}`);
  const { run } = useAction();
  const [notes, setNotes] = useState(false);
  const { user } = useMe();
  const photo = full.data?.student.photo;

  const pick = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      const dataUrl = await compressImage(file, { max: 256, quality: 0.8, maxChars: 200_000 });
      await api(`/api/students/${student.id}/photo`, { method: "POST", body: { photo: dataUrl } });
      await full.reload();
      onChanged();
    }, "تم تحديث الصورة");
  };
  const removePhoto = async () => { if (await run(() => api(`/api/students/${student.id}/photo`, { method: "POST", body: { photo: "" } }), "تمت إزالة الصورة")) { await full.reload(); onChanged(); } };
  const consent = async (v: boolean) => { await run(() => api("/api/honor/consent", { method: "POST", body: { studentId: student.id, consent: v } }), v ? "سيظهر في لوحة الشرف" : "لن يظهر في لوحة الشرف"); };

  return (
    <div className="form-grid">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span className="avatar" style={{ width: 64, height: 64, overflow: "hidden" }}>{photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : student.name.charAt(0)}</span>
        <div className="actions">
          <label className="btn ghost small" style={{ cursor: "pointer" }}>{photo ? "تغيير الصورة" : "إضافة صورة"}<input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
          {photo && <button className="btn ghost danger small" type="button" onClick={() => void removePhoto()}>إزالة</button>}
        </div>
      </div>
      <div className="actions">
        <button className="btn ghost small" type="button" onClick={() => setNotes(true)}>ملاحظات داخلية</button>
        <Link className="btn ghost small" to={`/app/print/${student.id}?type=report`}>تقرير مطبوع</Link>
        <Link className="btn ghost small" to={`/app/print/${student.id}?type=certificate`}>شهادة</Link>
        <Link className="btn ghost small" to={`/app/print/${student.id}?type=card`}>بطاقة</Link>
      </div>
      {canHonor && user.role !== "teacher" && (
        <label className="radio-row"><span style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" defaultChecked={student.honorConsent} onChange={(e) => void consent(e.target.checked)} style={{ width: 18, height: 18 }} />وافق ولي الأمر على ظهور الاسم في لوحة الشرف</span></label>
      )}
      {notes && <NotesSheet student={student} onClose={() => setNotes(false)} />}
    </div>
  );
}

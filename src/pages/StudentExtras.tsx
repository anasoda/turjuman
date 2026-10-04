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
    if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`/api/notes/${n.id}`, { method: "DELETE" }), "حذف")) void reload();
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

/** أزرار تغيير الصورة الشخصية وإزالتها (الصورة نفسها تُعرض في رأس بطاقة الطالب). تُحفظ بدقة أعلى وبلا اقتصاص ليمكن عرضها كاملة مكبّرة. */
export function PhotoControls({ student, photo, onUpdated }: { student: Student; photo?: string; onUpdated: () => void }) {
  const { run } = useAction();
  const pick = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      const dataUrl = await compressImage(file, { max: 640, quality: 0.72, maxChars: 240_000 });
      await api(`/api/students/${student.id}/photo`, { method: "POST", body: { photo: dataUrl } });
      onUpdated();
    }, "تم تحديث الصورة");
  };
  const remove = async () => { if (await run(() => api(`/api/students/${student.id}/photo`, { method: "POST", body: { photo: "" } }), "تمت إزالة الصورة")) onUpdated(); };
  return (
    <div className="actions">
      <label className="btn ghost small" style={{ cursor: "pointer" }}>{photo ? "تغيير الصورة" : "إضافة صورة"}<input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
      {photo && <button className="btn ghost danger small" type="button" onClick={() => void remove()}>إزالة</button>}
    </div>
  );
}

/** تقارير وطباعة + ملاحظات داخلية + موافقة لوحة الشرف. */
export function StudentTools({ student, canHonor, section }: { student: Student; canHonor: boolean; section: "print" | "manage" }) {
  const { run } = useAction();
  const [notes, setNotes] = useState(false);
  const { user } = useMe();
  const consent = async (v: boolean) => { await run(async () => { await api("/api/honor/consent", { method: "POST", body: { studentId: student.id, consent: v } }); }, v ? "سيظهر في لوحة الشرف" : "لن يظهر في لوحة الشرف"); };
  if (section === "print") {
    return (
      <div className="actions">
        <Link className="btn ghost small" to={`/app/print/${student.id}?type=report`}>تقرير الطالب كصورة</Link>
        <Link className="btn ghost small" to={`/app/print/${student.id}?type=certificate`}>شهادة</Link>
        <Link className="btn ghost small" to={`/app/print/${student.id}?type=card`}>بطاقة</Link>
      </div>
    );
  }
  return (
    <>
      <button className="btn ghost small" type="button" onClick={() => setNotes(true)}>ملاحظات داخلية</button>
      {canHonor && user.role !== "teacher" && (
        <label className="sd-toggle"><input type="checkbox" defaultChecked={student.honorConsent} onChange={(e) => void consent(e.target.checked)} /><span>وافق ولي الأمر على ظهور الاسم في لوحة الشرف</span></label>
      )}
      {notes && <NotesSheet student={student} onClose={() => setNotes(false)} />}
    </>
  );
}

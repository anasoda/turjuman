import { useState, type FormEvent } from "react";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";
import { countAr, STUDENTS_AR } from "../lib/format";

interface Course { id: string; name: string; startsOn: string | null; endsOn: string | null; status: "active" | "ended"; studentCount: number }

/** دورات الأحكام: الاسم والتواريخ والمشاركون والحالة (جارية/منتهية). */
export function Courses() {
  const { user } = useMe();
  const canManage = user.role === "admin" || user.role === "secretary";
  const { data, error, reload } = useFetch<{ courses: Course[] }>("/api/courses");
  const [form, setForm] = useState<Course | "new" | null>(null);
  return (
    <main className="page">
      <div className="page-head"><div><h1>دورات الأحكام</h1><p>{data?.courses.filter((c) => c.status === "active").length ?? 0} دورة جارية</p></div></div>
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {data?.courses.map((c) => (
          <button key={c.id} type="button" className="card row-card" onClick={() => canManage && setForm(c)} style={{ cursor: canManage ? "pointer" : "default" }}>
            <span className="grow"><b>{c.name}</b><small>{c.startsOn ?? "—"} ← {c.endsOn ?? "—"} · {countAr(c.studentCount, STUDENTS_AR)}</small></span>
            <span className={`chip ${c.status === "ended" ? "gold" : ""}`}>{c.status === "active" ? "جارية" : "منتهية"}</span>
          </button>
        ))}
        {data && !data.courses.length && <div className="empty">لا توجد دورات بعد.</div>}
      </div>
      {canManage && <button className="fab" type="button" aria-label="إضافة دورة" onClick={() => setForm("new")}>＋</button>}
      {form && <CourseForm course={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
    </main>
  );
}

function CourseForm({ course, onClose, onSaved }: { course: Course | null; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const students = useFetch<{ students: Student[] }>("/api/students?pageSize=100");
  const current = useFetch<{ students: Array<{ id: string }> }>(course ? `/api/courses/${course.id}` : null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set((current.data?.students ?? []).map((s) => s.id));
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get("name")), startsOn: String(f.get("startsOn")) || null, endsOn: String(f.get("endsOn")) || null, status: String(f.get("status")), studentIds: [...selected] };
    if (await run(() => (course ? api(`/api/courses/${course.id}`, { method: "PUT", body }) : api("/api/courses", { method: "POST", body })), "تم الحفظ")) onSaved();
  };
  const remove = async () => {
    if (!course || !(await confirm({ title: `حذف ${course.name}؟`, confirmLabel: "حذف", danger: true }))) return;
    if (await run(() => api(`/api/courses/${course.id}`, { method: "DELETE" }), "تم الحذف")) onSaved();
  };

  return (
    <Sheet title={course ? "تعديل الدورة" : "إضافة دورة"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="اسم الدورة"><input name="name" required minLength={2} defaultValue={course?.name} placeholder="مثال: دورة التأهيلية" /></Field>
        <div className="form-grid two">
          <Field label="تبدأ في"><input name="startsOn" type="date" defaultValue={course?.startsOn ?? ""} /></Field>
          <Field label="تنتهي في"><input name="endsOn" type="date" defaultValue={course?.endsOn ?? ""} /></Field>
        </div>
        <Field label="الحالة"><select name="status" defaultValue={course?.status ?? "active"}><option value="active">جارية</option><option value="ended">منتهية</option></select></Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ fontSize: ".85rem", marginBottom: 4 }}>المشاركون ({selected.size})</legend>
          <div className="list" style={{ maxHeight: 200, overflow: "auto" }}>
            {students.data?.students.map((s) => (
              <label key={s.id} className="card row-card" style={{ padding: 10 }}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} style={{ width: 20, height: 20 }} />
                <span className="grow"><b>{s.name}</b><small>{s.circleName ?? "—"}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="actions">
          <button className="btn" disabled={busy}>{course ? "حفظ" : "إضافة"}</button>
          {course && <button className="btn ghost danger" type="button" onClick={() => void remove()}>حذف</button>}
        </div>
      </form>
    </Sheet>
  );
}

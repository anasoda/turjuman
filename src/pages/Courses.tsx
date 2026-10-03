import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useDebounced, useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";
import { countAr, STUDENTS_AR } from "../lib/format";

interface Course { id: string; name: string; startsOn: string | null; endsOn: string | null; status: "active" | "ended"; studentCount: number; teacherId: string | null; teacherName: string | null; sessionCount: number; lastTopic: string | null; attendancePct: number | null }

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
          <div key={c.id} className="card row-card" style={{ cursor: "default" }}>
            <Link to={`/app/courses/${c.id}`} className="grow" style={{ color: "inherit", textDecoration: "none" }}>
              <b>{c.name}</b>
              <small>{c.teacherName ? `الشيخ: ${c.teacherName}` : "بلا شيخ"} · {countAr(c.studentCount, STUDENTS_AR)}</small>
              <small>{c.sessionCount ? `${c.sessionCount} لقاء${c.attendancePct !== null ? ` · حضور ${c.attendancePct}٪` : ""}${c.lastTopic ? ` · آخر درس: ${c.lastTopic}` : ""}` : "لا لقاءات بعد"}</small>
            </Link>
            <span className={`chip ${c.status === "ended" ? "gold" : ""}`}>{c.status === "active" ? "جارية" : "منتهية"}</span>
            {canManage && <button className="btn ghost small" type="button" onClick={() => setForm(c)}>تعديل</button>}
          </div>
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
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query);
  const students = useFetch<{ students: Student[] }>(`/api/students?pageSize=100${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`);
  const current = useFetch<{ students: Array<{ id: string; name: string }> }>(course ? `/api/courses/${course.id}` : null);
  const staff = useFetch<{ staff: Array<{ id: string; role: string; displayName: string; active: boolean }> }>("/api/staff");
  const teachers = (staff.data?.staff ?? []).filter((s) => s.role === "teacher" && s.active);
  const [picked, setPicked] = useState<Map<string, { id: string; name: string; circleName?: string | null }> | null>(null);
  const selected: Map<string, { id: string; name: string; circleName?: string | null }> = picked ?? new Map((current.data?.students ?? []).map((s) => [s.id, s]));
  const visible = [...selected.values()].filter((s) => !students.data?.students.some((x) => x.id === s.id)).concat(students.data?.students ?? []);
  const toggle = (student: { id: string; name: string; circleName?: string | null }) => { const n = new Map(selected); n.has(student.id) ? n.delete(student.id) : n.set(student.id, student); setPicked(n); };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get("name")), startsOn: String(f.get("startsOn")) || null, endsOn: String(f.get("endsOn")) || null, status: String(f.get("status")), teacherId: String(f.get("teacherId")) || null, studentIds: [...selected.keys()] };
    if (await run(() => (course ? api(`/api/courses/${course.id}`, { method: "PUT", body }) : api("/api/courses", { method: "POST", body })), "تم الحفظ")) onSaved();
  };
  const remove = async () => {
    if (!course || !(await confirm({ title: `حذف ${course.name}؟`, confirmLabel: "حذف", danger: true }))) return;
    if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`/api/courses/${course.id}`, { method: "DELETE" }), "حذف")) onSaved();
  };

  return (
    <Sheet title={course ? "تعديل الدورة" : "إضافة دورة"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="اسم الدورة"><input name="name" required minLength={2} defaultValue={course?.name} placeholder="مثال: دورة التأهيلية" /></Field>
        <div className="form-grid two">
          <Field label="تبدأ في"><input name="startsOn" type="date" defaultValue={course?.startsOn ?? ""} /></Field>
          <Field label="تنتهي في"><input name="endsOn" type="date" defaultValue={course?.endsOn ?? ""} /></Field>
        </div>
        <Field label="شيخ الدورة" hint="يرى الدورة ويتابعها؛ لا يشترط أن يكون محفّظ الطلاب">
          <select name="teacherId" defaultValue={course?.teacherId ?? ""}>
            <option value="">بلا شيخ بعد</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </Field>
        <Field label="الحالة"><select name="status" defaultValue={course?.status ?? "active"}><option value="active">جارية</option><option value="ended">منتهية</option></select></Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ fontSize: ".85rem", marginBottom: 4 }}>المشاركون ({selected.size})</legend>
          <input className="input" placeholder="ابحث عن طالب بالاسم أو رقم الهوية" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="list" style={{ maxHeight: 200, overflow: "auto" }}>
            {visible.map((s) => (
              <label key={s.id} className="card row-card" style={{ padding: 10 }}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s)} style={{ width: 20, height: 20 }} />
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

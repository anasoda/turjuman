import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { ATTENDANCE_LABELS, fmtDay, todayIso } from "../lib/format";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";

type Status = keyof typeof ATTENDANCE_LABELS;
interface SessionRow { id: string; heldOn: string; coveredTopic: string; nextTopic: string; homework: string; attendance: Record<string, Status> }
interface Overview {
  course: { id: string; name: string; status: "active" | "ended"; startsOn: string | null; endsOn: string | null; teacherName: string | null };
  students: Array<{ id: string; name: string }>;
  sessions: SessionRow[];
  notes: Array<{ id: string; studentId: string; studentName: string; note: string; createdAt: number; authorName: string | null }>;
  events: Array<{ id: string; kind: "homework" | "exam" | "other"; title: string; dueOn: string | null }>;
}

const TABS = [["sessions", "اللقاءات"], ["notes", "الملاحظات"], ["events", "الواجبات والاختبارات"], ["students", "المشاركون"]] as const;
const KIND_LABELS = { homework: "واجب", exam: "اختبار", other: "إعلان" } as const;
const STATUS_ORDER: Status[] = ["present", "late", "excused", "absent"];

/** شاشة متابعة دورة أحكام: لقاءات وحضور وملاحظات وإعلانات. المتابعة على مستوى الدورة لا كل طالب. */
export function CourseDetail() {
  const { id } = useParams();
  const { user } = useMe();
  const canWrite = user.role !== "exam_committee";
  const { data, error, reload } = useFetch<Overview>(`/api/courses/${id}/overview`);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("sessions");
  const [form, setForm] = useState<null | "session" | "note" | "event">(null);
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const { run } = useAction();
  const { confirm } = useUi();

  if (error) return <main className="page"><div className="error-box">{error}</div></main>;
  if (!data) return <main className="page"><p className="muted">جارٍ التحميل…</p></main>;
  const { course, students, sessions, notes, events } = data;
  const close = () => { setForm(null); setEditing(null); };
  const saved = () => { close(); void reload(); };
  const remove = async (path: string, title: string) => {
    if (await confirm({ title, confirmLabel: "حذف", danger: true }) && await run(() => api(path, { method: "DELETE" }), "تم الحذف")) void reload();
  };
  const pct = (studentId: string) => {
    const rows = sessions.map((s) => s.attendance[studentId]).filter((x): x is Status => !!x && x !== "excused");
    return rows.length ? Math.round((rows.filter((x) => x === "present" || x === "late").length / rows.length) * 100) : null;
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{course.name}</h1>
          <p>{course.teacherName ? `الشيخ: ${course.teacherName}` : "بلا شيخ معيَّن"} · {course.status === "active" ? "جارية" : "منتهية"}</p>
        </div>
        <Link className="btn ghost small" to="/app/courses">الدورات</Link>
      </div>

      <div className="tabs" role="tablist" aria-label="أقسام الدورة">
        {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>

      {tab === "sessions" && (
        <div className="list">
          {sessions.map((s) => {
            const counts = STATUS_ORDER.map((st) => [st, Object.values(s.attendance).filter((x) => x === st).length] as const).filter(([, n]) => n);
            return (
              <button key={s.id} type="button" className="card row-card" onClick={() => { if (canWrite) { setEditing(s); setForm("session"); } }} style={{ cursor: canWrite ? "pointer" : "default" }}>
                <span className="grow">
                  <b>{fmtDay(s.heldOn)}</b>
                  <small>{s.coveredTopic ? `الدرس: ${s.coveredTopic}` : "بلا درس مسجّل"}</small>
                  {s.nextTopic && <small>القادم: {s.nextTopic}</small>}
                  {s.homework && <small>الواجب: {s.homework}</small>}
                </span>
                <span className="chip">{counts.map(([st, n]) => `${ATTENDANCE_LABELS[st]} ${n}`).join(" · ") || "بلا حضور"}</span>
              </button>
            );
          })}
          {!sessions.length && <div className="empty">لا لقاءات مسجّلة بعد.</div>}
        </div>
      )}

      {tab === "notes" && (
        <div className="list">
          {notes.map((n) => (
            <div key={n.id} className="card row-card" style={{ cursor: "default" }}>
              <span className="grow"><b>{n.studentName}</b><small>{n.note}</small><small>{n.authorName ?? "—"} · {new Date(n.createdAt).toLocaleDateString("ar-EG-u-nu-latn")}</small></span>
              {canWrite && <button className="btn ghost danger small" type="button" onClick={() => void remove(`/api/courses/${course.id}/notes/${n.id}`, "حذف الملاحظة؟")}>حذف</button>}
            </div>
          ))}
          {!notes.length && <div className="empty">لا ملاحظات بعد.</div>}
        </div>
      )}

      {tab === "events" && (
        <div className="list">
          {events.map((e) => (
            <div key={e.id} className="card row-card" style={{ cursor: "default" }}>
              <span className="grow"><b>{e.title}</b><small>{e.dueOn ? fmtDay(e.dueOn) : "بلا تاريخ"}</small></span>
              <span className={`chip ${e.kind === "exam" ? "gold" : ""}`}>{KIND_LABELS[e.kind]}</span>
              {canWrite && <button className="btn ghost danger small" type="button" onClick={() => void remove(`/api/courses/${course.id}/events/${e.id}`, "حذف الإعلان؟")}>حذف</button>}
            </div>
          ))}
          {!events.length && <div className="empty">لا واجبات أو اختبارات معلنة.</div>}
        </div>
      )}

      {tab === "students" && (
        <div className="list">
          {students.map((s) => {
            const p = pct(s.id);
            return <div key={s.id} className="card row-card" style={{ cursor: "default" }}><span className="grow"><b>{s.name}</b></span><span className="chip">{p === null ? "لا حضور" : `حضور ${p}٪`}</span></div>;
          })}
          {!students.length && <div className="empty">لا مشاركين في هذه الدورة.</div>}
        </div>
      )}

      {canWrite && tab !== "students" && (
        <button className="fab" type="button" aria-label="إضافة" onClick={() => setForm(tab === "sessions" ? "session" : tab === "notes" ? "note" : "event")}>＋</button>
      )}
      {form === "session" && <SessionForm courseId={course.id} students={students} session={editing} onClose={close} onSaved={saved} onDelete={editing ? () => { const s = editing; close(); void remove(`/api/courses/${course.id}/sessions/${s.id}`, "حذف اللقاء؟"); } : undefined} />}
      {form === "note" && <NoteForm courseId={course.id} students={students} onClose={close} onSaved={saved} />}
      {form === "event" && <EventForm courseId={course.id} onClose={close} onSaved={saved} />}
    </main>
  );
}

function SessionForm({ courseId, students, session, onClose, onSaved, onDelete }: { courseId: string; students: Overview["students"]; session: SessionRow | null; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const { busy, run } = useAction();
  const [att, setAtt] = useState<Record<string, Status>>(() => Object.fromEntries(students.map((s) => [s.id, session?.attendance[s.id] ?? "present"])));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      heldOn: String(f.get("heldOn")),
      coveredTopic: String(f.get("coveredTopic")),
      nextTopic: String(f.get("nextTopic")),
      homework: String(f.get("homework")),
      attendance: students.map((s) => ({ studentId: s.id, status: att[s.id] }))
    };
    const call = session ? api(`/api/courses/${courseId}/sessions/${session.id}`, { method: "PUT", body }) : api(`/api/courses/${courseId}/sessions`, { method: "POST", body });
    if (await run(() => call, "تم الحفظ")) onSaved();
  };
  return (
    <Sheet title={session ? "تعديل اللقاء" : "لقاء جديد"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="تاريخ اللقاء"><input name="heldOn" type="date" required defaultValue={session?.heldOn ?? todayIso()} /></Field>
        <Field label="الدرس المأخوذ"><input name="coveredTopic" maxLength={300} defaultValue={session?.coveredTopic} placeholder="مثال: أحكام النون الساكنة" /></Field>
        <Field label="الدرس القادم" hint="يظهر لولي الأمر كموضع اللقاء القادم"><input name="nextTopic" maxLength={300} defaultValue={session?.nextTopic} /></Field>
        <Field label="الواجب (اختياري)"><input name="homework" maxLength={500} defaultValue={session?.homework} /></Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ fontSize: ".85rem", marginBottom: 4 }}>الحضور ({students.length})</legend>
          <div className="list" style={{ maxHeight: 280, overflow: "auto" }}>
            {students.map((s) => (
              <div key={s.id} className="card row-card" style={{ padding: 10, cursor: "default" }}>
                <span className="grow"><b>{s.name}</b></span>
                <select aria-label={`حضور ${s.name}`} value={att[s.id]} onChange={(e) => setAtt({ ...att, [s.id]: e.target.value as Status })}>
                  {STATUS_ORDER.map((st) => <option key={st} value={st}>{ATTENDANCE_LABELS[st]}</option>)}
                </select>
              </div>
            ))}
            {!students.length && <div className="empty">أضف مشاركين للدورة أولاً.</div>}
          </div>
        </fieldset>
        <div className="actions">
          <button className="btn" disabled={busy}>حفظ</button>
          {onDelete && <button className="btn ghost danger" type="button" onClick={onDelete}>حذف</button>}
        </div>
      </form>
    </Sheet>
  );
}

function NoteForm({ courseId, students, onClose, onSaved }: { courseId: string; students: Overview["students"]; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { studentId: String(f.get("studentId")), note: String(f.get("note")), notify: f.get("notify") === "on" };
    if (await run(() => api(`/api/courses/${courseId}/notes`, { method: "POST", body }), "تمت إضافة الملاحظة")) onSaved();
  };
  return (
    <Sheet title="ملاحظة على طالب" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="الطالب"><select name="studentId" required defaultValue="">{[<option key="" value="" disabled>اختر الطالب</option>, ...students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</select></Field>
        <Field label="الملاحظة" hint="تظهر لولي الأمر دائماً في بوابته"><textarea name="note" required maxLength={1000} placeholder="مثال: يحتاج إلى مراجعة أحكام المدود" /></Field>
        <label className="row-card" style={{ cursor: "pointer" }}><input name="notify" type="checkbox" style={{ width: 20, height: 20 }} /><span className="grow">أرسل إشعاراً لولي الأمر الآن</span></label>
        <div className="actions"><button className="btn" disabled={busy}>إضافة</button></div>
      </form>
    </Sheet>
  );
}

function EventForm({ courseId, onClose, onSaved }: { courseId: string; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { kind: String(f.get("kind")), title: String(f.get("title")), dueOn: String(f.get("dueOn")) || null };
    if (await run(() => api(`/api/courses/${courseId}/events`, { method: "POST", body }), "تم الإعلان")) onSaved();
  };
  return (
    <Sheet title="واجب أو اختبار" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="النوع"><select name="kind" defaultValue="homework"><option value="homework">واجب</option><option value="exam">اختبار</option><option value="other">إعلان</option></select></Field>
        <Field label="العنوان"><input name="title" required minLength={2} maxLength={200} placeholder="مثال: اختبار أحكام الميم الساكنة" /></Field>
        <Field label="التاريخ (اختياري)"><input name="dueOn" type="date" /></Field>
        <div className="actions"><button className="btn" disabled={busy}>إضافة</button></div>
      </form>
    </Sheet>
  );
}

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { accessibleCourse } from "../lib/courses";
import { newId } from "../lib/crypto";
import { DATE_RE, todayHebron } from "../lib/dates";
import { notifyMany, studentRecipients } from "../lib/notify";
import { audit, fail, parseBody } from "../lib/util";

/** متابعة دورات الأحكام: لقاءات وحضور وملاحظات وإعلانات. تُركَّب على /api/courses قبل مسارات الدورات الأساسية. */
export const ajkamRoutes = new Hono<AppEnv>();

const STAFF = ["admin", "secretary", "teacher", "stage_manager", "exam_committee"] as const;
const WRITERS = ["admin", "secretary", "teacher", "stage_manager"] as const;

const STATUSES = ["present", "absent", "late", "excused"] as const;

const sessionSchema = z.object({
  heldOn: z.string().regex(DATE_RE, "تاريخ اللقاء غير صحيح"),
  coveredTopic: z.string().trim().max(300).default(""),
  nextTopic: z.string().trim().max(300).default(""),
  homework: z.string().trim().max(500).default(""),
  attendance: z.array(z.object({ studentId: z.string().min(1), status: z.enum(STATUSES) })).max(500).default([])
});
const noteSchema = z.object({
  studentId: z.string().min(1),
  note: z.string().trim().min(1, "اكتب الملاحظة").max(1000),
  notify: z.boolean().default(false)
});
const eventSchema = z.object({
  kind: z.enum(["homework", "exam", "other"]),
  title: z.string().trim().min(2, "اكتب عنواناً قصيراً").max(200),
  dueOn: z.string().regex(DATE_RE).nullable().default(null)
});

async function participantIds(db: D1Database, courseId: string): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT student_id AS id FROM ajkam_course_students WHERE course_id = ?").bind(courseId).all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/** صفوف الحضور بعد التحقق أن كل طالب مشارك في الدورة (لا يُقبل طالب من خارجها). */
async function cleanAttendance(db: D1Database, courseId: string, rows: Array<{ studentId: string; status: (typeof STATUSES)[number] }>) {
  const allowed = await participantIds(db, courseId);
  const seen = new Map<string, (typeof STATUSES)[number]>();
  for (const r of rows) {
    if (!allowed.has(r.studentId)) fail(400, "طالب غير مشارك في هذه الدورة");
    seen.set(r.studentId, r.status);
  }
  return [...seen.entries()];
}

/** بوابة ولي الأمر: دورات ابنه (يُقارَن guardian_id بـ auth.guardianId، لا userId). */
ajkamRoutes.get("/portal/:studentId", requireAuth("guardian"), async (c) => {
  const auth = c.get("auth");
  const studentId = c.req.param("studentId");
  const own = await c.env.DB.prepare("SELECT 1 FROM students WHERE id = ? AND center_id = ? AND guardian_id = ?").bind(studentId, auth.centerId, auth.guardianId ?? "").first();
  if (!own) fail(404, "الطالب غير موجود");
  const today = todayHebron();
  const { results: courses } = await c.env.DB.prepare(
    `SELECT ac.id, ac.name, ac.status, ac.starts_on AS startsOn, ac.ends_on AS endsOn, u.display_name AS teacherName
       FROM ajkam_course_students x JOIN ajkam_courses ac ON ac.id = x.course_id LEFT JOIN users u ON u.id = ac.teacher_id
      WHERE x.student_id = ? AND ac.center_id = ? ORDER BY ac.status, ac.created_at DESC`
  ).bind(studentId, auth.centerId).all<{ id: string; name: string; status: string; startsOn: string | null; endsOn: string | null; teacherName: string | null }>();

  const out = [];
  for (const course of courses) {
    const [latest, events, attendance, notes] = await Promise.all([
      c.env.DB.prepare("SELECT held_on AS heldOn, covered_topic AS coveredTopic, next_topic AS nextTopic, homework FROM ajkam_sessions WHERE course_id = ? ORDER BY held_on DESC LIMIT 1").bind(course.id).first(),
      c.env.DB.prepare("SELECT id, kind, title, due_on AS dueOn FROM ajkam_events WHERE course_id = ? AND (due_on IS NULL OR due_on >= ?) ORDER BY due_on IS NULL, due_on LIMIT 10").bind(course.id, today).all(),
      c.env.DB.prepare("SELECT s.held_on AS heldOn, a.status FROM ajkam_attendance a JOIN ajkam_sessions s ON s.id = a.session_id WHERE s.course_id = ? AND a.student_id = ? ORDER BY s.held_on DESC LIMIT 60").bind(course.id, studentId).all<{ heldOn: string; status: string }>(),
      c.env.DB.prepare("SELECT n.id, n.note, n.created_at AS createdAt, u.display_name AS authorName FROM ajkam_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.course_id = ? AND n.student_id = ? ORDER BY n.created_at DESC LIMIT 50").bind(course.id, studentId).all()
    ]);
    const counted = attendance.results.filter((r) => r.status !== "excused");
    out.push({
      ...course,
      latest: latest ?? null,
      events: events.results,
      attendance: attendance.results,
      attendancePct: counted.length ? Math.round((counted.filter((r) => r.status === "present" || r.status === "late").length / counted.length) * 100) : null,
      notes: notes.results
    });
  }
  return c.json({ courses: out });
});

/** كل ما تحتاجه شاشة الدورة في طلب واحد. */
ajkamRoutes.get("/:id/overview", requireAuth(...STAFF), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), false);
  const [info, students, sessions, att, notes, events] = await Promise.all([
    c.env.DB.prepare("SELECT ac.id, ac.name, ac.status, ac.starts_on AS startsOn, ac.ends_on AS endsOn, ac.teacher_id AS teacherId, u.display_name AS teacherName FROM ajkam_courses ac LEFT JOIN users u ON u.id = ac.teacher_id WHERE ac.id = ? AND ac.center_id = ?").bind(course.id, auth.centerId).first(),
    c.env.DB.prepare("SELECT s.id, s.name FROM ajkam_course_students x JOIN students s ON s.id = x.student_id WHERE x.course_id = ? ORDER BY s.name").bind(course.id).all<{ id: string; name: string }>(),
    c.env.DB.prepare("SELECT id, held_on AS heldOn, covered_topic AS coveredTopic, next_topic AS nextTopic, homework FROM ajkam_sessions WHERE course_id = ? ORDER BY held_on DESC").bind(course.id).all<{ id: string; heldOn: string; coveredTopic: string; nextTopic: string; homework: string }>(),
    c.env.DB.prepare("SELECT a.session_id AS sessionId, a.student_id AS studentId, a.status FROM ajkam_attendance a JOIN ajkam_sessions s ON s.id = a.session_id WHERE s.course_id = ?").bind(course.id).all<{ sessionId: string; studentId: string; status: string }>(),
    c.env.DB.prepare("SELECT n.id, n.student_id AS studentId, st.name AS studentName, n.note, n.created_at AS createdAt, u.display_name AS authorName FROM ajkam_notes n JOIN students st ON st.id = n.student_id LEFT JOIN users u ON u.id = n.created_by WHERE n.course_id = ? ORDER BY n.created_at DESC LIMIT 200").bind(course.id).all(),
    c.env.DB.prepare("SELECT id, kind, title, due_on AS dueOn FROM ajkam_events WHERE course_id = ? ORDER BY due_on IS NULL, due_on DESC").bind(course.id).all()
  ]);
  return c.json({
    course: info,
    students: students.results,
    sessions: sessions.results.map((s) => ({
      ...s,
      attendance: Object.fromEntries(att.results.filter((a) => a.sessionId === s.id).map((a) => [a.studentId, a.status]))
    })),
    notes: notes.results,
    events: events.results
  });
});

ajkamRoutes.post("/:id/sessions", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const b = await parseBody(c, sessionSchema);
  const dup = await c.env.DB.prepare("SELECT 1 FROM ajkam_sessions WHERE course_id = ? AND held_on = ?").bind(course.id, b.heldOn).first();
  if (dup) fail(409, "يوجد لقاء مسجَّل بهذا التاريخ، عدّله بدلاً من إضافة آخر");
  const rows = await cleanAttendance(c.env.DB, course.id, b.attendance);
  const id = newId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO ajkam_sessions (id, center_id, course_id, held_on, covered_topic, next_topic, homework, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, auth.centerId, course.id, b.heldOn, b.coveredTopic, b.nextTopic, b.homework, auth.userId, now, now),
    ...rows.map(([sid, status]) => c.env.DB.prepare("INSERT INTO ajkam_attendance (session_id, student_id, status) VALUES (?, ?, ?)").bind(id, sid, status))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "ajkam_session", entityId: id, details: `${course.name} ${b.heldOn}` });
  return c.json({ ok: true, id }, 201);
});

ajkamRoutes.put("/:id/sessions/:sid", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const sid = c.req.param("sid");
  const existing = await c.env.DB.prepare("SELECT id FROM ajkam_sessions WHERE id = ? AND course_id = ?").bind(sid, course.id).first();
  if (!existing) fail(404, "اللقاء غير موجود");
  const b = await parseBody(c, sessionSchema);
  const dup = await c.env.DB.prepare("SELECT 1 FROM ajkam_sessions WHERE course_id = ? AND held_on = ? AND id <> ?").bind(course.id, b.heldOn, sid).first();
  if (dup) fail(409, "يوجد لقاء آخر بهذا التاريخ");
  const rows = await cleanAttendance(c.env.DB, course.id, b.attendance);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE ajkam_sessions SET held_on = ?, covered_topic = ?, next_topic = ?, homework = ?, updated_at = ? WHERE id = ?").bind(b.heldOn, b.coveredTopic, b.nextTopic, b.homework, Date.now(), sid),
    c.env.DB.prepare("DELETE FROM ajkam_attendance WHERE session_id = ?").bind(sid),
    ...rows.map(([studentId, status]) => c.env.DB.prepare("INSERT INTO ajkam_attendance (session_id, student_id, status) VALUES (?, ?, ?)").bind(sid, studentId, status))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "ajkam_session", entityId: sid, details: `${course.name} ${b.heldOn}` });
  return c.json({ ok: true });
});

ajkamRoutes.delete("/:id/sessions/:sid", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const sid = c.req.param("sid");
  const existing = await c.env.DB.prepare("SELECT held_on AS heldOn FROM ajkam_sessions WHERE id = ? AND course_id = ?").bind(sid, course.id).first<{ heldOn: string }>();
  if (!existing) fail(404, "اللقاء غير موجود");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM ajkam_attendance WHERE session_id = ?").bind(sid), c.env.DB.prepare("DELETE FROM ajkam_sessions WHERE id = ?").bind(sid)]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "ajkam_session", entityId: sid, details: `${course.name} ${existing.heldOn}` });
  return c.json({ ok: true });
});

ajkamRoutes.post("/:id/notes", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const b = await parseBody(c, noteSchema);
  if (!(await participantIds(c.env.DB, course.id)).has(b.studentId)) fail(400, "طالب غير مشارك في هذه الدورة");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO ajkam_notes (id, center_id, course_id, student_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, auth.centerId, course.id, b.studentId, b.note, auth.userId, Date.now()).run();
  if (b.notify) {
    await notifyMany(c.env.DB, await studentRecipients(c.env.DB, b.studentId), {
      centerId: auth.centerId,
      kind: "ajkam_note",
      title: `ملاحظة في دورة ${course.name}`,
      body: b.note,
      link: `/app?studentId=${b.studentId}`
    });
  }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "ajkam_note", entityId: id, details: course.name });
  return c.json({ ok: true, id }, 201);
});

ajkamRoutes.delete("/:id/notes/:nid", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const res = await c.env.DB.prepare("DELETE FROM ajkam_notes WHERE id = ? AND course_id = ?").bind(c.req.param("nid"), course.id).run();
  if (!res.meta.changes) fail(404, "الملاحظة غير موجودة");
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "ajkam_note", entityId: c.req.param("nid"), details: course.name });
  return c.json({ ok: true });
});

ajkamRoutes.post("/:id/events", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const b = await parseBody(c, eventSchema);
  const id = newId();
  await c.env.DB.prepare("INSERT INTO ajkam_events (id, center_id, course_id, kind, title, due_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, auth.centerId, course.id, b.kind, b.title, b.dueOn, auth.userId, Date.now()).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "ajkam_event", entityId: id, details: `${course.name}: ${b.title}` });
  return c.json({ ok: true, id }, 201);
});

ajkamRoutes.delete("/:id/events/:eid", requireAuth(...WRITERS), async (c) => {
  const auth = c.get("auth");
  const course = await accessibleCourse(c, c.req.param("id"), true);
  const res = await c.env.DB.prepare("DELETE FROM ajkam_events WHERE id = ? AND course_id = ?").bind(c.req.param("eid"), course.id).run();
  if (!res.meta.changes) fail(404, "الإعلان غير موجود");
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "ajkam_event", entityId: c.req.param("eid"), details: course.name });
  return c.json({ ok: true });
});

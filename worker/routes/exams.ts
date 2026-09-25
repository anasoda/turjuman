import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { accessibleStudent, studentScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { DATE_RE, notTooFuture } from "../lib/dates";
import { notifyMany, studentRecipients } from "../lib/notify";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

export const testRoutes = new Hono<AppEnv>();

const rangeFields = {
  testType: z.enum(["single", "chain"]),
  parts: z.number().int().min(1, "عدد الأجزاء من 1 إلى 30").max(30, "عدد الأجزاء من 1 إلى 30"),
  // نطاق حرّ: نص يكتبه المستخدم أو يختاره من الاقتراحات (مثل «عمّ – المجادلة»)
  rangeText: z.string().trim().max(120).default("")
};

const trialSchema = z.object({
  id: z.string().uuid().optional(),
  studentId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  score: z.number().min(0).max(1000),
  notes: z.string().trim().max(300).default(""),
  ...rangeFields
});
const proposeSchema = z.object({ studentIds: z.array(z.string().min(1)).min(1, "اختر طالباً واحداً على الأقل").max(50), ...rangeFields });
const decideSchema = z.object({ testDate: z.string().regex(DATE_RE).nullable().default(null), notes: z.string().trim().max(300).default("") });
const resultSchema = z.object({ score: z.number().min(0).max(1000), testDate: z.string().regex(DATE_RE, "التاريخ غير صالح"), notes: z.string().trim().max(300).default("") });

const SELECT = `SELECT t.id, t.student_id AS studentId, s.name AS studentName, c.name AS circleName, t.kind, t.status, t.test_type AS testType, t.parts,
        t.range_text AS rangeText, t.test_date AS testDate, t.score, t.passed, t.notes, t.created_at AS createdAt,
        pu.display_name AS proposedByName, du.display_name AS decidedByName
   FROM tests t JOIN students s ON s.id = t.student_id LEFT JOIN circles c ON c.id = s.circle_id
   LEFT JOIN users pu ON pu.id = t.proposed_by LEFT JOIN users du ON du.id = t.decided_by`;

/** قائمة الاختبارات: ترقيم وبحث وتصفية بالحالة والنوع. المعلّم لطلابه، واللجنة والإداريون للكل. */
testRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "";
  const kind = url.searchParams.get("kind") || "";
  const studentId = url.searchParams.get("studentId") || "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const scope = studentScope(c);
  let where = `t.center_id = ?${scope.sql}`;
  const binds: unknown[] = [auth.centerId, ...scope.binds];
  if (["proposed", "approved", "rejected", "completed"].includes(status)) { where += " AND t.status = ?"; binds.push(status); }
  if (kind === "trial" || kind === "official") { where += " AND t.kind = ?"; binds.push(kind); }
  if (studentId) { where += " AND t.student_id = ?"; binds.push(studentId); }
  if (q) { where += " AND (s.name LIKE ? OR t.range_text LIKE ?)"; binds.push(`%${q}%`, `%${q}%`); }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tests t JOIN students s ON s.id = t.student_id WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return c.json({ tests: results, total: total?.n ?? 0, page, pageSize });
});

/** اختبار تجريبي: يسجّله المعلّم (أو الإداري) مباشرة بنتيجته. لا تقييد لقيمة العلامة؛ النجاح من إعدادات المركز. */
testRoutes.post("/trial", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, trialSchema);
  if (!notTooFuture(b.date)) fail(400, "لا يمكن التسجيل في تاريخ مستقبلي");
  const student = await accessibleStudent(c, b.studentId);
  if (student.archivedAt) fail(400, "الطالب مؤرشف");
  const settings = await loadSettings(c.env.DB, auth.centerId);
  const id = b.id ?? newId();
  if (b.id) {
    const dup = await c.env.DB.prepare("SELECT id FROM tests WHERE id = ?").bind(b.id).first();
    if (dup) return c.json({ ok: true, id, duplicate: true });
  }
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO tests (id, center_id, student_id, kind, status, test_type, parts, range_text, test_date, score, passed, proposed_by, decided_by, decided_at, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'trial', 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.centerId, student.id, b.testType, b.parts, b.rangeText, b.date, b.score, b.score >= settings.minPassScore ? 1 : 0, auth.userId, auth.userId, now, b.notes, now, now).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "test", entityId: id, details: `تجريبي ${student.name}: ${b.score}` });
  return c.json({ ok: true, id, passed: b.score >= settings.minPassScore }, 201);
});

/** اقتراح اختبار رسمي: المحفّظ يقترح طلاباً من عنده؛ اللجنة تقبل وتعتمد. */
testRoutes.post("/propose", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, proposeSchema);
  const created: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  for (const sid of new Set(b.studentIds)) {
    const student = await accessibleStudent(c, sid);
    if (student.archivedAt) { skipped.push(student.name); continue; }
    const open = await c.env.DB.prepare("SELECT id FROM tests WHERE student_id = ? AND kind = 'official' AND status IN ('proposed','approved')").bind(student.id).first();
    if (open) { skipped.push(student.name); continue; }
    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO tests (id, center_id, student_id, kind, status, test_type, parts, range_text, proposed_by, created_at, updated_at)
       VALUES (?, ?, ?, 'official', 'proposed', ?, ?, ?, ?, ?, ?)`
    ).bind(id, auth.centerId, student.id, b.testType, b.parts, b.rangeText, auth.userId, now, now).run();
    created.push(id);
  }
  if (!created.length) fail(409, "لا يوجد ما يُقترح: الطلاب المختارون لديهم اقتراح قائم أو مؤرشفون");
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "propose", entity: "test", details: `${created.length} طالب` });
  return c.json({ ok: true, created: created.length, skipped }, 201);
});

async function loadTest(c: import("hono").Context<AppEnv>, id: string) {
  const t = await c.env.DB.prepare("SELECT id, student_id AS studentId, status, kind FROM tests WHERE id = ? AND center_id = ?").bind(id, c.get("auth").centerId).first<{ id: string; studentId: string; status: string; kind: string }>();
  if (!t) fail(404, "الاختبار غير موجود");
  return t;
}

/** اعتماد الاقتراح: لجنة الاختبار (والمدير). */
testRoutes.post("/:id/approve", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind !== "official" || t.status !== "proposed") fail(400, "يمكن اعتماد الاقتراحات المعلّقة فقط");
  const b = await parseBody(c, decideSchema);
  await c.env.DB.prepare("UPDATE tests SET status = 'approved', test_date = ?, notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(b.testDate, b.notes, auth.userId, Date.now(), Date.now(), t.id).run();
  const uids = await studentRecipients(c.env.DB, t.studentId);
  await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "test_approved", title: "اعتماد اختبار رسمي", body: b.testDate ? `موعد الاختبار: ${b.testDate}` : "اعتمدت لجنة الاختبار الاختبار، وسيُحدَّد الموعد قريباً.", link: "/app" });
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "approve", entity: "test", entityId: t.id });
  return c.json({ ok: true });
});

testRoutes.post("/:id/reject", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind !== "official" || t.status !== "proposed") fail(400, "يمكن رفض الاقتراحات المعلّقة فقط");
  const b = await parseBody(c, decideSchema);
  await c.env.DB.prepare("UPDATE tests SET status = 'rejected', notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(b.notes, auth.userId, Date.now(), Date.now(), t.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "reject", entity: "test", entityId: t.id });
  return c.json({ ok: true });
});

/** تسجيل نتيجة الاختبار الرسمي المعتمد. */
testRoutes.post("/:id/result", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind !== "official" || t.status !== "approved") fail(400, "سجّل النتيجة للاختبارات المعتمدة فقط");
  const b = await parseBody(c, resultSchema);
  const settings = await loadSettings(c.env.DB, auth.centerId);
  const passed = b.score >= settings.minPassScore ? 1 : 0;
  await c.env.DB.prepare("UPDATE tests SET status = 'completed', score = ?, passed = ?, test_date = ?, notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(b.score, passed, b.testDate, b.notes, auth.userId, Date.now(), Date.now(), t.id).run();
  const uids = await studentRecipients(c.env.DB, t.studentId);
  await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "test_result", title: "نتيجة الاختبار الرسمي", body: `العلامة: ${b.score} — ${passed ? "ناجح" : "دون النجاح"}`, link: "/app" });
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "result", entity: "test", entityId: t.id, details: `${b.score}` });
  return c.json({ ok: true, passed: !!passed });
});

testRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  await accessibleStudent(c, t.studentId);
  if (auth.role === "teacher" && !(t.kind === "trial" || t.status === "proposed")) fail(403, "يمكنك حذف الاختبارات التجريبية والاقتراحات المعلّقة فقط");
  await c.env.DB.prepare("DELETE FROM tests WHERE id = ?").bind(t.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "test", entityId: t.id });
  return c.json({ ok: true });
});

/* ============================ دورات الأحكام ============================ */
export const courseRoutes = new Hono<AppEnv>();

const courseSchema = z.object({
  name: z.string().trim().min(2, "اسم الدورة قصير جداً").max(100),
  startsOn: z.string().regex(DATE_RE).nullable().default(null),
  endsOn: z.string().regex(DATE_RE).nullable().default(null),
  status: z.enum(["active", "ended"]),
  studentIds: z.array(z.string().min(1)).max(500).default([])
});

courseRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, starts_on AS startsOn, ends_on AS endsOn, status,
            (SELECT COUNT(*) FROM ajkam_course_students x WHERE x.course_id = c.id) AS studentCount
       FROM ajkam_courses c WHERE center_id = ? ORDER BY status, created_at DESC`
  ).bind(auth.centerId).all();
  return c.json({ courses: results });
});

courseRoutes.get("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const course = await c.env.DB.prepare("SELECT id, name, starts_on AS startsOn, ends_on AS endsOn, status FROM ajkam_courses WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first();
  if (!course) fail(404, "الدورة غير موجودة");
  const scope = studentScope(c);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name FROM ajkam_course_students x JOIN students s ON s.id = x.student_id WHERE x.course_id = ?${scope.sql} ORDER BY s.name`
  ).bind(c.req.param("id"), ...scope.binds).all();
  return c.json({ course, students: results });
});

async function validStudents(c: import("hono").Context<AppEnv>, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    const s = await c.env.DB.prepare("SELECT id FROM students WHERE id = ? AND center_id = ?").bind(id, c.get("auth").centerId).first();
    if (!s) fail(400, "طالب غير موجود ضمن هذا المركز");
    out.push(id);
  }
  return out;
}

courseRoutes.post("/", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, courseSchema);
  const ids = await validStudents(c, b.studentIds);
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO ajkam_courses (id, center_id, name, starts_on, ends_on, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, auth.centerId, b.name, b.startsOn, b.endsOn, b.status, Date.now()),
    ...ids.map((sid) => c.env.DB.prepare("INSERT INTO ajkam_course_students (course_id, student_id) VALUES (?, ?)").bind(id, sid))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "course", entityId: id, details: b.name });
  return c.json({ ok: true, id }, 201);
});

courseRoutes.put("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM ajkam_courses WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first();
  if (!existing) fail(404, "الدورة غير موجودة");
  const b = await parseBody(c, courseSchema);
  const ids = await validStudents(c, b.studentIds);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE ajkam_courses SET name = ?, starts_on = ?, ends_on = ?, status = ? WHERE id = ?").bind(b.name, b.startsOn, b.endsOn, b.status, id),
    c.env.DB.prepare("DELETE FROM ajkam_course_students WHERE course_id = ?").bind(id),
    ...ids.map((sid) => c.env.DB.prepare("INSERT INTO ajkam_course_students (course_id, student_id) VALUES (?, ?)").bind(id, sid))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "course", entityId: id, details: b.name });
  return c.json({ ok: true });
});

courseRoutes.delete("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, name FROM ajkam_courses WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first<{ id: string; name: string }>();
  if (!existing) fail(404, "الدورة غير موجودة");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM ajkam_course_students WHERE course_id = ?").bind(id), c.env.DB.prepare("DELETE FROM ajkam_courses WHERE id = ?").bind(id)]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "course", entityId: id, details: existing.name });
  return c.json({ ok: true });
});

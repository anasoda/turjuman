import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { studentScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { DATE_RE, todayHebron } from "../lib/dates";
import { notifyStatement } from "../lib/notify";
import { audit, fail, parseBody } from "../lib/util";

/* ============================ الإشعارات (لكل مستخدم) ============================ */
export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/", requireAuth(), async (c) => {
  const auth = c.get("auth");
  const page = Math.max(1, Number(new URL(c.req.url).searchParams.get("page")) || 1);
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, title, body, link, created_at AS createdAt, read_at AS readAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30 OFFSET ?"
  ).bind(auth.userId, (page - 1) * 30).all();
  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(auth.userId).first<{ n: number }>();
  return c.json({ items: results, unread: unread?.n ?? 0, page });
});

notificationRoutes.get("/count", requireAuth(), async (c) => {
  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(c.get("auth").userId).first<{ n: number }>();
  return c.json({ unread: unread?.n ?? 0 });
});

const readSchema = z.object({ ids: z.array(z.string()).max(100).optional(), all: z.boolean().optional() });
notificationRoutes.post("/read", requireAuth(), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, readSchema);
  const now = Date.now();
  if (b.all) await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, auth.userId).run();
  else if (b.ids?.length) {
    await c.env.DB.batch(b.ids.map((id) => c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").bind(now, id, auth.userId)));
  }
  return c.json({ ok: true });
});

/* ============================ رسائل الإدارة ============================ */
export const announcementRoutes = new Hono<AppEnv>();

const announcementSchema = z.object({
  title: z.string().trim().min(2, "اكتب عنواناً").max(120),
  body: z.string().trim().min(2, "اكتب نص الرسالة").max(2000),
  audience: z.enum(["all", "students", "staff"])
});

announcementRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.body, a.audience, a.created_at AS createdAt, u.display_name AS authorName
       FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.center_id = ? ORDER BY a.created_at DESC LIMIT 50`
  ).bind(c.get("auth").centerId).all();
  return c.json({ announcements: results });
});

/** إرسال رسالة للأهالي/الكادر: تُحفظ وتُوزَّع كإشعارات لكل مستلم فعّال. */
announcementRoutes.post("/", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, announcementSchema);
  // حسابات أولياء الأمور مخزَّنة بدور 'student' فتدخل ضمن «الطلاب وأولياء الأمور»
  const roles = b.audience === "students" ? ["student"] : b.audience === "staff" ? ["teacher", "secretary", "exam_committee", "admin"] : ["student", "teacher", "secretary", "exam_committee", "admin"];
  const { results: users } = await c.env.DB.prepare(
    `SELECT id FROM users WHERE center_id = ? AND active = 1 AND id <> ? AND role IN (${roles.map(() => "?").join(",")})`
  ).bind(auth.centerId, auth.userId, ...roles).all<{ id: string }>();
  const id = newId();
  await c.env.DB.prepare("INSERT INTO announcements (id, center_id, author_id, title, body, audience, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, auth.centerId, auth.userId, b.title, b.body, b.audience, Date.now()).run();
  for (let i = 0; i < users.length; i += 50) {
    await c.env.DB.batch(users.slice(i, i + 50).map((u) => notifyStatement(c.env.DB, { centerId: auth.centerId, userId: u.id, kind: "announcement", title: b.title, body: b.body })));
  }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "announcement", entityId: id, details: `${b.title} → ${users.length}` });
  return c.json({ ok: true, id, recipients: users.length }, 201);
});

announcementRoutes.delete("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const res = await c.env.DB.prepare("DELETE FROM announcements WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).run();
  if (!res.meta.changes) fail(404, "الرسالة غير موجودة");
  return c.json({ ok: true });
});

/* ============================ إبلاغ الغياب من ولي الأمر ============================ */
export const absenceRoutes = new Hono<AppEnv>();

const absenceSchema = z.object({
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  reason: z.string().trim().min(2, "اكتب سبب الغياب").max(300),
  /** ولي الأمر يحدّد أي أبنائه (الافتراضي أولهم) */
  studentId: z.string().min(1).optional()
});

/** الطالب من حسابه، أو ابن ولي الأمر (المحدَّد أو أوّلهم). */
async function portalStudent(c: Context<AppEnv>, studentId?: string) {
  const auth = c.get("auth");
  const base = "SELECT s.id, s.name, s.circle_id AS circleId FROM students s WHERE s.center_id = ? AND ";
  const stmt =
    auth.role === "guardian"
      ? c.env.DB.prepare(
          `${base}s.archived_at IS NULL AND s.guardian_id = ?${studentId ? " AND s.id = ?" : ""} ORDER BY s.name LIMIT 1`
        ).bind(...(studentId ? [auth.centerId, auth.guardianId ?? "", studentId] : [auth.centerId, auth.guardianId ?? ""]))
      : c.env.DB.prepare(`${base}s.user_id = ?`).bind(auth.centerId, auth.userId);
  const row = await stmt.first<{ id: string; name: string; circleId: string | null }>();
  if (!row) fail(404, auth.role === "guardian" ? "لا يوجد أبناء مرتبطون بحسابك" : "لا يوجد ملف طالب لهذا الحساب");
  return row;
}

/** الطالب/ولي الأمر يبلّغ عن غياب اليوم أو يوم قادم (حتى 30 يوماً). يصل المعلّمين إشعار. */
absenceRoutes.post("/", requireAuth("student", "guardian"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, absenceSchema);
  const today = todayHebron();
  const limit = new Date(Date.now() + 30 * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
  if (b.date < today || b.date > limit) fail(400, "يمكن الإبلاغ من اليوم وحتى 30 يوماً قادماً");
  const student = await portalStudent(c, b.studentId);
  await c.env.DB.prepare(
    `INSERT INTO absence_notices (id, center_id, student_id, date, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, date) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`
  ).bind(newId(), auth.centerId, student.id, b.date, b.reason, Date.now()).run();
  if (student.circleId) {
    const { results: teachers } = await c.env.DB.prepare("SELECT teacher_id AS id FROM circle_teachers WHERE circle_id = ?").bind(student.circleId).all<{ id: string }>();
    if (teachers.length) {
      await c.env.DB.batch(teachers.map((t) => notifyStatement(c.env.DB, { centerId: auth.centerId, userId: t.id, kind: "absence_notice", title: `إبلاغ غياب: ${student.name}`, body: `${b.date} — ${b.reason}`, link: "/app/daily" })));
    }
  }
  return c.json({ ok: true }, 201);
});

absenceRoutes.get("/mine", requireAuth("student", "guardian"), async (c) => {
  const student = await portalStudent(c, new URL(c.req.url).searchParams.get("studentId") || undefined);
  const { results } = await c.env.DB.prepare("SELECT id, date, reason FROM absence_notices WHERE student_id = ? ORDER BY date DESC LIMIT 30")
    .bind(student.id)
    .all();
  return c.json({ notices: results });
});

/** إبلاغات الغياب لتاريخ ما (للكادر: المعلّم لطلابه فقط). */
absenceRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const date = new URL(c.req.url).searchParams.get("date") || todayHebron();
  if (!DATE_RE.test(date)) fail(400, "التاريخ غير صالح");
  const scope = studentScope(c);
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.student_id AS studentId, s.name AS studentName, n.date, n.reason FROM absence_notices n
       JOIN students s ON s.id = n.student_id WHERE n.center_id = ? AND n.date = ?${scope.sql} ORDER BY s.name`
  ).bind(auth.centerId, date, ...scope.binds).all();
  return c.json({ notices: results });
});

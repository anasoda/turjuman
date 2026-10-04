import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { stagesOf, studentScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { DATE_RE, todayHebron } from "../lib/dates";
import { notifyStatement } from "../lib/notify";
import { pushInBackground, sendPush } from "../lib/push";
import { audit, fail, parseBody } from "../lib/util";

/* ============================ الإشعارات (لكل مستخدم) ============================ */
export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/push-key", requireAuth(), (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY ?? "" }));

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname);
  }, "خدمة التنبيهات غير مدعومة"),
  keys: z.object({ p256dh: z.string().regex(/^[\w-]{80,120}$/), auth: z.string().regex(/^[\w-]{16,40}$/) })
});
notificationRoutes.post("/subscribe", requireAuth(), async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_KEY || !c.env.VAPID_SUBJECT) fail(400, "تنبيهات الهاتف لم تُضبط بعد");
  const auth = c.get("auth");
  const b = await parseBody(c, subscriptionSchema);
  await c.env.DB.prepare(`INSERT INTO push_subscriptions (id, center_id, user_id, endpoint, p256dh, auth_secret, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET center_id = excluded.center_id,
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, created_at = excluded.created_at`)
    .bind(newId(), auth.centerId, auth.userId, b.endpoint, b.keys.p256dh, b.keys.auth, Date.now()).run();
  return c.json({ ok: true });
});
notificationRoutes.post("/unsubscribe", requireAuth(), async (c) => {
  const b = await parseBody(c, z.object({ endpoint: z.string().url().max(2048) }));
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND center_id = ?")
    .bind(b.endpoint, c.get("auth").userId, c.get("auth").centerId).run();
  return c.json({ ok: true });
});

notificationRoutes.post("/test-push", requireAuth(), async (c) => {
  const auth = c.get("auth");
  const result = await sendPush(c.env.DB, c.env, auth.centerId, [auth.userId], {
    title: "تنبيه تجريبي من ترجمان",
    body: "وصل تنبيه الهاتف بنجاح.",
    link: "/app/notifications"
  });
  return c.json(result);
});

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
  audience: z.enum(["all", "students", "staff"]),
  scopeKind: z.enum(["center", "stage", "circle"]).default("center"),
  scopeId: z.string().max(80).optional()
});
const announcementTextSchema = announcementSchema.pick({ title: true, body: true });

async function editableAnnouncement(c: Context<AppEnv>, id: string, action: "تعديل" | "حذف") {
  const auth = c.get("auth");
  const announcement = await c.env.DB.prepare("SELECT author_id AS authorId FROM announcements WHERE id = ? AND center_id = ?")
    .bind(id, auth.centerId).first<{ authorId: string }>();
  if (!announcement) fail(404, "الرسالة غير موجودة");
  if (auth.role !== "admin" && auth.role !== "secretary" && announcement.authorId !== auth.userId) fail(403, `يمكنك ${action} رسائلك فقط`);
  return announcement;
}

announcementRoutes.get("/scopes", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const stages = auth.role === "stage_manager" ? stagesOf(c) : [];
  const circles = await c.env.DB.prepare(`SELECT id, name, level_key AS levelKey FROM circles WHERE center_id = ? AND active = 1${auth.role === "teacher" ? " AND id IN (SELECT circle_id FROM circle_teachers WHERE teacher_id = ?)" : ""}${auth.role === "stage_manager" ? ` AND (level_key IN (${stages.map(() => "?").join(",")}) OR id IN (SELECT circle_id FROM circle_teachers WHERE teacher_id = ?))` : ""} ORDER BY name`)
    .bind(...(auth.role === "teacher" ? [auth.centerId, auth.userId] : auth.role === "stage_manager" ? [auth.centerId, ...stages, auth.userId] : [auth.centerId])).all<{ id: string; name: string; levelKey: string }>();
  return c.json({ circles: circles.results, stages: auth.role === "stage_manager" ? stages : [] });
});

announcementRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.body, a.audience, a.scope_kind AS scopeKind, a.scope_id AS scopeId, a.created_at AS createdAt, a.author_id AS authorId, u.display_name AS authorName
       FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.center_id = ? ORDER BY a.created_at DESC LIMIT 50`
  ).bind(c.get("auth").centerId).all();
  return c.json({ announcements: results });
});

/** إرسال رسالة للأهالي/الكادر: تُحفظ وتُوزَّع كإشعارات لكل مستلم فعّال. */
announcementRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, announcementSchema);
  if (auth.role === "teacher" && b.scopeKind !== "circle") fail(403, "يمكن للمعلّم الإرسال إلى حلقته فقط");
  if (auth.role === "stage_manager" && b.scopeKind === "center") fail(403, "يمكن لمدير المرحلة الإرسال إلى مرحلته أو حلقته فقط");
  if ((auth.role === "teacher" || auth.role === "stage_manager") && b.audience !== "students") fail(403, "هذه الرسالة لأولياء الأمور فقط");
  if (b.scopeKind !== "center" && b.audience !== "students") fail(400, "رسائل المرحلة والحلقة موجّهة لأولياء الأمور فقط");
  if (b.scopeKind !== "center" && !b.scopeId) fail(400, "حدّد المرحلة أو الحلقة");
  if (b.scopeKind === "stage" && auth.role === "teacher") fail(403, "خارج نطاق المعلم");
  if (b.scopeKind === "stage" && auth.role === "stage_manager" && !stagesOf(c).includes(b.scopeId!)) fail(404, "المرحلة غير موجودة");
  if (b.scopeKind === "circle") {
    const circle = await c.env.DB.prepare("SELECT id, level_key AS levelKey FROM circles WHERE id = ? AND center_id = ? AND active = 1").bind(b.scopeId, auth.centerId).first<{ id: string; levelKey: string }>();
    if (!circle || (auth.role === "teacher" && !(auth.circleIds ?? []).includes(circle.id)) ||
      (auth.role === "stage_manager" && !stagesOf(c).includes(circle.levelKey) && !(auth.circleIds ?? []).includes(circle.id))) fail(404, "الحلقة غير موجودة");
  }
  if (b.scopeKind === "stage") {
    const circle = await c.env.DB.prepare("SELECT 1 FROM circles WHERE center_id = ? AND level_key = ? LIMIT 1").bind(auth.centerId, b.scopeId).first();
    if (!circle) fail(404, "المرحلة غير موجودة");
  }
  let users: Array<{ id: string }>;
  if (b.scopeKind === "center") {
    const roles = b.audience === "students" ? ["student"] : b.audience === "staff" ? ["teacher", "secretary", "exam_committee", "admin"] : ["student", "teacher", "secretary", "exam_committee", "admin"];
    users = (await c.env.DB.prepare(`SELECT id FROM users WHERE center_id = ? AND active = 1 AND id <> ? AND role IN (${roles.map(() => "?").join(",")})`)
      .bind(auth.centerId, auth.userId, ...roles).all<{ id: string }>()).results;
  } else {
    users = (await c.env.DB.prepare(`SELECT DISTINCT u.id FROM students s JOIN guardians g ON g.id = s.guardian_id JOIN users u ON u.id = g.user_id
      JOIN circles ci ON ci.id = s.circle_id WHERE s.center_id = ? AND s.archived_at IS NULL AND u.active = 1 AND ci.active = 1 AND ${b.scopeKind === "stage" ? "ci.level_key" : "ci.id"} = ?`)
      .bind(auth.centerId, b.scopeId).all<{ id: string }>()).results;
  }
  const id = newId();
  await c.env.DB.prepare("INSERT INTO announcements (id, center_id, author_id, title, body, audience, scope_kind, scope_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, auth.centerId, auth.userId, b.title, b.body, b.audience, b.scopeKind, b.scopeKind === "center" ? null : b.scopeId, Date.now()).run();
  for (let i = 0; i < users.length; i += 50) {
    await c.env.DB.batch(users.slice(i, i + 50).map((u) => notifyStatement(c.env.DB, { centerId: auth.centerId, userId: u.id, kind: "announcement", title: b.title, body: b.body, sourceId: id })));
  }
  await pushInBackground(c, auth.centerId, users.map((u) => u.id), { title: b.title, body: b.body, link: "/app/notifications" });
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "announcement", entityId: id, details: `${b.title} → ${users.length}` });
  return c.json({ ok: true, id, recipients: users.length }, 201);
});

announcementRoutes.patch("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  await editableAnnouncement(c, id, "تعديل");
  const b = await parseBody(c, announcementTextSchema);
  const [, updated] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE announcements SET title = ?, body = ? WHERE id = ? AND center_id = ?").bind(b.title, b.body, id, auth.centerId),
    c.env.DB.prepare("UPDATE notifications SET title = ?, body = ? WHERE center_id = ? AND kind = 'announcement' AND source_id = ?")
      .bind(b.title, b.body, auth.centerId, id)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "announcement", entityId: id, details: `${updated.meta.changes ?? 0} إشعار` });
  return c.json({ ok: true, updatedNotifications: updated.meta.changes ?? 0 });
});

announcementRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  await editableAnnouncement(c, id, "حذف");
  const [removed] = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM notifications WHERE center_id = ? AND kind = 'announcement' AND source_id = ?").bind(auth.centerId, id),
    c.env.DB.prepare("DELETE FROM announcements WHERE id = ? AND center_id = ?").bind(id, auth.centerId)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "announcement", entityId: id, details: `${removed.meta.changes ?? 0} إشعار` });
  return c.json({ ok: true, removedNotifications: removed.meta.changes ?? 0 });
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
      await pushInBackground(c, auth.centerId, teachers.map((t) => t.id), {
        title: `إبلاغ غياب: ${student.name}`,
        body: `${b.date} — ${b.reason}`,
        link: "/app/daily"
      });
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

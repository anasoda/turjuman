import { Hono } from "hono";
import { z } from "zod";
import { MIN_PASSWORD, USERNAME_RE } from "../../shared/constants";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { createPasswordRecord, newId, timingSafeEqual } from "../lib/crypto";
import { audit, fail, loadSettings, parseBody } from "../lib/util";
import { isHafiz } from "../lib/parts";

/* ============ الإعدادات (المدير فقط) ============ */
export const settingsRoutes = new Hono<AppEnv>();

const settingsSchema = z.object({
  maxStudentsPerCircle: z.number().int().min(1).max(100),
  levels: z
    .array(z.object({ key: z.string().min(1).max(40), label: z.string().trim().min(1, "اسم المرحلة مطلوب").max(40) }))
    .min(1, "أضف مرحلة واحدة على الأقل")
    .max(12)
    .refine((l) => new Set(l.map((x) => x.key)).size === l.length, "مفاتيح المستويات مكررة"),
  sardStartScore: z.number().min(1).max(1000),
  sardDeductMistake: z.number().min(0).max(100),
  sardDeductAlert: z.number().min(0).max(100),
  sardBands: z
    .array(z.object({ min: z.number().min(0).max(1000), label: z.string().trim().min(1, "اسم التقدير مطلوب").max(40) }))
    .min(1)
    .max(12)
    .refine((b) => b.some((x) => x.min === 0), "يجب أن يوجد تقدير يبدأ من صفر"),
  minPassScore: z.number().min(0).max(1000),
  recitationGrades: z.array(z.string().trim().min(1).max(30)).min(2, "أضف تقديرين على الأقل").max(12),
  monthlyReportOpenDay: z.number().int().min(1).max(28),
  hijriOffset: z.number().int().min(-2, "التعديل بين −2 و+2 يوم").max(2, "التعديل بين −2 و+2 يوم"),
  phonePrefix: z.string().trim().regex(/^[0-9]{1,5}$/, "مقدمة الدولة أرقام فقط بلا +"),
  examQuestionSlots: z.array(z.object({ label: z.string().trim().min(1).max(100), maxScore: z.number().int().min(1).max(100), isQuranic: z.boolean() })).min(1).max(20)
    .refine((slots) => slots.reduce((sum, slot) => sum + slot.maxScore, 0) === 100, "مجموع علامات أسئلة الاختبار يجب أن يساوي 100"),
  // اختيارية: عميل قديم محفوظ في ذاكرة PWA لا يرسلها فلا تُصفَّر حدود المدير
  alertAbsenceCount: z.number().int().min(1, "عدد الغيابات بين 1 و31").max(31, "عدد الغيابات بين 1 و31").optional(),
  alertNoReciteDays: z.number().int().min(1, "أيام بلا تسميع بين 1 و90").max(90, "أيام بلا تسميع بين 1 و90").optional(),
  alertPlanLagPct: z.number().int().min(1, "نسبة التأخر بين 1 و100").max(100, "نسبة التأخر بين 1 و100").optional()
});

settingsRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) =>
  c.json({ settings: await loadSettings(c.env.DB, c.get("auth").centerId) })
);

settingsRoutes.put("/", requireAuth("admin"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, settingsSchema);
  const sorted = [...b.sardBands].sort((x, y) => y.min - x.min);
  const now = Date.now();
  const stmts = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).filter((key) => b[key] !== undefined).map((key) =>
    c.env.DB.prepare(
      `INSERT INTO center_settings (center_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(center_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).bind(auth.centerId, key, JSON.stringify(key === "sardBands" ? sorted : b[key]), now)
  );
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "settings" });
  return c.json({ ok: true, settings: await loadSettings(c.env.DB, auth.centerId) });
});

/* ============ هوية المركز (المدير فقط) ============ */
export const centerRoutes = new Hono<AppEnv>();

const identitySchema = z.object({
  name: z.string().trim().min(3, "اسم المركز 3 أحرف على الأقل").max(100),
  subtitle: z.string().trim().max(120),
  phone: z.string().trim().max(30),
  whatsapp: z.string().trim().max(30),
  logo: z.string().max(700_000, "الشعار كبير جداً").refine((v) => v === "" || v.startsWith("data:image/"), "صيغة الشعار غير صالحة")
});

centerRoutes.put("/", requireAuth("admin"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, identitySchema);
  await c.env.DB.prepare("UPDATE centers SET name = ?, subtitle = ?, phone = ?, whatsapp = ?, logo = ? WHERE id = ?")
    .bind(b.name, b.subtitle, b.phone, b.whatsapp, b.logo, auth.centerId)
    .run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "center" });
  return c.json({ ok: true });
});

/* ============ سجل التعديلات (المدير فقط) ============ */
export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get("/", requireAuth("admin"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 50;
  let where = "a.center_id = ?";
  const binds: unknown[] = [auth.centerId];
  if (q) {
    where += " AND (a.action LIKE ? OR a.entity LIKE ? OR a.details LIKE ? OR u.display_name LIKE ?)";
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.details, a.created_at AS createdAt, u.display_name AS userName
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, pageSize, (page - 1) * pageSize)
    .all();
  return c.json({ entries: results, page, pageSize });
});

/* ============ نقاط عامة (بلا دخول) ============ */
export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/center", async (c) => {
  const centerId = (new URL(c.req.url).searchParams.get("centerId") || "").trim();
  if (!centerId) fail(400, "معرّف المركز مطلوب");
  const center = await c.env.DB.prepare("SELECT id, name, subtitle, logo, phone, whatsapp FROM centers WHERE id = ? AND status = 'active'").bind(centerId).first();
  if (!center) fail(404, "المركز غير موجود أو غير مفعّل");
  return c.json({ center });
});

/** إحصاءات الصفحة العامة تظهر للزائر دون دخول (قرار المالك). أرقام مجمّعة فقط، بلا بيانات شخصية. */
publicRoutes.get("/stats", async (c) => {
  const centerId = (new URL(c.req.url).searchParams.get("centerId") || "").trim();
  if (!centerId) fail(400, "معرّف المركز مطلوب");
  const center = await c.env.DB.prepare("SELECT id FROM centers WHERE id = ? AND status = 'active'").bind(centerId).first();
  if (!center) fail(404, "المركز غير موجود أو غير مفعّل");
  const one = async (sql: string) => (await c.env.DB.prepare(sql).bind(centerId).first<{ n: number }>())?.n ?? 0;
  return c.json({
    huffaz: (await c.env.DB.prepare("SELECT direction, last_surah AS lastSurah, last_ayah AS lastAyah FROM students WHERE center_id = ? AND archived_at IS NULL")
      .bind(centerId).all<{ direction: string; lastSurah: number; lastAyah: number }>()).results.filter(isHafiz).length,
    circles: await one("SELECT COUNT(*) AS n FROM circles WHERE center_id = ? AND active = 1"),
    students: await one("SELECT COUNT(*) AS n FROM students WHERE center_id = ? AND archived_at IS NULL"),
    sardStudents: await one("SELECT COUNT(DISTINCT student_id) AS n FROM sard_records WHERE center_id = ?"),
    activeCourses: await one("SELECT COUNT(*) AS n FROM ajkam_courses WHERE center_id = ? AND status = 'active'")
  });
});

/* ============ أدوات مالك النظام ============ */
export const ownerRoutes = new Hono<AppEnv>();

const provisionSchema = z.object({
  centerId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,40}$/, "معرّف المركز: أحرف لاتينية صغيرة وأرقام وشرطات (3–41)"),
  centerName: z.string().trim().min(3).max(100),
  adminUsername: z.string().regex(USERNAME_RE, "اسم مستخدم المدير من 3 إلى 64 خانة"),
  adminName: z.string().trim().min(3).max(100),
  adminPassword: z.string().min(MIN_PASSWORD).max(200)
});

/** إنشاء مركز جديد وحساب مديره — بمفتاح مالك النظام فقط. */
ownerRoutes.post("/provision-center", async (c) => {
  const expected = c.env.ADMIN_BOOTSTRAP_KEY || "";
  const provided = c.req.header("x-bootstrap-key") || "";
  if (!expected || !provided || !timingSafeEqual(provided, expected)) fail(401, "غير مصرّح");
  const b = await parseBody(c, provisionSchema);
  const exists = await c.env.DB.prepare("SELECT id FROM centers WHERE id = ?").bind(b.centerId).first();
  if (exists) fail(409, "معرّف المركز مستخدم مسبقاً");
  const now = Date.now();
  const adminId = newId();
  const rec = await createPasswordRecord(b.adminPassword);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO centers (id, name, created_at) VALUES (?, ?, ?)").bind(b.centerId, b.centerName, now),
    c.env.DB.prepare(
      `INSERT INTO users (id, center_id, role, username, display_name, password_hash, password_salt, password_iterations, active, session_version, created_at, updated_at)
       VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 1, 1, ?, ?)`
    ).bind(adminId, b.centerId, b.adminUsername, b.adminName, rec.hash, rec.salt, rec.iterations, now, now),
    c.env.DB.prepare("INSERT INTO staff_profiles (user_id) VALUES (?)").bind(adminId)
  ]);
  await audit(c.env.DB, { centerId: b.centerId, userId: null, action: "provision", entity: "center", entityId: b.centerId });
  return c.json({ ok: true, centerId: b.centerId, adminUsername: b.adminUsername }, 201);
});

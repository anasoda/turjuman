import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { PRAYER_SLOTS } from "../../shared/constants";
import type { AppEnv } from "../env";
import { accessibleStudent, assertStageCircle, circleScope, stageTeacherScope, studentScope, teacherCircleIds } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId, timingSafeEqual } from "../lib/crypto";
import { DATE_RE, MONTH_RE, monthOf, todayHebron } from "../lib/dates";
import { audit, fail, parseBody } from "../lib/util";
import { buildReportRows } from "./reports";
import { isHafiz, withParts } from "../lib/parts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ============================ مواعيد الصلاة ============================ */
export const prayerRoutes = new Hono<AppEnv>();
export const publicPrayerRoutes = new Hono<AppEnv>();

const prayerRow = z.object({
  date: z.string().regex(DATE_RE, "تاريخ غير صالح"),
  fajr: z.string().regex(TIME_RE, "وقت الفجر غير صالح"),
  sunrise: z.string().regex(TIME_RE, "وقت الشروق غير صالح"),
  dhuhr: z.string().regex(TIME_RE, "وقت الظهر غير صالح"),
  asr: z.string().regex(TIME_RE, "وقت العصر غير صالح"),
  maghrib: z.string().regex(TIME_RE, "وقت المغرب غير صالح"),
  isha: z.string().regex(TIME_RE, "وقت العشاء غير صالح")
});
const importSchema = z.object({ rows: z.array(prayerRow).min(1, "لا توجد صفوف").max(400, "حتى 400 يوم في المرة") });

prayerRoutes.post("/import", requireAuth("admin"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, importSchema);
  for (let i = 0; i < b.rows.length; i += 50) {
    await c.env.DB.batch(
      b.rows.slice(i, i + 50).map((r) =>
        c.env.DB.prepare(
          `INSERT INTO prayer_times (center_id, date, fajr, sunrise, dhuhr, asr, maghrib, isha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(center_id, date) DO UPDATE SET fajr = excluded.fajr, sunrise = excluded.sunrise, dhuhr = excluded.dhuhr, asr = excluded.asr, maghrib = excluded.maghrib, isha = excluded.isha`
        ).bind(auth.centerId, r.date, r.fajr, r.sunrise, r.dhuhr, r.asr, r.maghrib, r.isha)
      )
    );
  }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "import", entity: "prayer", details: `${b.rows.length} يوم` });
  return c.json({ ok: true, imported: b.rows.length });
});

prayerRoutes.get("/", requireAuth(), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT date, fajr, sunrise, dhuhr, asr, maghrib, isha FROM prayer_times WHERE center_id = ? AND date >= ? ORDER BY date LIMIT 62")
    .bind(c.get("auth").centerId, todayHebron()).all();
  const range = await c.env.DB.prepare("SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS n FROM prayer_times WHERE center_id = ?").bind(c.get("auth").centerId).first();
  return c.json({ days: results, range });
});

/** اليوم والغد للزائر (الصفحة العامة تعرض الصلاة القادمة). */
publicPrayerRoutes.get("/prayer", async (c) => {
  const centerId = (new URL(c.req.url).searchParams.get("centerId") || "").trim();
  if (!centerId) fail(400, "معرّف المركز مطلوب");
  const today = todayHebron();
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
  const { results } = await c.env.DB.prepare("SELECT date, fajr, sunrise, dhuhr, asr, maghrib, isha FROM prayer_times WHERE center_id = ? AND date IN (?, ?) ORDER BY date")
    .bind(centerId, today, tomorrow).all();
  return c.json({ today, days: results });
});

/* ============================ جدول الحلقات ============================ */
export const scheduleRoutes = new Hono<AppEnv>();

export const scheduleSchema = z.object({
  entries: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    /** '' = الموعد بالساعات؛ غير ذلك اسم الصلاة (§15.6) */
    slot: z.enum(["", ...PRAYER_SLOTS]).default(""),
    start: z.string().default(""),
    end: z.string().default(""),
    place: z.string().trim().max(80).default("")
  }).superRefine((e, ctx) => {
    if (e.slot) return;
    if (!TIME_RE.test(e.start)) ctx.addIssue({ code: "custom", path: ["start"], message: "وقت البداية غير صالح" });
    if (!TIME_RE.test(e.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "وقت النهاية غير صالح" });
    if (TIME_RE.test(e.start) && TIME_RE.test(e.end) && e.start >= e.end) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "وقت النهاية يجب أن يلي البداية" });
    }
  }).transform((e) => e.slot ? { ...e, start: "", end: "" } : e)).max(14)
});

/** الطالب يرى جدول حلقته، المعلّم جدول حلقته، الإداريون أي حلقة (أو الكل). */
scheduleRoutes.get("/", requireAuth(), async (c) => {
  const auth = c.get("auth");
  let circleId = new URL(c.req.url).searchParams.get("circleId") || "";
  const myCircles = auth.role === "teacher" ? teacherCircleIds(c) : [];
  if (auth.role === "student") {
    const s = await c.env.DB.prepare("SELECT circle_id AS id FROM students WHERE user_id = ?").bind(auth.userId).first<{ id: string | null }>();
    circleId = s?.id ?? "";
  }
  if (auth.role === "guardian") {
    const wanted = new URL(c.req.url).searchParams.get("studentId") || "";
    const s = await c.env.DB.prepare(
      `SELECT s.circle_id AS id FROM students s WHERE s.center_id = ? AND s.archived_at IS NULL
          AND s.guardian_id = ?${wanted ? " AND s.id = ?" : ""} ORDER BY s.name LIMIT 1`
    ).bind(...(wanted ? [auth.centerId, auth.guardianId ?? "", wanted] : [auth.centerId, auth.guardianId ?? ""])).first<{ id: string | null }>();
    circleId = s?.id ?? "";
  }
  // الطالب وولي الأمر لا يريان إلا جدول حلقتهم؛ بلا حلقة = لا جدول
  if (!circleId && (auth.role === "student" || auth.role === "guardian")) return c.json({ entries: [] });
  // المعلّم: حلقاته كلها (هجرة 0009)، أو الحلقة المطلوبة إن كانت له
  if (auth.role === "teacher" && !myCircles.length) return c.json({ entries: [] });
  let where = circleId ? "AND sc.circle_id = ?" : "";
  const whereBinds: unknown[] = circleId ? [circleId] : [];
  if (auth.role === "teacher") {
    const allowed = circleId ? (myCircles.includes(circleId) ? [circleId] : []) : myCircles;
    if (!allowed.length) return c.json({ entries: [] });
    where = `AND sc.circle_id IN (${allowed.map(() => "?").join(",")})`;
    whereBinds.length = 0;
    whereBinds.push(...allowed);
  }
  const scope = circleScope(c, "ci"); // مدير المرحلة: جداول حلقات مراحله فقط
  const { results } = await c.env.DB.prepare(
    `SELECT sc.id, sc.circle_id AS circleId, ci.name AS circleName, sc.weekday, sc.slot, sc.start_time AS start, sc.end_time AS end, sc.place
       FROM circle_schedule sc JOIN circles ci ON ci.id = sc.circle_id WHERE sc.center_id = ? ${where}${scope.sql} ORDER BY ci.name, sc.weekday, sc.start_time`
  ).bind(auth.centerId, ...whereBinds, ...scope.binds).all();
  return c.json({ entries: results });
});

// تعديل الجدول: المدير والسكرتير، ومدير المرحلة لحلقات مراحله فقط (قرار المالك)؛ المعلّم يرى جدول حلقته ولا يعدّله
scheduleRoutes.put("/:circleId", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const circleId = c.req.param("circleId");
  const circle = await c.env.DB.prepare("SELECT id FROM circles WHERE id = ? AND center_id = ?").bind(circleId, auth.centerId).first();
  if (!circle) fail(404, "الحلقة غير موجودة");
  await assertStageCircle(c, circleId);
  const b = await parseBody(c, scheduleSchema);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM circle_schedule WHERE circle_id = ?").bind(circleId),
    ...b.entries.map((e) => c.env.DB.prepare("INSERT INTO circle_schedule (id, center_id, circle_id, weekday, slot, start_time, end_time, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(newId(), auth.centerId, circleId, e.weekday, e.slot, e.start, e.end, e.place))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "schedule", entityId: circleId });
  return c.json({ ok: true });
});

/* ============================ حضور الكادر ============================ */
export const staffAttendanceRoutes = new Hono<AppEnv>();

const attendanceSchema = z
  .object({
    userId: z.string().min(1),
    date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
    status: z.enum(["present", "absent", "late", "excused"]),
    note: z.string().trim().max(200).default("")
  })
  // «بعذر» و«متأخر» تتطلبان ملاحظة (قرار المالك)؛ «حاضر» و«غائب» بلا ملاحظة.
  .refine((b) => !(b.status === "excused" || b.status === "late") || b.note.length >= 2, {
    message: "اكتب سبب العذر أو ملاحظة التأخر",
    path: ["note"]
  });

staffAttendanceRoutes.get("/", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const date = new URL(c.req.url).searchParams.get("date") || todayHebron();
  if (!DATE_RE.test(date)) fail(400, "التاريخ غير صالح");
  const scope = stageTeacherScope(c, "u");
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name AS name, u.role, a.status, a.note FROM users u
       LEFT JOIN staff_attendance a ON a.user_id = u.id AND a.date = ?
      WHERE u.center_id = ? AND u.active = 1 AND u.role IN ('teacher','secretary','exam_committee')${scope.sql} ORDER BY u.role, u.display_name`
  ).bind(date, auth.centerId, ...scope.binds).all();
  return c.json({ date, rows: results });
});

staffAttendanceRoutes.post("/", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, attendanceSchema);
  const scope = stageTeacherScope(c, "u");
  const u = await c.env.DB.prepare(`SELECT u.id FROM users u WHERE u.id = ? AND u.center_id = ? AND u.role IN ('teacher','secretary','exam_committee')${scope.sql}`)
    .bind(b.userId, auth.centerId, ...scope.binds)
    .first();
  if (!u) fail(404, "الحساب غير موجود");
  await c.env.DB.prepare(
    `INSERT INTO staff_attendance (id, center_id, user_id, date, status, note, recorded_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at`
  ).bind(newId(), auth.centerId, b.userId, b.date, b.status, b.note, auth.userId, Date.now()).run();
  return c.json({ ok: true });
});

staffAttendanceRoutes.get("/summary", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const month = new URL(c.req.url).searchParams.get("month") || monthOf(todayHebron());
  if (!MONTH_RE.test(month)) fail(400, "الشهر غير صالح");
  const scope = stageTeacherScope(c, "u");
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name AS name, u.role,
            SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late, SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused
       FROM users u LEFT JOIN staff_attendance a ON a.user_id = u.id AND a.date LIKE ?
      WHERE u.center_id = ? AND u.active = 1 AND u.role IN ('teacher','secretary','exam_committee')${scope.sql} GROUP BY u.id ORDER BY u.display_name`
  ).bind(`${month}-%`, auth.centerId, ...scope.binds).all();
  return c.json({ month, rows: results });
});

/* ============================ ملاحظات داخلية (للكادر فقط) ============================ */
export const noteRoutes = new Hono<AppEnv>();

noteRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const student = await accessibleStudent(c, new URL(c.req.url).searchParams.get("studentId") || "");
  const { results } = await c.env.DB.prepare(
    "SELECT n.id, n.body, n.created_at AS createdAt, n.author_id AS authorId, u.display_name AS authorName FROM student_notes n JOIN users u ON u.id = n.author_id WHERE n.student_id = ? ORDER BY n.created_at DESC LIMIT 100"
  ).bind(student.id).all();
  return c.json({ notes: results });
});

const noteSchema = z.object({ studentId: z.string().min(1), body: z.string().trim().min(2, "اكتب الملاحظة").max(1000) });
noteRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, noteSchema);
  const student = await accessibleStudent(c, b.studentId);
  await c.env.DB.prepare("INSERT INTO student_notes (id, center_id, student_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(newId(), auth.centerId, student.id, auth.userId, b.body, Date.now()).run();
  return c.json({ ok: true }, 201);
});

noteRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const n = await c.env.DB.prepare("SELECT id, student_id AS studentId, author_id AS authorId FROM student_notes WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first<{ id: string; studentId: string; authorId: string }>();
  if (!n) fail(404, "الملاحظة غير موجودة");
  await accessibleStudent(c, n.studentId);
  if (auth.role === "teacher" && n.authorId !== auth.userId) fail(403, "يمكنك حذف ملاحظاتك فقط");
  await c.env.DB.prepare("DELETE FROM student_notes WHERE id = ?").bind(n.id).run();
  return c.json({ ok: true });
});

/* ============================ لوحة الشرف ============================ */
export const honorRoutes = new Hono<AppEnv>();

honorRoutes.post("/consent", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, z.object({ studentId: z.string().min(1), consent: z.boolean() }));
  const res = await c.env.DB.prepare("UPDATE students SET honor_consent = ?, updated_at = ? WHERE id = ? AND center_id = ?").bind(b.consent ? 1 : 0, Date.now(), b.studentId, auth.centerId).run();
  if (!res.meta.changes) fail(404, "الطالب غير موجود");
  return c.json({ ok: true });
});

/** المتميّزون هذا الشهر (نسبة إنجاز الخطة الشهرية) وحفّاظ القرآن — للطلاب الذين وافق أهلهم فقط. */
honorRoutes.get("/", requireAuth(), async (c) => {
  const auth = c.get("auth");
  const month = new URL(c.req.url).searchParams.get("month") || monthOf(todayHebron());
  if (!MONTH_RE.test(month)) fail(400, "الشهر غير صالح");
  const { results: students } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah, s.monthly_plan_pages AS monthlyPlanPages, ci.name AS circleName
       FROM students s LEFT JOIN circles ci ON ci.id = s.circle_id WHERE s.center_id = ? AND s.archived_at IS NULL AND s.honor_consent = 1 LIMIT 200`
  ).bind(auth.centerId).all<{ id: string; name: string; direction: "descending" | "ascending"; lastSurah: number; lastAyah: number; monthlyPlanPages: number; circleName: string | null }>();
  const rows = await buildReportRows(c.env.DB, auth.centerId, month, students);
  const top = rows
    .filter((r) => r.planPages > 0 && r.pages > 0)
    .sort((a, b) => b.percent - a.percent || b.pages - a.pages)
    .slice(0, 10)
    .map((r) => ({ name: r.name, circleName: students.find((s) => s.id === r.studentId)?.circleName ?? null, pages: r.pages, planPages: r.planPages, percent: r.percent }));
  const huffaz = students.filter(isHafiz).map((s) => ({ name: s.name, circleName: s.circleName }));
  return c.json({ month, top, huffaz });
});

/* ============================ إحصاءات وتقارير الإدارة ============================ */
export const statsRoutes = new Hono<AppEnv>();

/** اتجاه المركز عبر الأشهر: الحضور والغياب والصفحات والسرود والاختبارات المنتهية. */
statsRoutes.get("/overview", requireAuth("admin", "secretary", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  // مدير المرحلة: تُحصر الأرقام في طلاب حلقات مراحله (الاستعلامات بلا alias فنغلّف الشرط)
  const sc = studentScope(c);
  const only = sc.sql ? ` AND student_id IN (SELECT s.id FROM students s WHERE s.center_id = ?${sc.sql})` : "";
  const onlyBinds = sc.sql ? [auth.centerId, ...sc.binds] : [];
  const months = Math.min(12, Math.max(2, Number(new URL(c.req.url).searchParams.get("months")) || 6));
  const now = new Date();
  const list: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    list.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const first = `${list[0]}-01`;
  const { results: daily } = await c.env.DB.prepare(
    `SELECT substr(date, 1, 7) AS month, SUM(CASE WHEN attendance IN ('present', 'late') THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN attendance = 'absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN attendance = 'excused' THEN 1 ELSE 0 END) AS excused, SUM(pages) AS pages
       FROM daily_records WHERE center_id = ? AND date >= ?${only} GROUP BY substr(date, 1, 7)`
  ).bind(auth.centerId, first, ...onlyBinds).all<{ month: string; present: number; absent: number; excused: number; pages: number }>();
  const { results: sard } = await c.env.DB.prepare(`SELECT substr(date, 1, 7) AS month, COUNT(*) AS n FROM sard_records WHERE center_id = ? AND date >= ?${only} GROUP BY substr(date, 1, 7)`).bind(auth.centerId, first, ...onlyBinds).all<{ month: string; n: number }>();
  const { results: tests } = await c.env.DB.prepare(`SELECT substr(test_date, 1, 7) AS month, COUNT(*) AS n, SUM(passed) AS passed FROM tests WHERE center_id = ? AND status = 'completed' AND test_date >= ?${only} GROUP BY substr(test_date, 1, 7)`).bind(auth.centerId, first, ...onlyBinds).all<{ month: string; n: number; passed: number }>();
  return c.json({
    months: list.map((m) => {
      const d = daily.find((x) => x.month === m);
      return { month: m, present: d?.present ?? 0, absent: d?.absent ?? 0, excused: d?.excused ?? 0, pages: d?.pages ?? 0, sard: sard.find((x) => x.month === m)?.n ?? 0, tests: tests.find((x) => x.month === m)?.n ?? 0, testsPassed: tests.find((x) => x.month === m)?.passed ?? 0 };
    })
  });
});

/** جدول الطلاب للتقارير: عمر وحلقة ومرحلة وحفظ وحضور وغياب وصفحات واختبارات. التصفية والترتيب في الواجهة. */
statsRoutes.get("/students", requireAuth("admin", "secretary", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const scope = studentScope(c);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.national_id AS nationalId, s.birth, s.gender, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah,
            COALESCE((SELECT p.memorize_pages FROM student_monthly_plans p WHERE p.center_id = s.center_id AND p.student_id = s.id AND p.month = ?), 0) AS monthlyPlanPages,
            ci.id AS circleId, ci.name AS circleName, ci.level_key AS levelKey,
            (SELECT COUNT(*) FROM daily_records d WHERE d.student_id = s.id AND d.attendance IN ('present', 'late')) AS present,
            (SELECT COUNT(*) FROM daily_records d WHERE d.student_id = s.id AND d.attendance = 'absent') AS absent,
            (SELECT COALESCE(SUM(pages), 0) FROM daily_records d WHERE d.student_id = s.id) AS pages,
            (SELECT COALESCE(SUM(review_pages), 0) FROM daily_records d WHERE d.student_id = s.id) AS reviewPages,
            (SELECT d.review_to_surah FROM daily_records d WHERE d.student_id = s.id AND d.review_to_surah IS NOT NULL ORDER BY d.date DESC LIMIT 1) AS reviewSurah,
            (SELECT d.review_to_ayah FROM daily_records d WHERE d.student_id = s.id AND d.review_to_surah IS NOT NULL ORDER BY d.date DESC LIMIT 1) AS reviewAyah,
            (SELECT COUNT(*) FROM tests t WHERE t.student_id = s.id AND t.status = 'completed') AS tests
       FROM students s LEFT JOIN circles ci ON ci.id = s.circle_id WHERE s.center_id = ? AND s.archived_at IS NULL${scope.sql} ORDER BY s.name`
  ).bind(monthOf(todayHebron()), auth.centerId, ...scope.binds).all<{ direction: string; lastSurah: number; lastAyah: number }>();
  return c.json({ students: results.map(withParts) });
});

statsRoutes.get("/teachers", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const scope = stageTeacherScope(c, "u");
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name AS name, u.active, p.national_id AS nationalId, p.birth, p.gender, p.qualification, p.ajkam_course AS ajkamCourse, p.memorized_parts AS memorizedParts,
            (SELECT group_concat(ci.name, ' + ') FROM circle_teachers ct JOIN circles ci ON ci.id = ct.circle_id WHERE ct.teacher_id = u.id) AS circleName,
            (SELECT COUNT(*) FROM students s WHERE s.archived_at IS NULL AND s.circle_id IN (SELECT circle_id FROM circle_teachers WHERE teacher_id = u.id)) AS studentCount
       FROM users u LEFT JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.center_id = ? AND u.role = 'teacher'${scope.sql} ORDER BY u.display_name`
  ).bind(auth.centerId, ...scope.binds).all();
  return c.json({ teachers: results });
});

/* ============================ نسخة احتياطية وتصدير كامل (المدير) ============================ */
export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get("/", requireAuth("admin"), async (c) => {
  const auth = c.get("auth");
  const q = async (sql: string) => (await c.env.DB.prepare(sql).bind(auth.centerId).all()).results;
  const data = {
    exportedAt: new Date().toISOString(),
    centerId: auth.centerId,
    center: (await c.env.DB.prepare("SELECT * FROM centers WHERE id = ?").bind(auth.centerId).first()) ?? null,
    settings: await q("SELECT key, value_json AS value FROM center_settings WHERE center_id = ?"),
    // لا تُصدَّر كلمات المرور ولا تجزئتها أبداً
    users: await q("SELECT id, center_id, role, username, display_name, active, created_at, updated_at FROM users WHERE center_id = ?"),
    staffProfiles: await q("SELECT p.* FROM staff_profiles p JOIN users u ON u.id = p.user_id WHERE u.center_id = ?"),
    stageManagers: await q("SELECT * FROM stage_managers WHERE center_id = ?"),
    circles: await q("SELECT * FROM circles WHERE center_id = ?"),
    circleTeachers: await q("SELECT ct.* FROM circle_teachers ct JOIN circles c ON c.id = ct.circle_id WHERE c.center_id = ?"),
    students: await q("SELECT * FROM students WHERE center_id = ?"),
    guardians: await q("SELECT * FROM guardians WHERE center_id = ?"),
    dailyRecords: await q("SELECT * FROM daily_records WHERE center_id = ?"),
    sardRecords: await q("SELECT * FROM sard_records WHERE center_id = ?"),
    tests: await q("SELECT * FROM tests WHERE center_id = ?"),
    monthlyReports: await q("SELECT * FROM monthly_reports WHERE center_id = ?"),
    ajkamCourses: await q("SELECT * FROM ajkam_courses WHERE center_id = ?"),
    courseStudents: await q("SELECT cs.* FROM ajkam_course_students cs JOIN ajkam_courses ac ON ac.id = cs.course_id WHERE ac.center_id = ?"),
    notifications: await q("SELECT * FROM notifications WHERE center_id = ?"),
    announcements: await q("SELECT * FROM announcements WHERE center_id = ?"),
    absenceNotices: await q("SELECT * FROM absence_notices WHERE center_id = ?"),
    prayerTimes: await q("SELECT * FROM prayer_times WHERE center_id = ?"),
    staffAttendance: await q("SELECT * FROM staff_attendance WHERE center_id = ?"),
    schedule: await q("SELECT * FROM circle_schedule WHERE center_id = ?"),
    studentNotes: await q("SELECT * FROM student_notes WHERE center_id = ?"),
    auditLog: await q("SELECT * FROM audit_log WHERE center_id = ?")
  };
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "export", entity: "center" });
  return c.json(data);
});

/* ============================ لوحة مالك النظام (عدة مراكز) ============================ */
export const ownerPanelRoutes = new Hono<AppEnv>();

function ownerOnly(c: Context<AppEnv>) {
  const expected = c.env.ADMIN_BOOTSTRAP_KEY || "";
  const provided = c.req.header("x-bootstrap-key") || "";
  if (!expected || !provided || !timingSafeEqual(provided, expected)) fail(401, "غير مصرّح");
}

ownerPanelRoutes.get("/centers", async (c) => {
  ownerOnly(c);
  const { results } = await c.env.DB.prepare(
    `SELECT ce.id, ce.name, ce.status, ce.created_at AS createdAt,
            (SELECT COUNT(*) FROM students s WHERE s.center_id = ce.id AND s.archived_at IS NULL) AS students,
            (SELECT COUNT(*) FROM users u WHERE u.center_id = ce.id AND u.role = 'teacher') AS teachers,
            (SELECT COUNT(*) FROM circles ci WHERE ci.center_id = ce.id AND ci.active = 1) AS circles
       FROM centers ce ORDER BY ce.created_at DESC`
  ).all();
  return c.json({ centers: results });
});

ownerPanelRoutes.patch("/centers/:id", async (c) => {
  ownerOnly(c);
  const b = await parseBody(c, z.object({ status: z.enum(["active", "suspended"]) }));
  const res = await c.env.DB.prepare("UPDATE centers SET status = ? WHERE id = ?").bind(b.status, c.req.param("id")).run();
  if (!res.meta.changes) fail(404, "المركز غير موجود");
  return c.json({ ok: true });
});

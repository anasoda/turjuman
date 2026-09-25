import { Hono } from "hono";
import { z } from "zod";
import type { Direction } from "../../shared/constants";
import { countPages, countVerses, furthest, isValidRange, nextStart, sardBand, sardScore, type Position } from "../../shared/quran";
import type { AppEnv } from "../env";
import { accessibleStudent, assertStageCircle, pickTeacherCircle, studentScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { DATE_RE, notTooFuture, todayHebron } from "../lib/dates";
import { notifyMany, studentRecipients } from "../lib/notify";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

/* ============================ التسميع والحضور اليومي ============================ */
export const dailyRoutes = new Hono<AppEnv>();

const pos = z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(286) });
const dailySchema = z.object({
  studentId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  attendance: z.enum(["present", "absent", "excused"]),
  from: pos.nullable().default(null),
  to: pos.nullable().default(null),
  grade: z.string().max(30).default(""),
  note: z.string().trim().max(500).default("")
});

const DAILY_SELECT = `SELECT d.id, d.student_id AS studentId, d.date, d.attendance, d.direction,
        d.from_surah AS fromSurah, d.from_ayah AS fromAyah, d.to_surah AS toSurah, d.to_ayah AS toAyah,
        d.verses, d.pages, d.grade, d.note, d.updated_at AS updatedAt FROM daily_records d`;

/** لوحة اليوم: طلاب حلقة ما وسجل كل طالب في التاريخ المطلوب (للتسجيل السريع). */
dailyRoutes.get("/board", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const date = url.searchParams.get("date") || todayHebron();
  if (!DATE_RE.test(date)) fail(400, "التاريخ غير صالح");
  let circleId = url.searchParams.get("circleId") || "";
  if (auth.role === "teacher") circleId = pickTeacherCircle(c, circleId);
  if (!circleId) return c.json({ date, circleId: null, rows: [] });
  if (auth.role === "stage_manager") await assertStageCircle(c, circleId);
  const circle = await c.env.DB.prepare("SELECT id, name FROM circles WHERE id = ? AND center_id = ?").bind(circleId, auth.centerId).first<{ id: string; name: string }>();
  if (!circle) fail(404, "الحلقة غير موجودة");
  const { results: students } = await c.env.DB.prepare(
    `SELECT id, name, direction, last_surah AS lastSurah, last_ayah AS lastAyah, monthly_plan_pages AS monthlyPlanPages
       FROM students WHERE center_id = ? AND circle_id = ? AND archived_at IS NULL ORDER BY name`
  ).bind(auth.centerId, circleId).all<{ id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number }>();
  const { results: recs } = await c.env.DB.prepare(`${DAILY_SELECT} JOIN students s ON s.id = d.student_id WHERE d.center_id = ? AND s.circle_id = ? AND d.date = ?`)
    .bind(auth.centerId, circleId, date).all<{ studentId: string }>();
  const byStudent = new Map(recs.map((r) => [r.studentId, r]));
  const { results: notices } = await c.env.DB.prepare("SELECT n.student_id AS studentId, n.reason FROM absence_notices n JOIN students s ON s.id = n.student_id WHERE n.center_id = ? AND s.circle_id = ? AND n.date = ?").bind(auth.centerId, circleId, date).all<{ studentId: string; reason: string }>();
  const noticeBy = new Map(notices.map((n) => [n.studentId, n.reason]));
  return c.json({
    date, circleId, circleName: circle.name,
    rows: students.map((s) => ({ student: { ...s, nextStart: nextStart(s.direction, { surah: s.lastSurah, ayah: s.lastAyah }) }, record: byStudent.get(s.id) ?? null, absenceNotice: noticeBy.get(s.id) ?? null }))
  });
});

dailyRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const url = new URL(c.req.url);
  const student = await accessibleStudent(c, url.searchParams.get("studentId") || "");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
  const { results } = await c.env.DB.prepare(`${DAILY_SELECT} WHERE d.student_id = ? ORDER BY d.date DESC LIMIT ?`).bind(student.id, limit).all();
  return c.json({ records: results });
});

/** تسجيل/تعديل سجل اليوم (upsert بحسب الطالب والتاريخ). بداية التسميع تُقترح من الواجهة وتُتحقق هنا. */
dailyRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, dailySchema);
  if (!notTooFuture(b.date)) fail(400, "لا يمكن التسجيل في تاريخ مستقبلي");
  const student = await accessibleStudent(c, b.studentId);
  if (student.archivedAt) fail(400, "الطالب مؤرشف");
  const settings = await loadSettings(c.env.DB, auth.centerId);
  if (b.grade && !settings.recitationGrades.includes(b.grade)) fail(400, "التقييم غير موجود في مقياس المركز");

  let verses = 0, pages = 0;
  let from: Position | null = null, to: Position | null = null;
  if (b.attendance !== "absent") {
    if (!b.from || !b.to) fail(400, "حدّد بداية التسميع ونهايته");
    from = b.from; to = b.to;
    if (!isValidRange(student.direction, from, to)) fail(400, "نهاية التسميع يجب ألا تسبق بدايته وفق اتجاه حفظ الطالب");
    verses = countVerses(student.direction, from, to);
    pages = countPages(student.direction, from, to);
  }
  const now = Date.now();
  const existing = await c.env.DB.prepare("SELECT id FROM daily_records WHERE student_id = ? AND date = ?").bind(student.id, b.date).first<{ id: string }>();
  const id = existing?.id ?? newId();
  await c.env.DB.prepare(
    `INSERT INTO daily_records (id, center_id, student_id, recorded_by, date, attendance, direction, from_surah, from_ayah, to_surah, to_ayah, verses, pages, grade, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, date) DO UPDATE SET recorded_by = excluded.recorded_by, attendance = excluded.attendance, direction = excluded.direction,
       from_surah = excluded.from_surah, from_ayah = excluded.from_ayah, to_surah = excluded.to_surah, to_ayah = excluded.to_ayah,
       verses = excluded.verses, pages = excluded.pages, grade = excluded.grade, note = excluded.note, updated_at = excluded.updated_at`
  ).bind(id, auth.centerId, student.id, auth.userId, b.date, b.attendance, student.direction, from?.surah ?? null, from?.ayah ?? null, to?.surah ?? null, to?.ayah ?? null,
    verses, pages, b.grade, b.note, now, now).run();

  // آخر موضع محفوظ يتقدّم تلقائياً (لا يتراجع عند التعديل/الحذف — يعدّله الكادر يدوياً من بطاقة الطالب)
  if (to) {
    const last: Position = { surah: student.lastSurah, ayah: student.lastAyah };
    const next = furthest(student.direction, last, to);
    if (next.surah !== last.surah || next.ayah !== last.ayah) {
      await c.env.DB.prepare("UPDATE students SET last_surah = ?, last_ayah = ?, updated_at = ? WHERE id = ?").bind(next.surah, next.ayah, now, student.id).run();
    }
  }
  if (b.attendance === "absent") {
    const uids = await studentRecipients(c.env.DB, student.id);
    await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "absence", title: "تسجيل غياب", body: `سُجّل غياب ${student.name} بتاريخ ${b.date}. إن كان لعذر فأبلغ المحفّظ من البوابة.` });
  }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: existing ? "update" : "create", entity: "daily", entityId: id, details: `${student.name} ${b.date}` });
  return c.json({ ok: true, id, verses, pages }, existing ? 200 : 201);
});

dailyRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const rec = await c.env.DB.prepare("SELECT id, student_id AS studentId, date FROM daily_records WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first<{ id: string; studentId: string; date: string }>();
  if (!rec) fail(404, "السجل غير موجود");
  await accessibleStudent(c, rec.studentId);
  await c.env.DB.prepare("DELETE FROM daily_records WHERE id = ?").bind(rec.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "daily", entityId: rec.id, details: rec.date });
  return c.json({ ok: true });
});

/* ============================ السرد ============================ */
export const sardRoutes = new Hono<AppEnv>();

const sardSchema = z.object({
  /** معرّف من الجهاز: يجعل إعادة الإرسال بعد انقطاع الشبكة آمنة (لا تكرار) */
  id: z.string().uuid().optional(),
  studentId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  stage: z.enum(["trial", "final"]),
  from: pos,
  to: pos,
  mistakes: z.number().int().min(0).max(1000),
  alerts: z.number().int().min(0).max(1000)
});

const SARD_SELECT = `SELECT r.id, r.student_id AS studentId, s.name AS studentName, c.name AS circleName, r.date, r.stage, r.direction,
        r.from_surah AS fromSurah, r.from_ayah AS fromAyah, r.to_surah AS toSurah, r.to_ayah AS toAyah,
        r.verses, r.mistakes, r.alerts, r.score, r.band, u.display_name AS recordedByName
   FROM sard_records r JOIN students s ON s.id = r.student_id LEFT JOIN circles c ON c.id = s.circle_id LEFT JOIN users u ON u.id = r.recorded_by`;

sardRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const studentId = url.searchParams.get("studentId") || "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 30;
  const scope = studentScope(c);
  let where = `r.center_id = ?${scope.sql}`;
  const binds: unknown[] = [auth.centerId, ...scope.binds];
  if (studentId) { where += " AND r.student_id = ?"; binds.push(studentId); }
  if (q) { where += " AND (s.name LIKE ? OR c.name LIKE ?)"; binds.push(`%${q}%`, `%${q}%`); }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sard_records r JOIN students s ON s.id = r.student_id LEFT JOIN circles c ON c.id = s.circle_id WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`${SARD_SELECT} WHERE ${where} ORDER BY r.date DESC, r.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return c.json({ records: results, total: total?.n ?? 0, page, pageSize });
});

sardRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, sardSchema);
  if (!notTooFuture(b.date)) fail(400, "لا يمكن التسجيل في تاريخ مستقبلي");
  const student = await accessibleStudent(c, b.studentId);
  if (student.archivedAt) fail(400, "الطالب مؤرشف");
  if (!isValidRange(student.direction, b.from, b.to)) fail(400, "نهاية السرد يجب ألا تسبق بدايته وفق اتجاه حفظ الطالب");
  const settings = await loadSettings(c.env.DB, auth.centerId);
  const score = sardScore(settings, b.mistakes, b.alerts);
  const band = sardBand(settings, score);
  const verses = countVerses(student.direction, b.from, b.to);
  const id = b.id ?? newId();
  if (b.id) {
    const dup = await c.env.DB.prepare("SELECT id FROM sard_records WHERE id = ?").bind(b.id).first();
    if (dup) return c.json({ ok: true, id, duplicate: true });
  }
  await c.env.DB.prepare(
    `INSERT INTO sard_records (id, center_id, student_id, recorded_by, date, stage, direction, from_surah, from_ayah, to_surah, to_ayah, verses, mistakes, alerts, score, band, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.centerId, student.id, auth.userId, b.date, b.stage, student.direction, b.from.surah, b.from.ayah, b.to.surah, b.to.ayah, verses, b.mistakes, b.alerts, score, band, Date.now()).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "sard", entityId: id, details: `${student.name}: ${score} (${band})` });
  return c.json({ ok: true, id, score, band, verses }, 201);
});

sardRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const rec = await c.env.DB.prepare("SELECT id, student_id AS studentId FROM sard_records WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first<{ id: string; studentId: string }>();
  if (!rec) fail(404, "السجل غير موجود");
  await accessibleStudent(c, rec.studentId);
  await c.env.DB.prepare("DELETE FROM sard_records WHERE id = ?").bind(rec.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "sard", entityId: rec.id });
  return c.json({ ok: true });
});

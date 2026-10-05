import { Hono } from "hono";
import { z } from "zod";
import type { Direction } from "../../shared/constants";
import { countPages, countVerses, furthest, isValidRange, nextStart, rangeDirection, sardBand, sardScore, surahName, type Position } from "../../shared/quran";
import type { AppEnv } from "../env";
import { accessibleStudent, assertStageCircle, datedRecordScope, pickTeacherCircle, studentForDate } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { DATE_RE, monthOf, nextWeekdayDate, notTooFuture, todayHebron, weekdayNameAr } from "../lib/dates";
import { notifyMany, studentRecipients } from "../lib/notify";
import { pushInBackground } from "../lib/push";
import { circleOnSql } from "../lib/transfers";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

/* ============================ التسميع والحضور اليومي ============================ */
export const dailyRoutes = new Hono<AppEnv>();

const pos = z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(286) });
const dailySchema = z.object({
  studentId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  attendance: z.enum(["present", "absent", "excused", "late"]),
  from: pos.nullable().default(null),
  to: pos.nullable().default(null),
  grade: z.string().max(30).default(""),
  /** مسار المراجعة (§16): المحفّظ يحدّد بدايتها ونهايتها بحرية، وتُقترح بداية اليوم من نهاية آخر مراجعة */
  review: z.object({ from: pos, to: pos, grade: z.string().max(30).default("") }).nullable().default(null),
  /** المطلوب من الطالب في اللقاء القادم: حفظ ومراجعة معاً ممكنان؛ يُرسَل إشعاراً فورياً لولي الأمر عند تغييره */
  next: z.object({
    memorize: z.object({ from: pos, to: pos }).nullable().default(null),
    review: z.object({ from: pos, to: pos }).nullable().default(null),
    note: z.string().trim().max(300).default("")
  }).nullable().default(null),
  note: z.string().trim().max(500).default("")
}).refine((b) => !["excused", "late"].includes(b.attendance) || b.note.length >= 2, { message: "اكتب سبب العذر أو التأخر (ملاحظة إجبارية)", path: ["note"] });

const DAILY_SELECT = `SELECT d.id, d.student_id AS studentId, d.date, d.attendance, d.direction,
        d.from_surah AS fromSurah, d.from_ayah AS fromAyah, d.to_surah AS toSurah, d.to_ayah AS toAyah,
        d.verses, d.pages, d.grade, d.note, d.updated_at AS updatedAt,
        d.review_from_surah AS reviewFromSurah, d.review_from_ayah AS reviewFromAyah, d.review_to_surah AS reviewToSurah, d.review_to_ayah AS reviewToAyah,
        d.review_verses AS reviewVerses, d.review_pages AS reviewPages, d.review_grade AS reviewGrade,
        d.next_memorize_from_surah AS nextMemorizeFromSurah, d.next_memorize_from_ayah AS nextMemorizeFromAyah,
        d.next_memorize_to_surah AS nextMemorizeToSurah, d.next_memorize_to_ayah AS nextMemorizeToAyah,
        d.next_review_from_surah AS nextReviewFromSurah, d.next_review_from_ayah AS nextReviewFromAyah,
        d.next_review_to_surah AS nextReviewToSurah, d.next_review_to_ayah AS nextReviewToAyah, d.next_note AS nextNote
        FROM daily_records d`;

type ReviewEnd = { studentId: string; fromSurah: number; fromAyah: number; toSurah: number; toAyah: number };

/** رقم يوم الأسبوع للتاريخ (الأحد = 0 مثل circle_schedule.weekday). */
function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

async function circleHasSession(db: D1Database, circleId: string, date: string) {
  const all = await db.prepare("SELECT weekday FROM circle_schedule WHERE circle_id = ?").bind(circleId).all<{ weekday: number }>();
  if (all.results.length === 0) return true; // Allow backward compatibility / tests if no schedule is set at all
  return all.results.some(r => r.weekday === weekdayOf(date));
}

/** عدد حصص الحلقة في شهر التاريخ حسب جدولها الأسبوعي (null إن لم يُضبط جدول)؛ أساس حصة اللقاء من الخطة الشهرية. */
async function monthSessionCount(db: D1Database, circleId: string, date: string): Promise<number | null> {
  const { results } = await db.prepare("SELECT weekday FROM circle_schedule WHERE circle_id = ?").bind(circleId).all<{ weekday: number }>();
  if (!results.length) return null;
  const days = new Set(results.map((r) => r.weekday));
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) if (days.has(new Date(Date.UTC(year, month - 1, d)).getUTCDay())) n++;
  return n;
}

/** آخر مراجعة قبل التاريخ لكل طالب في حلقة، ومنها يُقترح موضع بداية المراجعة (نهايتها + آية). */
async function lastReviews(db: D1Database, centerId: string, circleId: string, before: string): Promise<Map<string, ReviewEnd>> {
  const { results } = await db.prepare(
    `SELECT d.student_id AS studentId, d.review_from_surah AS fromSurah, d.review_from_ayah AS fromAyah, d.review_to_surah AS toSurah, d.review_to_ayah AS toAyah
       FROM daily_records d
      WHERE d.center_id = ? AND d.review_to_surah IS NOT NULL AND d.date < ?
        AND d.student_id IN (SELECT s.id FROM students s WHERE s.center_id = ? AND ${circleOnSql("s")} = ?)
      ORDER BY d.date DESC`
  ).bind(centerId, before, centerId, before, circleId).all<ReviewEnd>();
  const out = new Map<string, ReviewEnd>();
  for (const r of results) if (!out.has(r.studentId)) out.set(r.studentId, r);
  return out;
}

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
  const scheduled = await circleHasSession(c.env.DB, circleId, date);
  const { results: students } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah,
            s.review_start_surah AS reviewStartSurah, s.review_start_ayah AS reviewStartAyah,
            COALESCE((SELECT p.memorize_pages FROM student_monthly_plans p WHERE p.center_id = s.center_id AND p.student_id = s.id AND p.month = ?), 0) AS monthlyPlanPages,
            COALESCE((SELECT p.review_pages FROM student_monthly_plans p WHERE p.center_id = s.center_id AND p.student_id = s.id AND p.month = ?), 0) AS monthlyReviewPlanPages
       FROM students s WHERE s.center_id = ? AND ${circleOnSql("s")} = ? AND s.archived_at IS NULL ORDER BY s.name`
  ).bind(monthOf(date), monthOf(date), auth.centerId, date, circleId).all<{ id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; reviewStartSurah: number | null; reviewStartAyah: number | null; monthlyPlanPages: number }>();
  const { results: recs } = await c.env.DB.prepare(`${DAILY_SELECT} JOIN students s ON s.id = d.student_id WHERE d.center_id = ? AND ${circleOnSql("s")} = ? AND d.date = ?`)
    .bind(auth.centerId, date, circleId, date).all<{ studentId: string }>();
  const byStudent = new Map(recs.map((r) => [r.studentId, r]));
  const lastRev = await lastReviews(c.env.DB, auth.centerId, circleId, date);
  const { results: notices } = await c.env.DB.prepare(`SELECT n.student_id AS studentId, n.reason FROM absence_notices n JOIN students s ON s.id = n.student_id WHERE n.center_id = ? AND ${circleOnSql("s")} = ? AND n.date = ?`).bind(auth.centerId, date, circleId, date).all<{ studentId: string; reason: string }>();
  const noticeBy = new Map(notices.map((n) => [n.studentId, n.reason]));
  const cancellation = await c.env.DB.prepare("SELECT id, reason FROM session_cancellations WHERE circle_id = ? AND date = ?").bind(circleId, date).first<{ id: string; reason: string }>();
  return c.json({
    date, circleId, circleName: circle.name, scheduled, monthSessions: await monthSessionCount(c.env.DB, circleId, date), cancellation: cancellation ?? null,
    rows: students.map((s) => ({ student: { ...s, nextStart: nextStart(s.direction, { surah: s.lastSurah, ayah: s.lastAyah }), ...reviewHint(s.direction, lastRev.get(s.id), s.reviewStartSurah, s.reviewStartAyah) }, record: byStudent.get(s.id) ?? null, absenceNotice: noticeBy.get(s.id) ?? null }))
  });
});

/** مقترح بداية المراجعة (بعد نهاية آخر مراجعة وفق اتجاه تلك المراجعة) وآخر نهاية للعرض. */
function reviewHint(direction: Direction, last: ReviewEnd | undefined, startSurah: number | null, startAyah: number | null) {
  if (!last) {
    if (!startSurah || !startAyah) return { reviewNext: null, reviewLast: null };
    const to = { surah: startSurah, ayah: startAyah };
    return { reviewNext: nextStart(direction, to), reviewLast: to };
  }
  const from = { surah: last.fromSurah, ayah: last.fromAyah };
  const to = { surah: last.toSurah, ayah: last.toAyah };
  const dir = rangeDirection(direction, from, to) ?? direction;
  return { reviewNext: nextStart(dir, to), reviewLast: to };
}

dailyRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get("studentId") || "";
  const scope = datedRecordScope(c, "d");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
  const { results } = await c.env.DB.prepare(`${DAILY_SELECT} JOIN students s ON s.id = d.student_id WHERE d.student_id = ? AND d.center_id = ?${scope.sql} ORDER BY d.date DESC LIMIT ?`)
    .bind(studentId, c.get("auth").centerId, ...scope.binds, limit).all();
  // عند غياب السجلات، أبقِ 404 للطالب غير الموجود أو الخارج عن نطاق المعلّم.
  if (!results.length) await accessibleStudent(c, studentId);
  return c.json({ records: results });
});

/** تسجيل/تعديل سجل اليوم (upsert بحسب الطالب والتاريخ). بداية التسميع تُقترح من الواجهة وتُتحقق هنا. */
dailyRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, dailySchema);
  if (!notTooFuture(b.date)) fail(400, "لا يمكن التسجيل في تاريخ مستقبلي");
  const student = await studentForDate(c, b.studentId, b.date);
  if (student.archivedAt) fail(400, "الطالب مؤرشف");
  const circleId = student.circleId;
  if (!circleId) fail(400, "الطالب غير مسجَّل في حلقة");
  const cancelled = await c.env.DB.prepare("SELECT reason FROM session_cancellations WHERE circle_id = ? AND date = ?").bind(circleId, b.date).first<{ reason: string }>();
  if (cancelled) fail(409, `حصة هذا اليوم ملغاة (${cancelled.reason})؛ أعدها من لوحة التسميع إن أردت تسجيل متابعة`);
  // قرار المالك (البند 4): التسجيل مسموح دائماً حتى خارج جدول الحلقة (حصة تعويضية/إضافية)؛ الجدول تنبيه فقط
  const offSchedule = !(await circleHasSession(c.env.DB, circleId, b.date));
  const settings = await loadSettings(c.env.DB, auth.centerId);
  if (b.grade && !settings.recitationGrades.includes(b.grade)) fail(400, "التقييم غير موجود في مقياس المركز");
  if (b.review?.grade && !settings.recitationGrades.includes(b.review.grade)) fail(400, "تقييم المراجعة غير موجود في مقياس المركز");

  let verses = 0, pages = 0;
  let from: Position | null = null, to: Position | null = null;
  let rFrom: Position | null = null, rTo: Position | null = null;
  let rVerses = 0, rPages = 0;
  // الغائب (بعذر أو دونه) لا تسميع ولا مراجعة له؛ الحاضر والمتأخر يُسجَّل حفظهما و/أو مراجعتهما (واحد منهما على الأقل)
  if (b.attendance === "present" || b.attendance === "late") {
    if (!b.from && !b.to && !b.review) fail(400, "حدّد نطاق الحفظ الجديد أو المراجعة (واحداً على الأقل)");
    if (b.from || b.to) {
      if (!b.from || !b.to) fail(400, "حدّد بداية الحفظ ونهايته");
      from = b.from; to = b.to;
      if (!isValidRange(student.direction, from, to)) fail(400, "نهاية الحفظ يجب ألا تسبق بدايته وفق اتجاه حفظ الطالب");
      verses = countVerses(student.direction, from, to);
      pages = countPages(student.direction, from, to);
    }
    if (b.review) {
      rFrom = b.review.from; rTo = b.review.to;
      const dir = rangeDirection(student.direction, rFrom, rTo);
      if (!dir) fail(400, "نهاية المراجعة تسبق بدايتها");
      rVerses = countVerses(dir!, rFrom, rTo);
      rPages = countPages(dir!, rFrom, rTo);
    }
  }
  // المطلوب في اللقاء القادم: حفظ ومراجعة معاً ممكنان؛ يُتاح فقط عند الحضور الفعلي (present/late)
  let nMemFrom: Position | null = null, nMemTo: Position | null = null;
  let nRevFrom: Position | null = null, nRevTo: Position | null = null;
  if ((b.attendance === "present" || b.attendance === "late") && b.next) {
    if (!b.next.memorize && !b.next.review) fail(400, "حدّد حفظاً أو مراجعة للمطلوب القادم (أو الاثنين)");
    if (b.next.memorize) {
      nMemFrom = b.next.memorize.from; nMemTo = b.next.memorize.to;
      if (!isValidRange(student.direction, nMemFrom, nMemTo)) fail(400, "نهاية حفظ اللقاء القادم يجب ألا تسبق بدايته وفق اتجاه حفظ الطالب");
    }
    if (b.next.review) {
      nRevFrom = b.next.review.from; nRevTo = b.next.review.to;
      if (!rangeDirection(student.direction, nRevFrom, nRevTo)) fail(400, "نهاية مراجعة اللقاء القادم تسبق بدايتها");
    }
  }
  const now = Date.now();
  const existing = await c.env.DB.prepare(
    `SELECT id, next_memorize_from_surah AS mfs, next_memorize_from_ayah AS mfa, next_memorize_to_surah AS mts, next_memorize_to_ayah AS mta,
            next_review_from_surah AS rfs, next_review_from_ayah AS rfa, next_review_to_surah AS rts, next_review_to_ayah AS rta
       FROM daily_records WHERE student_id = ? AND date = ?`
  ).bind(student.id, b.date).first<{ id: string; mfs: number | null; mfa: number | null; mts: number | null; mta: number | null; rfs: number | null; rfa: number | null; rts: number | null; rta: number | null }>();
  const id = existing?.id ?? newId();
  await c.env.DB.prepare(
    `INSERT INTO daily_records (id, center_id, student_id, circle_id, recorded_by, date, attendance, direction, from_surah, from_ayah, to_surah, to_ayah, verses, pages, grade, note, created_at, updated_at,
                                review_from_surah, review_from_ayah, review_to_surah, review_to_ayah, review_verses, review_pages, review_grade,
                                next_memorize_from_surah, next_memorize_from_ayah, next_memorize_to_surah, next_memorize_to_ayah,
                                next_review_from_surah, next_review_from_ayah, next_review_to_surah, next_review_to_ayah, next_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, date) DO UPDATE SET circle_id = excluded.circle_id, recorded_by = excluded.recorded_by, attendance = excluded.attendance, direction = excluded.direction,
       from_surah = excluded.from_surah, from_ayah = excluded.from_ayah, to_surah = excluded.to_surah, to_ayah = excluded.to_ayah,
       verses = excluded.verses, pages = excluded.pages, grade = excluded.grade, note = excluded.note, updated_at = excluded.updated_at,
       review_from_surah = excluded.review_from_surah, review_from_ayah = excluded.review_from_ayah, review_to_surah = excluded.review_to_surah, review_to_ayah = excluded.review_to_ayah,
       review_verses = excluded.review_verses, review_pages = excluded.review_pages, review_grade = excluded.review_grade,
       next_memorize_from_surah = excluded.next_memorize_from_surah, next_memorize_from_ayah = excluded.next_memorize_from_ayah,
       next_memorize_to_surah = excluded.next_memorize_to_surah, next_memorize_to_ayah = excluded.next_memorize_to_ayah,
       next_review_from_surah = excluded.next_review_from_surah, next_review_from_ayah = excluded.next_review_from_ayah,
       next_review_to_surah = excluded.next_review_to_surah, next_review_to_ayah = excluded.next_review_to_ayah, next_note = excluded.next_note`
  ).bind(id, auth.centerId, student.id, circleId, auth.userId, b.date, b.attendance, student.direction, from?.surah ?? null, from?.ayah ?? null, to?.surah ?? null, to?.ayah ?? null,
    verses, pages, b.grade, b.note, now, now,
    rFrom?.surah ?? null, rFrom?.ayah ?? null, rTo?.surah ?? null, rTo?.ayah ?? null, rVerses, rPages, b.review?.grade ?? "",
    nMemFrom?.surah ?? null, nMemFrom?.ayah ?? null, nMemTo?.surah ?? null, nMemTo?.ayah ?? null,
    nRevFrom?.surah ?? null, nRevFrom?.ayah ?? null, nRevTo?.surah ?? null, nRevTo?.ayah ?? null,
    b.next?.note ?? "").run();

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
    await pushInBackground(c, auth.centerId, uids, { title: "تسجيل غياب", body: `سُجّل غياب ${student.name} بتاريخ ${b.date}.`, link: "/app" });
  }
  // إشعار المطلوب في اللقاء القادم: فقط عند التعيين الجديد أو تغييره عن سابقه (لا تكرار عند تعديل غير متعلق به)
  const posEq = (a: Position | null, b: Position | null) => (a?.surah ?? null) === (b?.surah ?? null) && (a?.ayah ?? null) === (b?.ayah ?? null);
  const existingMemFrom: Position | null = existing?.mfs ? { surah: existing.mfs, ayah: existing.mfa! } : null;
  const existingMemTo: Position | null = existing?.mts ? { surah: existing.mts, ayah: existing.mta! } : null;
  const existingRevFrom: Position | null = existing?.rfs ? { surah: existing.rfs, ayah: existing.rfa! } : null;
  const existingRevTo: Position | null = existing?.rts ? { surah: existing.rts, ayah: existing.rta! } : null;
  const nextChanged =
    !posEq(nMemFrom, existingMemFrom) || !posEq(nMemTo, existingMemTo) || !posEq(nRevFrom, existingRevFrom) || !posEq(nRevTo, existingRevTo);
  if ((nMemFrom || nRevFrom) && nextChanged) {
    const { results: sched } = await c.env.DB.prepare("SELECT weekday FROM circle_schedule WHERE circle_id = ?").bind(circleId).all<{ weekday: number }>();
    const nextDate = nextWeekdayDate(b.date, sched.map((r) => r.weekday));
    const when = nextDate ? `${weekdayNameAr(nextDate)} ${nextDate}` : "اللقاء القادم";
    const rangeText = (from: Position, to: Position) => `من ${surahName(from.surah)} آية ${from.ayah} إلى ${from.surah === to.surah ? "آية" : `${surahName(to.surah)} آية`} ${to.ayah}`;
    const parts: string[] = [];
    if (nMemFrom) parts.push(`حفظاً: ${rangeText(nMemFrom, nMemTo!)}`);
    if (nRevFrom) parts.push(`مراجعة: ${rangeText(nRevFrom, nRevTo!)}`);
    // اسم الطالب إلزامي في المتن: ولي الأمر قد يكون له أكثر من ابن، فبدونه لا يُعرَف المقصود بالإشعار
    const body = `الطالب: ${student.name}\nالمطلوب في اللقاء القادم (${when}):\n${parts.join("\n")}${b.next!.note ? `\n${b.next!.note}` : ""}`;
    const uids = await studentRecipients(c.env.DB, student.id);
    await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "assignment", title: "تسميع اليوم", body, sourceId: id });
    await pushInBackground(c, auth.centerId, uids, { title: "المطلوب في اللقاء القادم", body, link: "/app" });
  }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: existing ? "update" : "create", entity: "daily", entityId: id, details: `${student.name} ${b.date}` });
  return c.json({ ok: true, id, verses, pages, reviewVerses: rVerses, reviewPages: rPages, offSchedule }, existing ? 200 : 201);
});

dailyRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const rec = await c.env.DB.prepare("SELECT id, student_id AS studentId, date FROM daily_records WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first<{ id: string; studentId: string; date: string }>();
  if (!rec) fail(404, "السجل غير موجود");
  await studentForDate(c, rec.studentId, rec.date);
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
   FROM sard_records r JOIN students s ON s.id = r.student_id LEFT JOIN circles c ON c.id = r.circle_id LEFT JOIN users u ON u.id = r.recorded_by`;

sardRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const studentId = url.searchParams.get("studentId") || "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 30;
  const scope = datedRecordScope(c, "r");
  let where = `r.center_id = ?${scope.sql}`;
  const binds: unknown[] = [auth.centerId, ...scope.binds];
  if (studentId) { where += " AND r.student_id = ?"; binds.push(studentId); }
  if (q) { where += " AND (s.name LIKE ? OR c.name LIKE ?)"; binds.push(`%${q}%`, `%${q}%`); }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sard_records r JOIN students s ON s.id = r.student_id LEFT JOIN circles c ON c.id = r.circle_id WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`${SARD_SELECT} WHERE ${where} ORDER BY r.date DESC, r.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return c.json({ records: results, total: total?.n ?? 0, page, pageSize });
});

sardRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, sardSchema);
  if (!notTooFuture(b.date)) fail(400, "لا يمكن التسجيل في تاريخ مستقبلي");
  const student = await studentForDate(c, b.studentId, b.date);
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
    `INSERT INTO sard_records (id, center_id, student_id, circle_id, recorded_by, date, stage, direction, from_surah, from_ayah, to_surah, to_ayah, verses, mistakes, alerts, score, band, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.centerId, student.id, student.circleId, auth.userId, b.date, b.stage, student.direction, b.from.surah, b.from.ayah, b.to.surah, b.to.ayah, verses, b.mistakes, b.alerts, score, band, Date.now()).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "sard", entityId: id, details: `${student.name}: ${score} (${band})` });
  return c.json({ ok: true, id, score, band, verses }, 201);
});

sardRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const rec = await c.env.DB.prepare("SELECT id, student_id AS studentId, date FROM sard_records WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first<{ id: string; studentId: string; date: string }>();
  if (!rec) fail(404, "السجل غير موجود");
  await studentForDate(c, rec.studentId, rec.date);
  await c.env.DB.prepare("DELETE FROM sard_records WHERE id = ?").bind(rec.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "sard", entityId: rec.id });
  return c.json({ ok: true });
});

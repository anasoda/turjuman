import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Direction } from "../../shared/constants";
import { completedJuz, countPages, countUniquePages, furthest, isValidRange, nextStart, pagesOfRange, planPercent, rangeDirection, type Position } from "../../shared/quran";
import type { AppEnv } from "../env";
import { accessibleStudent, assertStageCircle, pickTeacherCircle, type StudentLite } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { MONTH_RE, monthOf, todayHebron } from "../lib/dates";
import { notifyMany } from "../lib/notify";
import { pushInBackground } from "../lib/push";
import { circleOnSql, lastDayOfMonth } from "../lib/transfers";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

export const reportRoutes = new Hono<AppEnv>();
export const portalRoutes = new Hono<AppEnv>();

interface StudentRow { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number }
interface DailyRow { student_id: string; date: string; attendance: string; from_surah: number | null; from_ayah: number | null; to_surah: number | null; to_ayah: number | null; verses: number;
  review_from_surah: number | null; review_from_ayah: number | null; review_to_surah: number | null; review_to_ayah: number | null }
interface SavedRow { student_id: string; start_surah: number; start_ayah: number; end_surah: number; end_ayah: number; pages: number; plan_pages: number; review_pages: number; review_plan_pages: number }

export interface ReportRow {
  studentId: string;
  name: string;
  direction: Direction;
  planPages: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  verses: number;
  pages: number;
  start: Position | null;
  end: Position | null;
  juz: number;
  percent: number;
  saved: boolean;
  /** سجلات المصدر لاحتساب التغييرات المعلّقة على الجهاز أثناء انقطاع الاتصال. */
  daily: DailyRow[];
  /** مسار المراجعة (§16): صفحات فريدة راجعها في الشهر، وخطتها، ونسبتها، وعدد أيام المراجعة */
  reviewPages: number;
  reviewPlanPages: number;
  reviewPercent: number;
  reviewDays: number;
}

/** يبني صفوف الكشف الشهري تلقائياً من التسميع اليومي، ثم يطبّق فوقها ما حُفظ يدوياً. */
export async function buildReportRows(db: D1Database, centerId: string, month: string, students: StudentRow[]): Promise<ReportRow[]> {
  if (!students.length) return [];
  // D1 يسمح بـ 100 معامل ربط كحد أقصى في الاستعلام الواحد → نقسّم القوائم الكبيرة
  if (students.length > 80) {
    const parts: ReportRow[] = [];
    for (let i = 0; i < students.length; i += 80) parts.push(...(await buildReportRows(db, centerId, month, students.slice(i, i + 80))));
    return parts;
  }
  const ids = students.map((s) => s.id);
  const marks = ids.map(() => "?").join(",");
  const { results: daily } = await db.prepare(
    `SELECT student_id, date, attendance, from_surah, from_ayah, to_surah, to_ayah, verses,
            review_from_surah, review_from_ayah, review_to_surah, review_to_ayah FROM daily_records
      WHERE center_id = ? AND date LIKE ? AND student_id IN (${marks}) ORDER BY date`
  ).bind(centerId, `${month}-%`, ...ids).all<DailyRow>();
  const { results: saved } = await db.prepare(
    `SELECT student_id, start_surah, start_ayah, end_surah, end_ayah, pages, plan_pages, review_pages, review_plan_pages FROM monthly_reports WHERE center_id = ? AND month = ? AND student_id IN (${marks})`
  ).bind(centerId, month, ...ids).all<SavedRow>();
  const savedBy = new Map(saved.map((r) => [r.student_id, r]));
  const { results: plans } = await db.prepare(
    `SELECT student_id AS studentId, memorize_pages AS memorizePages, review_pages AS reviewPages
       FROM student_monthly_plans WHERE center_id = ? AND month = ? AND student_id IN (${marks})`
  ).bind(centerId, month, ...ids).all<{ studentId: string; memorizePages: number; reviewPages: number }>();
  const planBy = new Map(plans.map((r) => [r.studentId, r]));

  return students.map((s) => {
    const mine = daily.filter((d) => d.student_id === s.id);
    const done = mine.filter((d) => d.attendance !== "absent" && d.from_surah && d.to_surah);
    const ranges = done.map((d) => ({ from: { surah: d.from_surah!, ayah: d.from_ayah! }, to: { surah: d.to_surah!, ayah: d.to_ayah! } }));
    let start: Position | null = ranges[0]?.from ?? null;
    let end: Position | null = ranges[0]?.to ?? null;
    for (const range of ranges.slice(1)) {
      if (start && isValidRange(s.direction, range.from, start)) start = range.from;
      if (end) end = furthest(s.direction, end, range.to);
    }
    let pages = countUniquePages(s.direction, ranges);
    // كل شهر له خطته. الكشوف المحفوظة تبقى بخطتها عند الحفظ.
    let planPages = planBy.get(s.id)?.memorizePages ?? (month < "2026-09" ? s.monthlyPlanPages : 0);
    const sv = savedBy.get(s.id);
    // المراجعة: صفحات فريدة عبر أيام الشهر (لكل نطاق اتجاهه الحر)، والكشف المحفوظ يبقى بمنجزه وخطته المحفوظين
    const reviewed = mine.filter((d) => d.attendance !== "absent" && d.attendance !== "excused" && d.review_from_surah && d.review_to_surah);
    const reviewSet = new Set<number>();
    for (const d of reviewed) {
      const f = { surah: d.review_from_surah!, ayah: d.review_from_ayah! };
      const t = { surah: d.review_to_surah!, ayah: d.review_to_ayah! };
      const dir = rangeDirection(s.direction, f, t);
      if (dir) for (const p of pagesOfRange(dir, f, t)) reviewSet.add(p);
    }
    let reviewPages = reviewSet.size;
    let reviewPlanPages = planBy.get(s.id)?.reviewPages ?? 0;
    if (sv) { reviewPages = sv.review_pages; reviewPlanPages = sv.review_plan_pages; }
    if (sv) {
      planPages = sv.plan_pages;
      start = { surah: sv.start_surah, ayah: sv.start_ayah };
      end = { surah: sv.end_surah, ayah: sv.end_ayah };
      pages = sv.pages;
    }
    return {
      studentId: s.id, name: s.name, direction: s.direction, planPages,
      present: mine.filter((d) => d.attendance === "present").length,
      late: mine.filter((d) => d.attendance === "late").length,
      absent: mine.filter((d) => d.attendance === "absent").length,
      excused: mine.filter((d) => d.attendance === "excused").length,
      verses: done.reduce((n, d) => n + d.verses, 0),
      pages, start, end, daily: mine,
      juz: completedJuz(s.direction, end ?? { surah: s.lastSurah, ayah: s.lastAyah }),
      percent: planPercent(pages, planPages),
      saved: !!sv,
      reviewPages, reviewPlanPages, reviewPercent: planPercent(reviewPages, reviewPlanPages), reviewDays: reviewed.length
    };
  });
}

/** قيد فتح الكشف للمعلّم: لا شهر مستقبلي، والشهر الجاري من اليوم N (إعداد يعدّله المدير). المدير والسكرتير بلا قيد. */
async function openState(c: Context<AppEnv>, month: string): Promise<{ locked: boolean; message: string; openDay: number }> {
  const auth = c.get("auth");
  const settings = await loadSettings(c.env.DB, auth.centerId);
  const openDay = settings.monthlyReportOpenDay;
  if (auth.role !== "teacher") return { locked: false, message: "", openDay };
  const today = todayHebron();
  const current = monthOf(today);
  if (month > current) return { locked: true, message: "لا يمكن فتح كشف شهر لم يبدأ بعد", openDay };
  if (month === current && Number(today.slice(8, 10)) < openDay) return { locked: true, message: `يفتح الكشف الشهري للمحفّظ ابتداءً من اليوم ${openDay} من الشهر`, openDay };
  return { locked: false, message: "", openDay };
}

const STUDENTS_IN_CIRCLE = `SELECT s.id, s.name, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah, s.monthly_plan_pages AS monthlyPlanPages
   FROM students s WHERE s.center_id = ? AND ${circleOnSql("s")} = ? AND s.archived_at IS NULL ORDER BY s.name`;

/**
 * طالب للكشف الشهري: من يصله المستخدم الآن، وإلا (معلّم/مدير مرحلة) من كان في حلقته في نهاية ذلك الشهر
 * قبل أن يُنقل — فيبقى كشف الشهر السابق لمعلّم الحلقة القديمة بعد سريان النقل.
 */
async function studentForMonth(c: Context<AppEnv>, studentId: string, month: string): Promise<StudentLite> {
  try {
    return await accessibleStudent(c, studentId);
  } catch (e) {
    const auth = c.get("auth");
    if (!(e instanceof HTTPException) || e.status !== 404 || (auth.role !== "teacher" && auth.role !== "stage_manager")) throw e;
    const then = await c.env.DB.prepare(`SELECT ${circleOnSql("s")} AS circleId FROM students s WHERE s.id = ? AND s.center_id = ?`)
      .bind(lastDayOfMonth(month), studentId, auth.centerId).first<{ circleId: string | null }>();
    if (!then?.circleId) throw e;
    if (auth.role === "teacher") {
      if (!(auth.circleIds ?? []).includes(then.circleId)) throw e;
    } else {
      try { await assertStageCircle(c, then.circleId); } catch { throw e; }
    }
    const row = await c.env.DB.prepare(
      `SELECT id, name, gender, circle_id AS circleId, direction, last_surah AS lastSurah, last_ayah AS lastAyah,
              monthly_plan_pages AS monthlyPlanPages, archived_at AS archivedAt, user_id AS userId FROM students WHERE id = ? AND center_id = ?`
    ).bind(studentId, auth.centerId).first<StudentLite>();
    if (!row) throw e;
    return row;
  }
}

reportRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const month = url.searchParams.get("month") || monthOf(todayHebron());
  if (!MONTH_RE.test(month)) fail(400, "الشهر غير صالح");
  let circleId = url.searchParams.get("circleId") || "";
  if (auth.role === "teacher") circleId = pickTeacherCircle(c, circleId);
  if (!circleId) return c.json({ month, circleId: null, circleName: null, locked: false, message: "", openDay: 24, rows: [] });
  if (auth.role === "stage_manager") await assertStageCircle(c, circleId);
  const circle = await c.env.DB.prepare("SELECT id, name FROM circles WHERE id = ? AND center_id = ?").bind(circleId, auth.centerId).first<{ id: string; name: string }>();
  if (!circle) fail(404, "الحلقة غير موجودة");
  const state = await openState(c, month);
  if (state.locked) return c.json({ month, circleId, circleName: circle.name, ...state, rows: [] });
  const { results: students } = await c.env.DB.prepare(STUDENTS_IN_CIRCLE).bind(auth.centerId, lastDayOfMonth(month), circleId).all<StudentRow>();
  return c.json({ month, circleId, circleName: circle.name, ...state, rows: await buildReportRows(c.env.DB, auth.centerId, month, students) });
});

const pos = z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(286) });
const saveSchema = z.object({
  month: z.string().regex(MONTH_RE, "الشهر غير صالح"),
  rows: z.array(z.object({ studentId: z.string().min(1), end: pos.nullable().default(null) })).min(1).max(90)
});

/** حفظ الكشف الشهري بنهايات معدَّلة يدوياً؛ الصفحات تُعاد حسابها من البداية إلى النهاية. */
reportRoutes.post("/save", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, saveSchema);
  const state = await openState(c, b.month);
  if (state.locked) fail(403, state.message);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const row of b.rows) {
    const student = await studentForMonth(c, row.studentId, b.month);
    if (student.archivedAt) continue;
    const [built] = await buildReportRows(c.env.DB, auth.centerId, b.month, [
      { id: student.id, name: student.name, direction: student.direction, lastSurah: student.lastSurah, lastAyah: student.lastAyah, monthlyPlanPages: student.monthlyPlanPages }
    ]);
    // طالب مراجعة فقط (بلا حفظ جديد هذا الشهر): يُحفظ كشفه بمنجز المراجعة وخطتها، وحفظه صفر عند موضعه الحالي
    const hold: Position = { surah: student.lastSurah, ayah: Math.max(1, student.lastAyah) };
    // جداول الكشوف القديمة تشترط موضع حفظ؛ لسجل المراجعة وحدها نخزن موضعاً ثابتاً مع pages=0.
    const start: Position = built.start ?? nextStart(student.direction, { surah: student.lastSurah, ayah: student.lastAyah }) ?? hold;
    const end: Position = row.end ?? (built.end ?? start!);
    if (!isValidRange(student.direction, start!, end)) fail(400, `${student.name}: نهاية الحفظ يجب ألا تسبق بدايته وفق اتجاه الطالب`);
    const pages = row.end ? countPages(student.direction, start!, end) : (built.start ? built.pages : 0);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO monthly_reports (id, center_id, student_id, month, direction, start_surah, start_ayah, end_surah, end_ayah, pages, plan_pages, saved_by, saved_at, review_pages, review_plan_pages)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, month) DO UPDATE SET direction = excluded.direction, start_surah = excluded.start_surah, start_ayah = excluded.start_ayah,
           end_surah = excluded.end_surah, end_ayah = excluded.end_ayah, pages = excluded.pages, plan_pages = excluded.plan_pages,
           saved_by = excluded.saved_by, saved_at = excluded.saved_at, review_pages = excluded.review_pages, review_plan_pages = excluded.review_plan_pages`
      ).bind(newId(), auth.centerId, student.id, b.month, student.direction, start!.surah, start!.ayah, end.surah, end.ayah, pages, built.planPages, auth.userId, now, built.reviewPages, built.reviewPlanPages)
    );
  }
  if (!stmts.length) fail(400, "لا توجد صفوف صالحة للحفظ");
  await c.env.DB.batch(stmts);
  // إشعار الطلاب وأولياء أمورهم بصدور الكشف الشهري (best effort)
  try {
    const ids = b.rows.map((r) => r.studentId);
    const recipients = new Set<string>();
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40);
      const marks = part.map(() => "?").join(",");
      const own = await c.env.DB.prepare(`SELECT user_id AS id FROM students WHERE id IN (${marks}) AND user_id IS NOT NULL`).bind(...part).all<{ id: string }>();
      own.results.forEach((r) => recipients.add(r.id));
      const guardians = await c.env.DB.prepare(
        `SELECT u.id FROM students s JOIN guardians g ON g.id = s.guardian_id JOIN users u ON u.id = g.user_id WHERE s.id IN (${marks}) AND u.active = 1`
      ).bind(...part).all<{ id: string }>();
      guardians.results.forEach((r) => recipients.add(r.id));
    }
    await notifyMany(c.env.DB, [...recipients], { centerId: auth.centerId, kind: "report", title: "صدر الكشف الشهري", body: `كشف شهر ${b.month} متاح الآن.`, link: "/app" });
    await pushInBackground(c, auth.centerId, [...recipients], { title: "صدر الكشف الشهري", body: `كشف شهر ${b.month} متاح الآن.`, link: "/app" });
  } catch (e) { console.error("report notify failed", e); }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "save", entity: "report", details: `${b.month} — ${stmts.length} طالب` });
  return c.json({ ok: true, saved: stmts.length });
});

/* ============================ بوابة الطالب ============================ */
/** تفاصيل الاختبار المعتمد أو المكتمل لولي أمر الطالب فقط؛ المسودة لا تُكشف. */
portalRoutes.get("/tests/:id", requireAuth("guardian"), async (c) => {
  const auth = c.get("auth");
  const test = await c.env.DB.prepare(`SELECT t.id, t.student_id AS studentId, t.kind, t.status, t.test_type AS testType,
    t.range_text AS rangeText, t.test_date AS testDate, t.score, t.passed, t.notes,
    es.id AS sessionId, es.status AS sessionStatus, examiner.display_name AS examinerName
    FROM tests t JOIN students s ON s.id = t.student_id
    LEFT JOIN exam_sessions es ON es.test_id = t.id
    LEFT JOIN users examiner ON examiner.id = es.examiner_id
    WHERE t.id = ? AND t.center_id = ? AND s.guardian_id = ? AND s.archived_at IS NULL
      AND t.status IN ('approved','completed')`)
    .bind(c.req.param("id"), auth.centerId, auth.guardianId ?? "").first<{ id: string; sessionId: string | null; status: string; sessionStatus: string | null }>();
  if (!test) fail(404, "الاختبار غير موجود");
  const questions = test.status === "completed" && test.sessionStatus === "completed" && test.sessionId
    ? (await c.env.DB.prepare(`SELECT seq, label, surah, ayah, max_score AS maxScore, warnings, errors, score
       FROM test_questions WHERE session_id = ? AND test_id = ? ORDER BY seq`).bind(test.sessionId, test.id).all()).results
    : [];
  return c.json({ test, questions });
});
/** كل ما يراه الطالب عن نفسه في طلب واحد: الحضور والتسميع والاختبارات والسرد والكشف والإنجاز الشهري. */
async function portalStudent(c: Context<AppEnv>) {
  const auth = c.get("auth");
  const wanted = new URL(c.req.url).searchParams.get("studentId") || "";
  const base = `SELECT s.id, s.name, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah, s.monthly_plan_pages AS monthlyPlanPages,
            s.memorized_parts AS memorizedParts, ci.name AS circleName
       FROM students s LEFT JOIN circles ci ON ci.id = s.circle_id WHERE s.center_id = ? AND `;
  const stmt =
    auth.role === "guardian"
      ? c.env.DB.prepare(
          `${base}s.archived_at IS NULL AND s.guardian_id = ?${wanted ? " AND s.id = ?" : ""} ORDER BY s.name LIMIT 1`
        ).bind(...(wanted ? [auth.centerId, auth.guardianId ?? "", wanted] : [auth.centerId, auth.guardianId ?? ""]))
      : c.env.DB.prepare(`${base}s.user_id = ?`).bind(auth.centerId, auth.userId);
  const student = await stmt.first<StudentRow & { memorizedParts: number; circleName: string | null }>();
  if (!student) fail(404, auth.role === "guardian" ? "لا يوجد أبناء مرتبطون بحسابك" : "لا يوجد ملف طالب لهذا الحساب");
  return student;
}
portalRoutes.get("/summary", requireAuth("student", "guardian"), async (c) => {
  return c.json(await studentSummary(c, await portalStudent(c)));
});

/** بطاقة المتابعة الأسبوعية/الشهرية (§14.8): week = آخر 7 أيام، month = الشهر الجاري حتى اليوم. */
portalRoutes.get("/card", requireAuth("student", "guardian"), async (c) => {
  const auth = c.get("auth");
  const student = await portalStudent(c);
  const period = new URL(c.req.url).searchParams.get("period") === "month" ? "month" : "week";
  const to = todayHebron();
  const from = period === "month"
    ? `${monthOf(to)}-01`
    : new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const { results: rows } = await c.env.DB.prepare(
    `SELECT date, attendance, pages, review_pages AS reviewPages, grade, note
       FROM daily_records WHERE center_id = ? AND student_id = ? AND date BETWEEN ? AND ? ORDER BY date`
  ).bind(auth.centerId, student.id, from, to).all<{ date: string; attendance: string; pages: number | null; reviewPages: number | null; grade: string; note: string }>();
  const count = (a: string) => rows.filter((r) => r.attendance === a).length;
  const lastNote = [...rows].reverse().find((r) => r.note);
  const next = await c.env.DB.prepare(
    `SELECT date, next_memorize_from_surah AS mfs, next_memorize_from_ayah AS mfa, next_memorize_to_surah AS mts, next_memorize_to_ayah AS mta,
            next_review_from_surah AS rfs, next_review_from_ayah AS rfa, next_review_to_surah AS rts, next_review_to_ayah AS rta, next_note AS note
       FROM daily_records WHERE center_id = ? AND student_id = ? AND (next_memorize_from_surah IS NOT NULL OR next_review_from_surah IS NOT NULL OR next_note <> '')
      ORDER BY date DESC LIMIT 1`
  ).bind(auth.centerId, student.id).first<{ date: string; mfs: number | null; mfa: number | null; mts: number | null; mta: number | null; rfs: number | null; rfa: number | null; rts: number | null; rta: number | null; note: string }>();
  const { results: tests } = await c.env.DB.prepare(
    `SELECT kind, test_type AS testType, parts, range_text AS rangeText, test_date AS testDate, score, passed
       FROM tests WHERE center_id = ? AND student_id = ? AND status = 'completed' ORDER BY COALESCE(test_date, '0') DESC, created_at DESC LIMIT 2`
  ).bind(auth.centerId, student.id).all();
  const [current] = await buildReportRows(c.env.DB, auth.centerId, monthOf(to), [student]);
  return c.json({
    student: { id: student.id, name: student.name, circleName: student.circleName },
    period, from, to,
    attendance: { sessions: rows.length, present: count("present"), late: count("late"), absent: count("absent"), excused: count("excused") },
    pages: rows.reduce((n, r) => n + (r.pages ?? 0), 0),
    reviewPages: rows.reduce((n, r) => n + (r.reviewPages ?? 0), 0),
    month: { pages: current.pages, planPages: current.planPages, percent: current.percent, reviewPages: current.reviewPages, reviewPlanPages: current.reviewPlanPages, reviewPercent: current.reviewPercent },
    next, tests,
    teacherNote: lastNote ? { date: lastNote.date, text: lastNote.note } : null
  });
});

/** ملخص طالب للكادر (للتقرير المطبوع): المعلّم لطلاب حلقته فقط. */
reportRoutes.get("/student/:id", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const lite = await accessibleStudent(c, c.req.param("id"));
  const student = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah, s.monthly_plan_pages AS monthlyPlanPages,
            s.memorized_parts AS memorizedParts, ci.name AS circleName
       FROM students s LEFT JOIN circles ci ON ci.id = s.circle_id WHERE s.id = ? AND s.center_id = ?`
  ).bind(lite.id, auth.centerId).first<StudentRow & { memorizedParts: number; circleName: string | null }>();
  if (!student) fail(404, "الطالب غير موجود");
  return c.json(await studentSummary(c, student));
});

async function studentSummary(c: Context<AppEnv>, student: StudentRow & { memorizedParts: number; circleName: string | null }) {
  const auth = c.get("auth");

  const month = monthOf(todayHebron());
  const { results: daily } = await c.env.DB.prepare(
    `SELECT date, attendance, from_surah AS fromSurah, from_ayah AS fromAyah, to_surah AS toSurah, to_ayah AS toAyah, verses, pages, grade, note,
            review_from_surah AS reviewFromSurah, review_from_ayah AS reviewFromAyah, review_to_surah AS reviewToSurah, review_to_ayah AS reviewToAyah, review_pages AS reviewPages, review_grade AS reviewGrade
       FROM daily_records WHERE student_id = ? ORDER BY date DESC LIMIT 90`
  ).bind(student.id).all();
  const { results: tests } = await c.env.DB.prepare(
    `SELECT id, kind, status, test_type AS testType, parts, range_text AS rangeText, test_date AS testDate, score, passed, notes
       FROM tests WHERE student_id = ? AND status IN ('approved','completed') ORDER BY COALESCE(test_date, '9999') DESC, created_at DESC LIMIT 50`
  ).bind(student.id).all();
  const { results: sard } = await c.env.DB.prepare(
    `SELECT id, date, stage, from_surah AS fromSurah, from_ayah AS fromAyah, to_surah AS toSurah, to_ayah AS toAyah, verses, mistakes, alerts, score, band
       FROM sard_records WHERE student_id = ? ORDER BY date DESC, created_at DESC LIMIT 50`
  ).bind(student.id).all();
  const { results: reports } = await c.env.DB.prepare(
    `SELECT month, start_surah AS startSurah, start_ayah AS startAyah, end_surah AS endSurah, end_ayah AS endAyah, pages, plan_pages AS planPages, review_pages AS reviewPages, review_plan_pages AS reviewPlanPages
       FROM monthly_reports WHERE student_id = ? ORDER BY month DESC LIMIT 12`
  ).bind(student.id).all();
  const reviewLast = await c.env.DB.prepare(
    `SELECT review_to_surah AS surah, review_to_ayah AS ayah FROM daily_records
      WHERE center_id = ? AND student_id = ? AND review_to_surah IS NOT NULL ORDER BY date DESC LIMIT 1`
  ).bind(auth.centerId, student.id).first<Position>();
  const [current] = await buildReportRows(c.env.DB, auth.centerId, month, [student]);

  return {
    student: { ...student, monthlyPlanPages: current.planPages, memorizedParts: completedJuz(student.direction, { surah: student.lastSurah, ayah: student.lastAyah }), nextStart: nextStart(student.direction, { surah: student.lastSurah, ayah: student.lastAyah }), reviewLast },
    month: { month, pages: current.pages, planPages: current.planPages, percent: current.percent, present: current.present, absent: current.absent, excused: current.excused,
      reviewPages: current.reviewPages, reviewPlanPages: current.reviewPlanPages, reviewPercent: current.reviewPercent },
    daily, tests, sard, reports
  };
}

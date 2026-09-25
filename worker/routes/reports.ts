import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Direction } from "../../shared/constants";
import { completedJuz, countPages, countUniquePages, isValidRange, nextStart, planPercent, type Position } from "../../shared/quran";
import type { AppEnv } from "../env";
import { accessibleStudent, assertStageCircle, pickTeacherCircle } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { MONTH_RE, monthOf, todayHebron } from "../lib/dates";
import { notifyMany } from "../lib/notify";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

export const reportRoutes = new Hono<AppEnv>();
export const portalRoutes = new Hono<AppEnv>();

interface StudentRow { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number }
interface DailyRow { student_id: string; date: string; attendance: string; from_surah: number | null; from_ayah: number | null; to_surah: number | null; to_ayah: number | null; verses: number }
interface SavedRow { student_id: string; start_surah: number; start_ayah: number; end_surah: number; end_ayah: number; pages: number }

export interface ReportRow {
  studentId: string;
  name: string;
  direction: Direction;
  planPages: number;
  present: number;
  absent: number;
  excused: number;
  verses: number;
  pages: number;
  start: Position | null;
  end: Position | null;
  juz: number;
  percent: number;
  saved: boolean;
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
    `SELECT student_id, date, attendance, from_surah, from_ayah, to_surah, to_ayah, verses FROM daily_records
      WHERE center_id = ? AND date LIKE ? AND student_id IN (${marks}) ORDER BY date`
  ).bind(centerId, `${month}-%`, ...ids).all<DailyRow>();
  const { results: saved } = await db.prepare(
    `SELECT student_id, start_surah, start_ayah, end_surah, end_ayah, pages FROM monthly_reports WHERE center_id = ? AND month = ? AND student_id IN (${marks})`
  ).bind(centerId, month, ...ids).all<SavedRow>();
  const savedBy = new Map(saved.map((r) => [r.student_id, r]));

  return students.map((s) => {
    const mine = daily.filter((d) => d.student_id === s.id);
    const done = mine.filter((d) => d.attendance !== "absent" && d.from_surah && d.to_surah);
    const ranges = done.map((d) => ({ from: { surah: d.from_surah!, ayah: d.from_ayah! }, to: { surah: d.to_surah!, ayah: d.to_ayah! } }));
    let start: Position | null = ranges[0]?.from ?? null;
    let end: Position | null = ranges.length ? ranges[ranges.length - 1].to : null;
    let pages = countUniquePages(s.direction, ranges);
    const sv = savedBy.get(s.id);
    if (sv) {
      start = { surah: sv.start_surah, ayah: sv.start_ayah };
      end = { surah: sv.end_surah, ayah: sv.end_ayah };
      pages = sv.pages;
    }
    return {
      studentId: s.id, name: s.name, direction: s.direction, planPages: s.monthlyPlanPages,
      present: mine.filter((d) => d.attendance === "present").length,
      absent: mine.filter((d) => d.attendance === "absent").length,
      excused: mine.filter((d) => d.attendance === "excused").length,
      verses: done.reduce((n, d) => n + d.verses, 0),
      pages, start, end,
      juz: completedJuz(s.direction, end ?? { surah: s.lastSurah, ayah: s.lastAyah }),
      percent: planPercent(pages, s.monthlyPlanPages),
      saved: !!sv
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

const STUDENTS_IN_CIRCLE = `SELECT id, name, direction, last_surah AS lastSurah, last_ayah AS lastAyah, monthly_plan_pages AS monthlyPlanPages
   FROM students WHERE center_id = ? AND circle_id = ? AND archived_at IS NULL ORDER BY name`;

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
  const { results: students } = await c.env.DB.prepare(STUDENTS_IN_CIRCLE).bind(auth.centerId, circleId).all<StudentRow>();
  return c.json({ month, circleId, circleName: circle.name, ...state, rows: await buildReportRows(c.env.DB, auth.centerId, month, students) });
});

const pos = z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(286) });
const saveSchema = z.object({
  month: z.string().regex(MONTH_RE, "الشهر غير صالح"),
  rows: z.array(z.object({ studentId: z.string().min(1), end: pos })).min(1).max(90)
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
    const student = await accessibleStudent(c, row.studentId);
    if (student.archivedAt) continue;
    const [built] = await buildReportRows(c.env.DB, auth.centerId, b.month, [
      { id: student.id, name: student.name, direction: student.direction, lastSurah: student.lastSurah, lastAyah: student.lastAyah, monthlyPlanPages: student.monthlyPlanPages }
    ]);
    const start: Position | null = built.start ?? nextStart(student.direction, { surah: student.lastSurah, ayah: student.lastAyah });
    if (!start) fail(400, `${student.name}: أتمّ الطالب المسار كله، لا كشف لهذا الشهر`);
    if (!isValidRange(student.direction, start, row.end)) fail(400, `${student.name}: نهاية الحفظ يجب ألا تسبق بدايته وفق اتجاه الطالب`);
    const pages = countPages(student.direction, start, row.end);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO monthly_reports (id, center_id, student_id, month, direction, start_surah, start_ayah, end_surah, end_ayah, pages, plan_pages, saved_by, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, month) DO UPDATE SET direction = excluded.direction, start_surah = excluded.start_surah, start_ayah = excluded.start_ayah,
           end_surah = excluded.end_surah, end_ayah = excluded.end_ayah, pages = excluded.pages, plan_pages = excluded.plan_pages,
           saved_by = excluded.saved_by, saved_at = excluded.saved_at`
      ).bind(newId(), auth.centerId, student.id, b.month, student.direction, start.surah, start.ayah, row.end.surah, row.end.ayah, pages, student.monthlyPlanPages, auth.userId, now)
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
  } catch (e) { console.error("report notify failed", e); }
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "save", entity: "report", details: `${b.month} — ${stmts.length} طالب` });
  return c.json({ ok: true, saved: stmts.length });
});

/* ============================ بوابة الطالب ============================ */
/** كل ما يراه الطالب عن نفسه في طلب واحد: الحضور والتسميع والاختبارات والسرد والكشف والإنجاز الشهري. */
portalRoutes.get("/summary", requireAuth("student", "guardian"), async (c) => {
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
  return c.json(await studentSummary(c, student));
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
    `SELECT date, attendance, from_surah AS fromSurah, from_ayah AS fromAyah, to_surah AS toSurah, to_ayah AS toAyah, verses, pages, grade, note
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
    `SELECT month, start_surah AS startSurah, start_ayah AS startAyah, end_surah AS endSurah, end_ayah AS endAyah, pages, plan_pages AS planPages
       FROM monthly_reports WHERE student_id = ? ORDER BY month DESC LIMIT 12`
  ).bind(student.id).all();
  const [current] = await buildReportRows(c.env.DB, auth.centerId, month, [student]);

  return {
    student: { ...student, memorizedParts: completedJuz(student.direction, { surah: student.lastSurah, ayah: student.lastAyah }), nextStart: nextStart(student.direction, { surah: student.lastSurah, ayah: student.lastAyah }) },
    month: { month, pages: current.pages, planPages: current.planPages, percent: current.percent, present: current.present, absent: current.absent, excused: current.excused },
    daily, tests, sard, reports
  };
}

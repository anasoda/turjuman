import { Hono } from "hono";
import { z } from "zod";
import { circleDayStatus, type CircleDayStatus } from "../../shared/circle-day";
import type { AppEnv } from "../env";
import { assertStageCircle, circleScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { DATE_RE, todayHebron, weekdayNameAr } from "../lib/dates";
import { notifyMany } from "../lib/notify";
import { pushInBackground } from "../lib/push";
import { circleOnSql } from "../lib/transfers";
import { audit, fail, parseBody } from "../lib/util";

export const circleDayRoutes = new Hono<AppEnv>();

const REMINDER_KIND = "record_reminder";
/** لا يتكرر تنبيه الحلقة نفسها في اليوم نفسه قبل مضي هذه المدة (يمنع الضغط المزدوج وإزعاج المعلّم). */
const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

interface DayStats {
  recorded: number; present: number; late: number; absent: number; excused: number; notMemorized: number;
  hifzStudents: number; hifzPages: number; reviewStudents: number; reviewPages: number;
}
const ZERO: DayStats = { recorded: 0, present: 0, late: 0, absent: 0, excused: 0, notMemorized: 0, hifzStudents: 0, hifzPages: 0, reviewStudents: 0, reviewPages: 0 };
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** متابعة سير الحلقات في يوم: الحضور والغياب وصفحات الحفظ وعدد من سُجّل حفظهم، لكل حلقة. */
circleDayRoutes.get("/", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const date = new URL(c.req.url).searchParams.get("date") || todayHebron();
  if (!DATE_RE.test(date)) fail(400, "التاريخ غير صالح");
  const scope = circleScope(c, "c");
  const db = c.env.DB;

  const [circlesQ, teachersQ, scheduleQ, cancelQ, studentsQ, statsQ, remindersQ] = await Promise.all([
    db.prepare(`SELECT c.id, c.name FROM circles c WHERE c.center_id = ? AND c.active = 1${scope.sql} ORDER BY c.name`)
      .bind(auth.centerId, ...scope.binds).all<{ id: string; name: string }>(),
    db.prepare(`SELECT ct.circle_id AS circleId, ct.kind, u.id, u.display_name AS name FROM circle_teachers ct
                  JOIN circles c ON c.id = ct.circle_id JOIN users u ON u.id = ct.teacher_id
                 WHERE c.center_id = ? AND u.active = 1 ORDER BY ct.kind DESC, u.display_name`)
      .bind(auth.centerId).all<{ circleId: string; kind: "primary" | "assistant"; id: string; name: string }>(),
    db.prepare("SELECT s.circle_id AS circleId, s.weekday FROM circle_schedule s JOIN circles c ON c.id = s.circle_id WHERE c.center_id = ?")
      .bind(auth.centerId).all<{ circleId: string; weekday: number }>(),
    db.prepare("SELECT circle_id AS circleId, reason FROM session_cancellations WHERE center_id = ? AND date = ?")
      .bind(auth.centerId, date).all<{ circleId: string; reason: string }>(),
    db.prepare(`SELECT ${circleOnSql("s")} AS circleId, COUNT(*) AS n FROM students s WHERE s.center_id = ? AND s.archived_at IS NULL GROUP BY 1`)
      .bind(date, auth.centerId).all<{ circleId: string | null; n: number }>(),
    db.prepare(
      `SELECT COALESCE(d.circle_id, ${circleOnSql("s")}) AS circleId,
              COUNT(*) AS recorded,
              SUM(d.attendance = 'present') AS present, SUM(d.attendance = 'late') AS late,
              SUM(d.attendance = 'absent') AS absent, SUM(d.attendance = 'excused') AS excused, SUM(d.attendance = 'not_memorized') AS notMemorized,
              SUM(CASE WHEN d.attendance IN ('present','late') AND d.from_surah IS NOT NULL THEN 1 ELSE 0 END) AS hifzStudents,
              SUM(CASE WHEN d.attendance IN ('present','late') AND d.from_surah IS NOT NULL THEN d.pages ELSE 0 END) AS hifzPages,
              SUM(CASE WHEN d.attendance IN ('present','late') AND d.review_from_surah IS NOT NULL THEN 1 ELSE 0 END) AS reviewStudents,
              SUM(CASE WHEN d.attendance IN ('present','late') AND d.review_from_surah IS NOT NULL THEN d.review_pages ELSE 0 END) AS reviewPages
         FROM daily_records d JOIN students s ON s.id = d.student_id
        WHERE d.center_id = ? AND d.date = ? GROUP BY 1`)
      .bind(date, auth.centerId, date).all<DayStats & { circleId: string | null }>(),
    db.prepare("SELECT source_id AS sourceId, MAX(created_at) AS at FROM notifications WHERE center_id = ? AND kind = ? AND source_id LIKE ? GROUP BY source_id")
      .bind(auth.centerId, REMINDER_KIND, `%:${date}`).all<{ sourceId: string; at: number }>()
  ]);

  const weekdaysBy = new Map<string, Set<number>>();
  for (const r of scheduleQ.results) (weekdaysBy.get(r.circleId) ?? weekdaysBy.set(r.circleId, new Set()).get(r.circleId)!).add(r.weekday);
  const cancelBy = new Map(cancelQ.results.map((r) => [r.circleId, r.reason]));
  const studentsBy = new Map(studentsQ.results.map((r) => [r.circleId ?? "", r.n]));
  const statsBy = new Map(statsQ.results.map((r) => [r.circleId ?? "", r]));
  const remindBy = new Map(remindersQ.results.map((r) => [r.sourceId.split(":")[0], r.at]));

  const circles = circlesQ.results.map((circle) => {
    const days = weekdaysBy.get(circle.id);
    const stats = { ...ZERO, ...(statsBy.get(circle.id) ?? {}) };
    const students = studentsBy.get(circle.id) ?? 0;
    const status = circleDayStatus({ cancelled: cancelBy.has(circle.id), scheduledDay: days ? days.has(weekdayOf(date)) : null, students, recorded: stats.recorded });
    return {
      id: circle.id, name: circle.name, status, students, cancelReason: cancelBy.get(circle.id) ?? null,
      noSchedule: !days,
      teachers: teachersQ.results.filter((t) => t.circleId === circle.id).map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
      recorded: stats.recorded, present: stats.present, late: stats.late, absent: stats.absent, excused: stats.excused, notMemorized: stats.notMemorized,
      hifzStudents: stats.hifzStudents, hifzPages: stats.hifzPages, reviewStudents: stats.reviewStudents, reviewPages: stats.reviewPages,
      remindedAt: remindBy.get(circle.id) ?? null
    };
  });
  // ما يحتاج متابعة أولاً، ثم الأقل اكتمالاً، ثم الاسم
  const RANK: Record<CircleDayStatus, number> = { none: 0, partial: 1, complete: 2, empty: 3, off: 4, cancelled: 5 };
  circles.sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name, "ar"));

  const live = circles.filter((x) => x.status !== "cancelled" && x.status !== "off" && x.status !== "empty");
  const sum = (k: "students" | "recorded" | "present" | "late" | "absent" | "excused" | "notMemorized" | "hifzStudents" | "hifzPages" | "reviewStudents" | "reviewPages") =>
    circles.reduce((n, x) => n + x[k], 0);
  return c.json({
    date, weekday: weekdayNameAr(date), isToday: date === todayHebron(), circles,
    totals: {
      circles: circles.length, pending: live.filter((x) => x.status === "none" || x.status === "partial").length, complete: live.filter((x) => x.status === "complete").length,
      students: sum("students"), recorded: sum("recorded"), present: sum("present"), late: sum("late"), absent: sum("absent"), excused: sum("excused"), notMemorized: sum("notMemorized"),
      hifzStudents: sum("hifzStudents"), hifzPages: sum("hifzPages"), reviewStudents: sum("reviewStudents"), reviewPages: sum("reviewPages")
    }
  });
});

const remindSchema = z.object({
  circleId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  note: z.string().trim().max(200).default("")
});

/** تنبيه معلّمي الحلقة إلى استكمال تسجيل متابعة يوم معيّن. */
circleDayRoutes.post("/remind", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, remindSchema);
  if (b.date > todayHebron()) fail(400, "لا يُرسَل تنبيه عن يوم لم يأتِ بعد");
  const circle = await c.env.DB.prepare("SELECT id, name FROM circles WHERE id = ? AND center_id = ?").bind(b.circleId, auth.centerId).first<{ id: string; name: string }>();
  if (!circle) fail(404, "الحلقة غير موجودة");
  await assertStageCircle(c, circle.id);
  const cancelled = await c.env.DB.prepare("SELECT 1 FROM session_cancellations WHERE circle_id = ? AND date = ?").bind(circle.id, b.date).first();
  if (cancelled) fail(409, "حصة هذا اليوم ملغاة؛ لا يلزم تسجيل");

  const [{ n: students }, { n: recorded }] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM students s WHERE s.center_id = ? AND s.archived_at IS NULL AND ${circleOnSql("s")} = ?`)
      .bind(auth.centerId, b.date, circle.id).first<{ n: number }>().then((r) => r ?? { n: 0 }),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM daily_records d JOIN students s ON s.id = d.student_id
                       WHERE d.center_id = ? AND d.date = ? AND COALESCE(d.circle_id, ${circleOnSql("s")}) = ?`)
      .bind(auth.centerId, b.date, b.date, circle.id).first<{ n: number }>().then((r) => r ?? { n: 0 })
  ]);
  if (students > 0 && recorded >= students) fail(409, "سُجّلت متابعة جميع طلاب الحلقة في هذا اليوم");
  const { results: days } = await c.env.DB.prepare("SELECT weekday FROM circle_schedule WHERE circle_id = ?").bind(circle.id).all<{ weekday: number }>();
  if (days.length && recorded === 0 && !days.some((d) => d.weekday === weekdayOf(b.date))) fail(409, "لا حصة لهذه الحلقة في هذا اليوم حسب جدولها");

  const { results: teachers } = await c.env.DB.prepare(
    "SELECT u.id FROM circle_teachers ct JOIN users u ON u.id = ct.teacher_id WHERE ct.circle_id = ? AND u.active = 1"
  ).bind(circle.id).all<{ id: string }>();
  if (!teachers.length) fail(409, "لا يوجد معلّم فعّال في هذه الحلقة لتنبيهه");

  const sourceId = `${circle.id}:${b.date}`;
  const last = await c.env.DB.prepare("SELECT MAX(created_at) AS at FROM notifications WHERE center_id = ? AND kind = ? AND source_id = ?")
    .bind(auth.centerId, REMINDER_KIND, sourceId).first<{ at: number | null }>();
  if (last?.at && Date.now() - last.at < REMINDER_COOLDOWN_MS) fail(409, "أُرسل تنبيه لمعلّمي هذه الحلقة قبل قليل؛ انتظر ساعة قبل إعادته");

  const title = `استكمال متابعة ${circle.name}`;
  const progress = students > 0 ? `سُجّل ${recorded} من ${students} طالب` : "لم تُسجَّل متابعة";
  const body = `${progress} ليوم ${weekdayNameAr(b.date)} ${b.date}. يرجى استكمال التسجيل.${b.note ? `\n${b.note}` : ""}`;
  const link = `/app/daily?circle=${circle.id}&date=${b.date}`;
  const uids = teachers.map((t) => t.id);
  await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: REMINDER_KIND, title, body, link, sourceId });
  await pushInBackground(c, auth.centerId, uids, { title, body, link });
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "record_reminder", entityId: circle.id, details: `${circle.name} ${b.date}: ${recorded}/${students}` });
  return c.json({ ok: true, notified: uids.length });
});

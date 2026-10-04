import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { assertStageCircle, circleScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { DATE_RE, todayHebron, weekdayNameAr } from "../lib/dates";
import { notifyMany } from "../lib/notify";
import { pushInBackground } from "../lib/push";
import { circleOnSql } from "../lib/transfers";
import { audit, fail, parseBody } from "../lib/util";

export const cancellationRoutes = new Hono<AppEnv>();

const MAX_AHEAD_DAYS = 60;
const cancelSchema = z.object({
  circleId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  reason: z.string().trim().min(3, "اكتب سبب الإلغاء").max(200)
});

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** الصلاحية على الحلقة: الإدارة للكل، المعلّم لحلقاته، مدير المرحلة لمراحله. */
async function ownCircle(c: import("hono").Context<AppEnv>, circleId: string) {
  const auth = c.get("auth");
  const circle = await c.env.DB.prepare("SELECT id, name FROM circles WHERE id = ? AND center_id = ?").bind(circleId, auth.centerId).first<{ id: string; name: string }>();
  if (!circle) fail(404, "الحلقة غير موجودة");
  if (auth.role === "teacher" && !(auth.circleIds ?? []).includes(circleId)) fail(403, "هذه ليست حلقتك");
  await assertStageCircle(c, circleId);
  return circle;
}

/** حسابات أولياء طلاب الحلقة في ذلك اليوم (بحلقة الطالب وقتها). */
async function circleGuardianUsers(c: import("hono").Context<AppEnv>, circleId: string, date: string): Promise<string[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT u.id FROM students s JOIN guardians g ON g.id = s.guardian_id JOIN users u ON u.id = g.user_id
      WHERE s.center_id = ? AND s.archived_at IS NULL AND u.active = 1 AND ${circleOnSql("s")} = ?`
  ).bind(c.get("auth").centerId, date, circleId).all<{ id: string }>();
  return results.map((r) => r.id);
}

/** إعلان إلغاء حصة: يظهر لأولياء الحلقة ويصلهم إشعار. لا إلغاء ليوم فيه تسجيل متابعة. */
cancellationRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, cancelSchema);
  const today = todayHebron();
  if (b.date < today) fail(400, "لا يمكن إلغاء حصة في يوم مضى");
  if (b.date > addDays(today, MAX_AHEAD_DAYS)) fail(400, `الحد الأقصى للإلغاء المسبق ${MAX_AHEAD_DAYS} يوماً`);
  const circle = await ownCircle(c, b.circleId);
  const dup = await c.env.DB.prepare("SELECT 1 FROM session_cancellations WHERE circle_id = ? AND date = ?").bind(circle.id, b.date).first();
  if (dup) fail(409, "الحصة ملغاة مسبقاً في هذا اليوم");
  const recorded = await c.env.DB.prepare("SELECT 1 FROM daily_records WHERE center_id = ? AND circle_id = ? AND date = ? LIMIT 1").bind(auth.centerId, circle.id, b.date).first();
  if (recorded) fail(409, "سُجّلت متابعة لطلاب هذه الحلقة في هذا اليوم؛ لا يمكن إلغاء حصة فيها تسجيل");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO session_cancellations (id, center_id, circle_id, date, reason, cancelled_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, auth.centerId, circle.id, b.date, b.reason, auth.userId, Date.now()).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "session_cancellation", entityId: id, details: `${circle.name} ${b.date}: ${b.reason}` });
  const uids = await circleGuardianUsers(c, circle.id, b.date);
  const title = `إلغاء حصة ${circle.name}`;
  const body = `أُلغيت حصة ${weekdayNameAr(b.date)} ${b.date}.\nالسبب: ${b.reason}`;
  await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "session_cancelled", title, body, link: "/app", sourceId: id });
  await pushInBackground(c, auth.centerId, uids, { title, body, link: "/app" });
  return c.json({ ok: true, id, notified: uids.length }, 201);
});

/** إعادة الحصة (التراجع عن الإلغاء) مع إشعار الأولياء. */
cancellationRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare("SELECT id, circle_id AS circleId, date FROM session_cancellations WHERE id = ? AND center_id = ?")
    .bind(c.req.param("id"), auth.centerId).first<{ id: string; circleId: string; date: string }>();
  if (!row) fail(404, "الإلغاء غير موجود");
  const circle = await ownCircle(c, row.circleId);
  await c.env.DB.prepare("DELETE FROM session_cancellations WHERE id = ?").bind(row.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "session_cancellation", entityId: row.id, details: `${circle.name} ${row.date}` });
  if (row.date >= todayHebron()) {
    const uids = await circleGuardianUsers(c, circle.id, row.date);
    const title = `أُعيدت حصة ${circle.name}`;
    const body = `عادت حصة ${weekdayNameAr(row.date)} ${row.date} كما هي.`;
    await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "session_restored", title, body, link: "/app", sourceId: row.id });
    await pushInBackground(c, auth.centerId, uids, { title, body, link: "/app" });
  }
  return c.json({ ok: true });
});

/** الإلغاءات القادمة (والأخيرة) للكادر ضمن نطاقه. */
cancellationRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const from = DATE_RE.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : addDays(todayHebron(), -7);
  const to = DATE_RE.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : addDays(todayHebron(), MAX_AHEAD_DAYS);
  const scope = circleScope(c, "ci");
  let where = "sc.center_id = ? AND sc.date BETWEEN ? AND ?";
  const binds: unknown[] = [auth.centerId, from, to];
  if (auth.role === "teacher") {
    const mine = auth.circleIds ?? [];
    if (!mine.length) return c.json({ cancellations: [] });
    where += ` AND sc.circle_id IN (${mine.map(() => "?").join(",")})`;
    binds.push(...mine);
  }
  const circleId = url.searchParams.get("circleId") || "";
  if (circleId) { where += " AND sc.circle_id = ?"; binds.push(circleId); }
  const { results } = await c.env.DB.prepare(
    `SELECT sc.id, sc.circle_id AS circleId, ci.name AS circleName, sc.date, sc.reason, u.display_name AS cancelledByName
       FROM session_cancellations sc JOIN circles ci ON ci.id = sc.circle_id LEFT JOIN users u ON u.id = sc.cancelled_by
      WHERE ${where}${scope.sql} ORDER BY sc.date, ci.name`
  ).bind(...binds, ...scope.binds).all();
  return c.json({ cancellations: results });
});

/** ما يراه ولي الأمر (أو الطالب): الإلغاءات الجارية والقادمة لحلقات أبنائه، مع أسماء أبنائه المعنيين. */
cancellationRoutes.get("/mine", requireAuth("student", "guardian"), async (c) => {
  const auth = c.get("auth");
  const today = todayHebron();
  const kids = auth.role === "guardian"
    ? await c.env.DB.prepare("SELECT s.name, s.circle_id AS circleId FROM students s WHERE s.center_id = ? AND s.guardian_id = ? AND s.archived_at IS NULL AND s.circle_id IS NOT NULL").bind(auth.centerId, auth.guardianId ?? "").all<{ name: string; circleId: string }>()
    : await c.env.DB.prepare("SELECT s.name, s.circle_id AS circleId FROM students s WHERE s.center_id = ? AND s.user_id = ? AND s.archived_at IS NULL AND s.circle_id IS NOT NULL").bind(auth.centerId, auth.userId).all<{ name: string; circleId: string }>();
  const circles = [...new Set(kids.results.map((k) => k.circleId))];
  if (!circles.length) return c.json({ cancellations: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT sc.id, sc.circle_id AS circleId, ci.name AS circleName, sc.date, sc.reason
       FROM session_cancellations sc JOIN circles ci ON ci.id = sc.circle_id
      WHERE sc.center_id = ? AND sc.date BETWEEN ? AND ? AND sc.circle_id IN (${circles.map(() => "?").join(",")}) ORDER BY sc.date`
  ).bind(auth.centerId, today, addDays(today, MAX_AHEAD_DAYS), ...circles).all<{ id: string; circleId: string; circleName: string; date: string; reason: string }>();
  return c.json({ cancellations: results.map((r) => ({ ...r, students: kids.results.filter((k) => k.circleId === r.circleId).map((k) => k.name) })) });
});

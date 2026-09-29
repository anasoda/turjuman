import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { newId } from "../lib/crypto";
import { audit, fail, loadSettings, parseBody } from "../lib/util";
import { circleScope } from "../lib/access";

export const circleRoutes = new Hono<AppEnv>();

const circleSchema = z.object({
  name: z.string().trim().min(2, "اسم الحلقة قصير جداً").max(80),
  category: z.enum(["male", "female"]),
  levelKey: z.string().min(1, "اختر مرحلة الحلقة"),
  active: z.boolean().default(true),
  primaryTeacherId: z.string().nullable().default(null),
  assistantTeacherId: z.string().nullable().default(null)
});

interface CircleRow {
  id: string; name: string; category: "male" | "female"; levelKey: string; active: number;
  studentCount: number; primaryTeacherId: string | null; primaryTeacherName: string | null;
  assistantTeacherId: string | null; assistantTeacherName: string | null;
}

const SELECT_CIRCLES = `
  SELECT c.id, c.name, c.category, c.level_key AS levelKey, c.active,
         (SELECT COUNT(*) FROM students s WHERE s.circle_id = c.id AND s.archived_at IS NULL) AS studentCount,
         tp.id AS primaryTeacherId, tp.display_name AS primaryTeacherName,
         ta.id AS assistantTeacherId, ta.display_name AS assistantTeacherName
    FROM circles c
    LEFT JOIN circle_teachers cp ON cp.circle_id = c.id AND cp.kind = 'primary'
    LEFT JOIN users tp ON tp.id = cp.teacher_id
    LEFT JOIN circle_teachers ca ON ca.circle_id = c.id AND ca.kind = 'assistant'
    LEFT JOIN users ta ON ta.id = ca.teacher_id`;

const shape = (r: CircleRow) => ({ ...r, active: r.active === 1 });

circleRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  let sql = `${SELECT_CIRCLES} WHERE c.center_id = ?`;
  const binds: unknown[] = [auth.centerId];
  if (auth.role === "teacher") {
    sql += " AND c.id IN (SELECT circle_id FROM circle_teachers WHERE teacher_id = ?)";
    binds.push(auth.userId);
  }
  const scope = circleScope(c, "c");
  sql += scope.sql;
  binds.push(...scope.binds);
  const { results } = await c.env.DB.prepare(`${sql} ORDER BY c.name`).bind(...binds).all<CircleRow>();
  return c.json({ circles: results.map(shape) });
});

/** يتحقق أن المعلّمين المختارين فعّالون ومن نفس فئة الحلقة (لا مانع من حلقة أخرى — هجرة 0009). */
async function checkTeachers(c: import("hono").Context<AppEnv>, category: string, ids: (string | null)[]) {
  const auth = c.get("auth");
  const picked = ids.filter((x): x is string => !!x);
  if (picked.length === 2 && picked[0] === picked[1]) fail(400, "لا يمكن اختيار المعلّم نفسه أساسياً ومساعداً");
  for (const id of picked) {
    const t = await c.env.DB.prepare(
      `SELECT u.id, u.active, p.gender
         FROM users u LEFT JOIN staff_profiles p ON p.user_id = u.id
        WHERE u.id = ? AND u.center_id = ? AND u.role = 'teacher'`
    )
      .bind(id, auth.centerId)
      .first<{ id: string; active: number; gender: string | null }>();
    if (!t) fail(400, "معلّم غير موجود");
    if (t.active !== 1) fail(400, "لا يمكن تعيين معلّم موقوف");
    if (t.gender && t.gender !== category) fail(400, "فئة الحلقة لا تطابق جنس المعلّم");
    // رُفع قيد «حلقة واحدة لكل معلّم» في هجرة 0009 (§15.5): يجوز أن يدرّس أكثر من حلقة.
  }
}

function assignStatements(c: import("hono").Context<AppEnv>, circleId: string, primary: string | null, assistant: string | null) {
  const stmts = [c.env.DB.prepare("DELETE FROM circle_teachers WHERE circle_id = ?").bind(circleId)];
  if (primary) stmts.push(c.env.DB.prepare("INSERT INTO circle_teachers (circle_id, teacher_id, kind) VALUES (?, ?, 'primary')").bind(circleId, primary));
  if (assistant) stmts.push(c.env.DB.prepare("INSERT INTO circle_teachers (circle_id, teacher_id, kind) VALUES (?, ?, 'assistant')").bind(circleId, assistant));
  return stmts;
}

async function assertLevel(c: import("hono").Context<AppEnv>, levelKey: string) {
  const s = await loadSettings(c.env.DB, c.get("auth").centerId);
  if (!s.levels.some((l) => l.key === levelKey)) fail(400, "مرحلة الحلقة غير معرّفة في الإعدادات");
}

circleRoutes.post("/", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, circleSchema);
  await assertLevel(c, b.levelKey);
  const dup = await c.env.DB.prepare("SELECT id FROM circles WHERE center_id = ? AND name = ?").bind(auth.centerId, b.name).first();
  if (dup) fail(409, "يوجد حلقة بهذا الاسم");
  await checkTeachers(c, b.category, [b.primaryTeacherId, b.assistantTeacherId]);
  if (b.assistantTeacherId && !b.primaryTeacherId) fail(400, "عيّن المعلّم الأساسي قبل المساعد");
  const id = newId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO circles (id, center_id, name, category, level_key, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, auth.centerId, b.name, b.category, b.levelKey, b.active ? 1 : 0, now, now),
    ...assignStatements(c, id, b.primaryTeacherId, b.assistantTeacherId).slice(1)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "circle", entityId: id, details: b.name });
  return c.json({ ok: true, id }, 201);
});

circleRoutes.put("/:id", requireAuth("admin", "secretary", "teacher"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, category FROM circles WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first<{ id: string; category: string }>();
  if (!existing) fail(404, "الحلقة غير موجودة");
  if (auth.role === "teacher") {
    const own = await c.env.DB.prepare("SELECT 1 FROM circle_teachers WHERE circle_id = ? AND teacher_id = ?").bind(id, auth.userId).first();
    if (!own) fail(404, "الحلقة غير موجودة");
  }
  const b = await parseBody(c, circleSchema);
  if (auth.role === "teacher") {
    const assigned = await c.env.DB.prepare("SELECT teacher_id AS teacherId, kind FROM circle_teachers WHERE circle_id = ?").bind(id).all<{ teacherId: string; kind: string }>();
    const primary = assigned.results.find((x) => x.kind === "primary")?.teacherId ?? null;
    const assistant = assigned.results.find((x) => x.kind === "assistant")?.teacherId ?? null;
    if (b.primaryTeacherId !== primary || b.assistantTeacherId !== assistant) fail(403, "لا يمكنك تغيير إسناد معلّمي الحلقة");
  }
  await assertLevel(c, b.levelKey);
  const dup = await c.env.DB.prepare("SELECT id FROM circles WHERE center_id = ? AND name = ? AND id <> ?").bind(auth.centerId, b.name, id).first();
  if (dup) fail(409, "يوجد حلقة بهذا الاسم");
  if (b.category !== existing.category) {
    const has = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE circle_id = ? AND archived_at IS NULL").bind(id).first<{ n: number }>();
    if (has && has.n > 0) fail(400, "لا يمكن تغيير فئة حلقة فيها طلاب");
  }
  await checkTeachers(c, b.category, [b.primaryTeacherId, b.assistantTeacherId]);
  if (b.assistantTeacherId && !b.primaryTeacherId) fail(400, "عيّن المعلّم الأساسي قبل المساعد");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE circles SET name = ?, category = ?, level_key = ?, active = ?, updated_at = ? WHERE id = ?")
      .bind(b.name, b.category, b.levelKey, b.active ? 1 : 0, Date.now(), id),
    ...assignStatements(c, id, b.primaryTeacherId, b.assistantTeacherId)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "circle", entityId: id, details: b.name });
  return c.json({ ok: true });
});

/** لا حذف لحلقة فيها طلاب (المؤرشفون يُحتسبون) — يُعطَّل بدلاً من ذلك. */
circleRoutes.delete("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, name FROM circles WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first<{ id: string; name: string }>();
  if (!existing) fail(404, "الحلقة غير موجودة");
  // المؤرشفون لا يمنعون الحذف (§15.5): يُفكّ ارتباطهم بالحلقة المحذوفة.
  const has = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE circle_id = ? AND archived_at IS NULL").bind(id).first<{ n: number }>();
  if (has && has.n > 0) fail(400, `لا يمكن حذف الحلقة قبل نقل طلابها (${has.n})؛ يمكنك تعطيلها بدلاً من ذلك`);
  const hasDaily = await c.env.DB.prepare("SELECT 1 FROM daily_records WHERE circle_id = ? LIMIT 1").bind(id).first();
  const hasSard = await c.env.DB.prepare("SELECT 1 FROM sard_records WHERE circle_id = ? LIMIT 1").bind(id).first();
  const hasTests = await c.env.DB.prepare("SELECT 1 FROM tests WHERE circle_id = ? LIMIT 1").bind(id).first();
  const hasTransfers = await c.env.DB.prepare("SELECT 1 FROM student_transfers WHERE from_circle_id = ? OR to_circle_id = ? LIMIT 1").bind(id, id).first();
  if (hasDaily || hasSard || hasTests || hasTransfers) fail(400, "لا يمكن حذف الحلقة لوجود سجلات أو انتقالات تاريخية مرتبطة بها؛ يمكنك تعطيلها بدلاً من ذلك");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE students SET circle_id = NULL, updated_at = ? WHERE circle_id = ?").bind(Date.now(), id),
    c.env.DB.prepare("DELETE FROM circle_schedule WHERE circle_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM circle_teachers WHERE circle_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM circles WHERE id = ?").bind(id)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "circle", entityId: id, details: existing.name });
  return c.json({ ok: true });
});

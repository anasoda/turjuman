import type { Context } from "hono";
import type { Direction } from "../../shared/constants";
import type { AppEnv } from "../env";
import { fail } from "./util";

export interface StudentLite {
  id: string;
  name: string;
  gender: "male" | "female";
  circleId: string | null;
  direction: Direction;
  lastSurah: number;
  lastAyah: number;
  monthlyPlanPages: number;
  archivedAt: number | null;
  userId: string | null;
}

const SELECT = `SELECT id, name, gender, circle_id AS circleId, direction, last_surah AS lastSurah, last_ayah AS lastAyah,
                       monthly_plan_pages AS monthlyPlanPages, archived_at AS archivedAt, user_id AS userId FROM students`;

/** مراحل مدير المرحلة من الجلسة (§15.3). لا تُقرأ من جسم الطلب أبداً. */
export function stagesOf(c: Context<AppEnv>): string[] {
  const s = c.get("auth").stages ?? [];
  if (!s.length) fail(403, "لا توجد مراحل مسنَدة إلى حسابك");
  return s;
}

/**
 * شرط SQL لحلقات مدير المرحلة: حلقات مراحله **أو حلقته هو** إن كان يدرّس.
 * مدير المرحلة تعيينٌ فوق حساب المعلّم (قرار المالك)، فقد تُسنَد إليه حلقة خارج مراحله
 * ويجب أن يبقى معلّمها. `col` عمود معرّف الحلقة في الاستعلام (مثل `s.circle_id` أو `c.id`).
 */
export function stageCircleSql(c: Context<AppEnv>, col: string): { sql: string; binds: unknown[] } {
  const auth = c.get("auth");
  const stages = stagesOf(c);
  const own = auth.circleIds ?? [];
  const parts = [`${col} IN (SELECT id FROM circles WHERE center_id = ? AND level_key IN (${stages.map(() => "?").join(",")}))`];
  const binds: unknown[] = [auth.centerId, ...stages];
  if (own.length) {
    parts.push(`${col} IN (${own.map(() => "?").join(",")})`);
    binds.push(...own);
  }
  return { sql: ` AND (${parts.join(" OR ")})`, binds };
}

/** يتحقق أن الحلقة ضمن مراحل مدير المرحلة أو أنها حلقته؛ لغيره لا يفعل شيئاً. */
export async function assertStageCircle(c: Context<AppEnv>, circleId: string | null) {
  const auth = c.get("auth");
  if (auth.role !== "stage_manager") return;
  if (!circleId) fail(403, "اختر حلقة من مراحلك");
  if ((auth.circleIds ?? []).includes(circleId)) return;
  const stages = stagesOf(c);
  const ok = await c.env.DB.prepare(`SELECT 1 FROM circles WHERE id = ? AND center_id = ? AND level_key IN (${stages.map(() => "?").join(",")})`)
    .bind(circleId, auth.centerId, ...stages)
    .first();
  if (!ok) fail(403, "هذه الحلقة خارج مراحلك");
}

/**
 * حلقات المعلّم الحالي (أساسياً كان أو مساعداً) — قد تكون أكثر من واحدة بعد هجرة 0009.
 * تُقرأ من الجلسة (`loadAuth` يحمّلها في كل طلب) فلا استعلام إضافي.
 */
export function teacherCircleIds(c: Context<AppEnv>): string[] {
  return c.get("auth").circleIds ?? [];
}

/**
 * الحلقة التي يعمل عليها المعلّم في هذا الطلب: المطلوبة إن كانت له، وإلا أولى حلقاته.
 * تُرجع "" إن لم تُسنَد إليه حلقة، أو إن طلب حلقة ليست له (فلا يرى شيئاً).
 */
export function pickTeacherCircle(c: Context<AppEnv>, wanted: string): string {
  const mine = teacherCircleIds(c);
  if (!mine.length) return "";
  if (!wanted) return mine[0];
  return mine.includes(wanted) ? wanted : "";
}

/**
 * يحمّل طالباً بعد فحص الصلاحية: الإداريون واللجنة لكل المركز، المعلّم لحلقته فقط، الطالب لنفسه فقط.
 * غير المسموح يرى «غير موجود» (لا نكشف وجود طلاب الآخرين).
 */
export async function accessibleStudent(c: Context<AppEnv>, studentId: string): Promise<StudentLite> {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND center_id = ?`).bind(studentId, auth.centerId).first<StudentLite>();
  if (!row) fail(404, "الطالب غير موجود");
  if (auth.role === "teacher") {
    if (!row.circleId || !teacherCircleIds(c).includes(row.circleId)) fail(404, "الطالب غير موجود");
  } else if (auth.role === "stage_manager") {
    const stages = stagesOf(c);
    const ok =
      !!row.circleId &&
      ((auth.circleIds ?? []).includes(row.circleId) ||
        !!(await c.env.DB.prepare(`SELECT 1 FROM circles WHERE id = ? AND center_id = ? AND level_key IN (${stages.map(() => "?").join(",")})`)
          .bind(row.circleId, auth.centerId, ...stages)
          .first()));
    if (!ok) fail(404, "الطالب غير موجود");
  } else if (auth.role === "student") {
    if (row.userId !== auth.userId) fail(404, "الطالب غير موجود");
  }
  return row;
}

/** شرط SQL يحصر الطلاب في نطاق المستخدم (يُستعمل مع alias اسمه s). */
export function studentScope(c: Context<AppEnv>): { sql: string; binds: unknown[] } {
  const auth = c.get("auth");
  if (auth.role === "teacher") {
    const mine = teacherCircleIds(c);
    if (!mine.length) return { sql: " AND 1 = 0", binds: [] }; // بلا حلقة = بلا طلاب
    return { sql: ` AND s.circle_id IN (${mine.map(() => "?").join(",")})`, binds: mine };
  }
  // طالب بلا حلقة لا ينتمي إلى مرحلة، فلا يراه مدير المرحلة (يبقى للإدارة).
  if (auth.role === "stage_manager") return stageCircleSql(c, "s.circle_id");
  if (auth.role === "student") return { sql: " AND s.user_id = ?", binds: [auth.userId] };
  return { sql: "", binds: [] };
}

/** شرط SQL يحصر الكادر في معلّمي حلقات مراحل مدير المرحلة (§15.3 — حضور المعلمين). */
export function stageTeacherScope(c: Context<AppEnv>, alias = "u"): { sql: string; binds: unknown[] } {
  const auth = c.get("auth");
  if (auth.role !== "stage_manager") return { sql: "", binds: [] };
  const stages = stagesOf(c);
  // يُستثنى هو نفسه: حضوره يسجّله مدير المركز أو السكرتير، لا هو (قرار المالك).
  return {
    sql: ` AND ${alias}.id <> ? AND ${alias}.id IN (SELECT ct.teacher_id FROM circle_teachers ct JOIN circles ci ON ci.id = ct.circle_id
             WHERE ci.center_id = ? AND ci.level_key IN (${stages.map(() => "?").join(",")}))`,
    binds: [auth.userId, auth.centerId, ...stages]
  };
}

/** شرط SQL يحصر الحلقات في مراحل مدير المرحلة (alias اسمه ci أو ما يُمرَّر). */
export function circleScope(c: Context<AppEnv>, alias = "c"): { sql: string; binds: unknown[] } {
  if (c.get("auth").role !== "stage_manager") return { sql: "", binds: [] };
  return stageCircleSql(c, `${alias}.id`);
}

import type { Context } from "hono";
import type { AppEnv } from "../env";
import { fail } from "./util";

export interface CourseRow {
  id: string;
  name: string;
  status: "active" | "ended";
  teacherId: string | null;
}

/**
 * الدورة بنطاق المستخدم. الدورات مستقلة عن الحلقات والمراحل، فالنطاق هو «شيخ الدورة»:
 * الإدارة والسكرتير يديرون كل الدورات، ولجنة الاختبارات تقرأ فقط، والمعلّم (ومدير المرحلة بصفته معلّماً)
 * يرى دوراته هو فقط. الخارج عن النطاق = 404.
 */
export async function accessibleCourse(c: Context<AppEnv>, id: string, write: boolean): Promise<CourseRow> {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare("SELECT id, name, status, teacher_id AS teacherId FROM ajkam_courses WHERE id = ? AND center_id = ?")
    .bind(id, auth.centerId)
    .first<CourseRow>();
  if (!row) fail(404, "الدورة غير موجودة");
  if (auth.role === "teacher" || auth.role === "stage_manager") {
    if (row.teacherId !== auth.userId) fail(404, "الدورة غير موجودة");
  } else if (write && auth.role !== "admin" && auth.role !== "secretary") {
    fail(403, "لا تملك صلاحية لهذا الإجراء");
  }
  return row;
}

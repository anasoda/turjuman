// انتقال الطلاب بين الحلقات: القاعدة النقية في shared/transfer-plan.ts، وهنا نسبة السجلات والتبديل الكسول.
import { todayHebron } from "./dates";

export { TRANSFER_ARRANGE_FROM_DAY, firstOfNextMonth, planTransfer, type TransferPlan } from "../../shared/transfer-plan";

/**
 * حلقة الطالب في التاريخ D (`alias` اسم جدول الطلاب في الاستعلام). التاريخ معامل ربط افتراضياً
 * أو تعبير SQL داخلي مثل تاريخ صف السجل عند حصر قائمة السجلات.
 * أول انتقال يسري بعد D يعطي حلقة ما قبله، وإلا فحلقته الحالية.
 */
export const circleOnSql = (alias: string, dateSql = "?"): string =>
  `COALESCE((SELECT t.from_circle_id FROM student_transfers t WHERE t.student_id = ${alias}.id AND t.effective_from > ${dateSql} ORDER BY t.effective_from ASC LIMIT 1), ${alias}.circle_id)`;

/** آخر يوم في الشهر `YYYY-MM` (لنسبة الكشف الشهري إلى حلقة الطالب في نهاية الشهر). */
export function lastDayOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const lastRun = new Map<string, number>();

/**
 * يُبدِّل حلقة الطلاب الذين حلّ موعد نقلهم. كسول: يُستدعى من `requireAuth` ولا يعمل أكثر من مرة في الدقيقة
 * لكل مركز في المثيل الواحد. لا يُفشل الطلب أبداً (إن لم تكن الهجرة مطبَّقة بعد يتجاهل الخطأ).
 */
export async function applyDueTransfers(db: D1Database, centerId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastRun.get(centerId) ?? 0) < 60_000) return;
  lastRun.set(centerId, now);
  try {
    const { results } = await db
      .prepare("SELECT id, student_id AS studentId, from_circle_id AS fromId, to_circle_id AS toId FROM student_transfers WHERE center_id = ? AND applied = 0 AND effective_from <= ? ORDER BY effective_from ASC")
      .bind(centerId, todayHebron())
      .all<{ id: string; studentId: string; fromId: string; toId: string }>();
    if (!results.length) return;
    await db.batch(
      results.flatMap((r) => [
        // لا يُبدَّل إن تغيّرت حلقته يدوياً بعد ترتيب النقل (الشرط على الحلقة القديمة)
        db.prepare("UPDATE students SET circle_id = ?, updated_at = ? WHERE id = ? AND center_id = ? AND circle_id = ?").bind(r.toId, now, r.studentId, centerId, r.fromId),
        db.prepare("UPDATE student_transfers SET applied = 1 WHERE id = ?").bind(r.id)
      ])
    );
  } catch (e) {
    console.warn("applyDueTransfers:", e instanceof Error ? e.message : e);
  }
}

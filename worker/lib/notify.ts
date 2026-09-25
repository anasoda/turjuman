import { newId } from "./crypto";

export interface NotifyInput {
  centerId: string;
  userId: string;
  kind: string;
  title: string;
  body?: string;
  link?: string;
}

/** إشعار داخل الموقع لمستخدم واحد. أي قناة خارجية (واتساب/رسائل) تُبنى لاحقاً فوق هذا الجدول. */
export function notifyStatement(db: D1Database, n: NotifyInput): D1PreparedStatement {
  return db
    .prepare("INSERT INTO notifications (id, center_id, user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), n.centerId, n.userId, n.kind, n.title, n.body ?? "", n.link ?? "", Date.now());
}

/** إشعار «best effort»: فشل الإشعار لا يُفشل العملية الأصلية. */
export async function notify(db: D1Database, n: NotifyInput | null): Promise<void> {
  if (!n) return;
  try {
    await notifyStatement(db, n).run();
  } catch (e) {
    console.error("notify failed", e);
  }
}

/** حساب الطالب (إن وُجد) لطالب معيّن. */
export async function studentUserId(db: D1Database, studentId: string): Promise<string | null> {
  const row = await db.prepare("SELECT user_id AS id FROM students WHERE id = ?").bind(studentId).first<{ id: string | null }>();
  return row?.id ?? null;
}

/**
 * كل من يجب أن يصله إشعار عن طالب: حسابه الخاص إن وُجد + حسابات أولياء أمره الفعّالة.
 * (قرار المالك: الحساب لولي الأمر، وحساب الطالب الخاص اختياري.)
 */
export async function studentRecipients(db: D1Database, studentId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id FROM students s JOIN guardians g ON g.id = s.guardian_id JOIN users u ON u.id = g.user_id
        WHERE s.id = ? AND u.active = 1`
    )
    .bind(studentId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** إشعارات «best effort» لعدة مستخدمين (تُقسَّم إلى دفعات؛ فشلها لا يُفشل العملية). */
export async function notifyMany(db: D1Database, userIds: string[], n: Omit<NotifyInput, "userId">): Promise<void> {
  if (!userIds.length) return;
  try {
    for (let i = 0; i < userIds.length; i += 50) {
      await db.batch(userIds.slice(i, i + 50).map((userId) => notifyStatement(db, { ...n, userId })));
    }
  } catch (e) {
    console.error("notify failed", e);
  }
}

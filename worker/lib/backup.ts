import type { Env } from "../env";

/** كل بيانات مركز واحد للنسخ الاحتياطي (بلا كلمات مرور ولا اشتراكات الجوال). مشتركة بين التصدير اليدوي والنسخ الدوري. */
export async function buildCenterExport(db: D1Database, centerId: string) {
  const q = async (sql: string) => (await db.prepare(sql).bind(centerId).all()).results;
  return {
    exportedAt: new Date().toISOString(),
    centerId,
    center: (await db.prepare("SELECT * FROM centers WHERE id = ?").bind(centerId).first()) ?? null,
    settings: await q("SELECT key, value_json AS value FROM center_settings WHERE center_id = ?"),
    // لا تُصدَّر كلمات المرور ولا تجزئتها أبداً
    users: await q("SELECT id, center_id, role, username, display_name, active, created_at, updated_at FROM users WHERE center_id = ?"),
    staffProfiles: await q("SELECT p.* FROM staff_profiles p JOIN users u ON u.id = p.user_id WHERE u.center_id = ?"),
    stageManagers: await q("SELECT * FROM stage_managers WHERE center_id = ?"),
    circles: await q("SELECT * FROM circles WHERE center_id = ?"),
    circleTeachers: await q("SELECT ct.* FROM circle_teachers ct JOIN circles c ON c.id = ct.circle_id WHERE c.center_id = ?"),
    students: await q("SELECT * FROM students WHERE center_id = ?"),
    guardians: await q("SELECT * FROM guardians WHERE center_id = ?"),
    dailyRecords: await q("SELECT * FROM daily_records WHERE center_id = ?"),
    sardRecords: await q("SELECT * FROM sard_records WHERE center_id = ?"),
    tests: await q("SELECT * FROM tests WHERE center_id = ?"),
    monthlyReports: await q("SELECT * FROM monthly_reports WHERE center_id = ?"),
    ajkamCourses: await q("SELECT * FROM ajkam_courses WHERE center_id = ?"),
    courseStudents: await q("SELECT cs.* FROM ajkam_course_students cs JOIN ajkam_courses ac ON ac.id = cs.course_id WHERE ac.center_id = ?"),
    notifications: await q("SELECT * FROM notifications WHERE center_id = ?"),
    announcements: await q("SELECT * FROM announcements WHERE center_id = ?"),
    absenceNotices: await q("SELECT * FROM absence_notices WHERE center_id = ?"),
    prayerTimes: await q("SELECT * FROM prayer_times WHERE center_id = ?"),
    staffAttendance: await q("SELECT * FROM staff_attendance WHERE center_id = ?"),
    schedule: await q("SELECT * FROM circle_schedule WHERE center_id = ?"),
    studentNotes: await q("SELECT * FROM student_notes WHERE center_id = ?"),
    studentMonthlyPlans: await q("SELECT * FROM student_monthly_plans WHERE center_id = ?"),
    studentTransfers: await q("SELECT * FROM student_transfers WHERE center_id = ?"),
    examSessions: await q("SELECT * FROM exam_sessions WHERE center_id = ?"),
    testQuestions: await q("SELECT tq.* FROM test_questions tq JOIN tests t ON t.id = tq.test_id WHERE t.center_id = ?"),
    ajkamSessions: await q("SELECT * FROM ajkam_sessions WHERE center_id = ?"),
    ajkamAttendance: await q("SELECT aa.* FROM ajkam_attendance aa JOIN ajkam_sessions s2 ON s2.id = aa.session_id WHERE s2.center_id = ?"),
    ajkamNotes: await q("SELECT * FROM ajkam_notes WHERE center_id = ?"),
    ajkamEvents: await q("SELECT * FROM ajkam_events WHERE center_id = ?"),
    sessionCancellations: await q("SELECT * FROM session_cancellations WHERE center_id = ?"),
    auditLog: await q("SELECT * FROM audit_log WHERE center_id = ?")
  };
}

/** عدد النسخ الدورية المحفوظة لكل مركز؛ الأقدم تُحذف بعد كل نسخة جديدة. */
export const BACKUP_KEEP = 4;
export const BACKUP_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{6}Z\.json\.gz$/;
export const backupPrefix = (centerId: string) => `backups/${centerId}/`;

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** يكتب نسخة المركز في R2 ثم يُبقي أحدث BACKUP_KEEP نسخ فقط. */
export async function backupCenter(env: Pick<Env, "DB" | "BACKUPS">, centerId: string): Promise<{ key: string; size: number; pruned: number }> {
  if (!env.BACKUPS) throw new Error("مخزن النسخ الاحتياطية (R2) غير مضبوط");
  const data = await buildCenterExport(env.DB, centerId);
  const body = await gzip(JSON.stringify(data));
  const iso = new Date().toISOString();
  const name = `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, "")}Z.json.gz`;
  const key = backupPrefix(centerId) + name;
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: "application/gzip" }, customMetadata: { centerId } });
  const listed = await env.BACKUPS.list({ prefix: backupPrefix(centerId) });
  const old = listed.objects.map((o) => o.key).filter((k) => BACKUP_NAME_RE.test(k.slice(backupPrefix(centerId).length))).sort().reverse().slice(BACKUP_KEEP);
  if (old.length) await env.BACKUPS.delete(old);
  return { key, size: body.byteLength, pruned: old.length };
}

/** الـ Cron: نسخة لكل مركز فعّال. فشل مركز لا يمنع الباقي. */
export async function runScheduledBackup(env: Pick<Env, "DB" | "BACKUPS">): Promise<void> {
  if (!env.BACKUPS) { console.error("backup skipped: BACKUPS binding missing"); return; }
  const { results } = await env.DB.prepare("SELECT id FROM centers WHERE status = 'active'").all<{ id: string }>();
  for (const center of results) {
    try { const r = await backupCenter(env, center.id); console.log("backup ok", center.id, r.key, r.size, "pruned", r.pruned); }
    catch (error) { console.error("backup failed", center.id, error); }
  }
}

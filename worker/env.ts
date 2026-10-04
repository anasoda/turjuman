import type { Role } from "../shared/constants";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** مخزن R2 للنسخ الاحتياطية الدورية؛ غائب = تُتخطّى النسخ الدورية دون أن يتأثر التطبيق */
  BACKUPS?: R2Bucket;
  /** سرّ توقيع الجلسات — يُضبط بـ wrangler secret ولا قيمة افتراضية له */
  JWT_SECRET: string;
  /** مفتاح مالك النظام لإنشاء المراكز — يُضبط بـ wrangler secret */
  ADMIN_BOOTSTRAP_KEY: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface AuthCtx {
  /** معرّف صف guardians للمستخدم إن كان ولي أمر (§15.7) — ليس userId */
  guardianId?: string;
  /** مفاتيح مراحل مدير المرحلة (§15.3) — غير فارغة فقط للدور stage_manager */
  stages?: string[];
  /** حلقات المستخدم نفسه من circle_teachers — مدير المرحلة قد يدرّس حلقة أيضاً (§15.3أ) */
  circleIds?: string[];
  userId: string;
  centerId: string;
  role: Role;
  displayName: string;
  /** من الجلسة: كلمة مرور ولي الأمر ما زالت الأولية (= اسم المستخدم)؛ undefined = جلسة قديمة لم تُفحص بعد */
  defaultPassword?: boolean;
}

export type AppEnv = { Bindings: Env; Variables: { auth: AuthCtx } };

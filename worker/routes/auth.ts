import { Hono } from "hono";
import { z } from "zod";
import { MIN_PASSWORD, type Role } from "../../shared/constants";
import type { AppEnv } from "../env";
import { clearSession, issueSession, loadAuth, rateLimit, requireAuth } from "../lib/auth";
import { createPasswordRecord, verifyPassword } from "../lib/crypto";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

export const authRoutes = new Hono<AppEnv>();

const loginSchema = z.object({
  centerId: z.string().min(1, "معرّف المركز مطلوب"),
  username: z.string().min(1, "أدخل اسم المستخدم").max(64),
  password: z.string().min(1, "أدخل كلمة المرور").max(200)
});

/** الدخول: بوابة واحدة لكل الأدوار؛ الدور يُعرف من الحساب. الرسائل تكشف موضع الخطأ (قرار المالك). */
authRoutes.post("/login", async (c) => {
  if (!c.env.JWT_SECRET) fail(400, "الخادم غير مهيّأ: JWT_SECRET غير مضبوط");
  const body = await parseBody(c, loginSchema);
  const limiter = await rateLimit(c, "login", `${body.centerId}:${body.username}`);
  if (limiter.blocked) {
    c.header("retry-after", String(limiter.retryAfterSeconds));
    fail(429, "محاولات كثيرة، انتظر 15 دقيقة ثم حاول مجدداً");
  }

  const center = await c.env.DB.prepare("SELECT id, status FROM centers WHERE id = ?").bind(body.centerId).first<{ id: string; status: string }>();
  if (!center || center.status !== "active") {
    await limiter.fail();
    fail(404, "المركز غير موجود أو غير مفعّل، تأكد من الرابط");
  }
  const user = await c.env.DB.prepare(
    `SELECT id, center_id, role, display_name, password_hash, password_salt, password_iterations, active, session_version
       FROM users WHERE center_id = ? AND username = ?`
  )
    .bind(body.centerId, body.username)
    .first<{
      id: string; center_id: string; role: Role; display_name: string;
      password_hash: string; password_salt: string; password_iterations: number; active: number; session_version: number;
    }>();
  if (!user) {
    await limiter.fail();
    fail(401, "اسم المستخدم غير موجود");
  }
  if (user.active !== 1) fail(403, "هذا الحساب موقوف، راجع إدارة المركز");
  const ok = await verifyPassword(body.password, { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iterations });
  if (!ok) {
    await limiter.fail();
    fail(401, "كلمة المرور غير صحيحة");
  }
  await limiter.clear();
  const expiresAt = await issueSession(c, user);
  return c.json({ ok: true, expiresAt, role: user.role, displayName: user.display_name });
});

authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

/** بيانات الجلسة الحالية + هوية المركز + الإعدادات (لبناء الواجهة). */
authRoutes.get("/me", async (c) => {
  const auth = await loadAuth(c);
  if (!auth) return c.json({ error: "غير مسجَّل" }, 401);
  const center = await c.env.DB.prepare("SELECT id, name, subtitle, logo, phone, whatsapp FROM centers WHERE id = ?")
    .bind(auth.centerId)
    .first();
  const account = await c.env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(auth.userId).first<{ username: string }>();
  let studentId: string | null = null;
  if (auth.role === "student") {
    const s = await c.env.DB.prepare("SELECT id FROM students WHERE user_id = ? AND center_id = ?").bind(auth.userId, auth.centerId).first<{ id: string }>();
    studentId = s?.id ?? null;
  }
  return c.json({
    user: { id: auth.userId, role: auth.role, displayName: auth.displayName, username: account?.username ?? "", studentId },
    center,
    settings: await loadSettings(c.env.DB, auth.centerId)
  });
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "أدخل كلمة المرور الحالية"),
  newPassword: z.string().min(MIN_PASSWORD, `كلمة المرور الجديدة ${MIN_PASSWORD} خانات على الأقل`).max(200)
});

/** كل شخص يغيّر كلمة مروره بمعرفة القديمة. ينهي جلسات الأجهزة الأخرى. */
authRoutes.post("/change-password", requireAuth(), async (c) => {
  const auth = c.get("auth");
  const body = await parseBody(c, changePasswordSchema);
  const user = await c.env.DB.prepare("SELECT id, center_id, role, password_hash, password_salt, password_iterations, session_version FROM users WHERE id = ?")
    .bind(auth.userId)
    .first<{ id: string; center_id: string; role: Role; password_hash: string; password_salt: string; password_iterations: number; session_version: number }>();
  if (!user) fail(404, "الحساب غير موجود");
  const ok = await verifyPassword(body.oldPassword, { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iterations });
  if (!ok) fail(401, "كلمة المرور الحالية غير صحيحة");
  const rec = await createPasswordRecord(body.newPassword);
  const nextVersion = user.session_version + 1;
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, session_version = ?, updated_at = ? WHERE id = ?")
    .bind(rec.hash, rec.salt, rec.iterations, nextVersion, Date.now(), user.id)
    .run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "change_password", entity: "user", entityId: user.id });
  const expiresAt = await issueSession(c, { ...user, session_version: nextVersion });
  return c.json({ ok: true, expiresAt });
});

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import type { Role } from "../../shared/constants";
import type { AppEnv, AuthCtx } from "../env";
import { sha256 } from "./crypto";

export const COOKIE = "tq_session";
export const TOKEN_TTL_SECONDS = 30 * 24 * 3600;

interface TokenPayload {
  sub: string;
  cid: string;
  role: Role;
  ver: number;
  exp: number;
  [key: string]: unknown;
}

export async function issueSession(c: Context<AppEnv>, user: { id: string; center_id: string; role: Role; session_version: number }) {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { sub: user.id, cid: user.center_id, role: user.role, ver: user.session_version, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const token = await sign(payload, c.env.JWT_SECRET, "HS256");
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS
  });
  return payload.exp * 1000;
}

export function clearSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** يقرأ الجلسة ويعيد التحقق منها من القاعدة في كل طلب: الحساب فعّال، المركز فعّال، إصدار الجلسة مطابق. */
export async function loadAuth(c: Context<AppEnv>): Promise<AuthCtx | null> {
  if (!c.env.JWT_SECRET) throw new HTTPException(503, { message: "JWT_SECRET غير مضبوط على الخادم" });
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  let payload: TokenPayload;
  try {
    payload = (await verify(token, c.env.JWT_SECRET, "HS256")) as TokenPayload;
  } catch {
    return null;
  }
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.center_id, u.role, u.display_name, u.active, u.session_version, ce.status AS center_status,
            (SELECT g.id FROM guardians g WHERE g.user_id = u.id) AS guardian_id,
            (SELECT group_concat(sm.level_key) FROM stage_managers sm WHERE sm.user_id = u.id) AS stages,
            (SELECT group_concat(ct.circle_id) FROM circle_teachers ct WHERE ct.teacher_id = u.id) AS circle_ids
       FROM users u JOIN centers ce ON ce.id = u.center_id
      WHERE u.id = ? AND u.center_id = ?`
  )
    .bind(payload.sub, payload.cid)
    .first<{ id: string; center_id: string; role: Role; display_name: string; active: number; session_version: number; center_status: string; guardian_id: string | null; stages: string | null; circle_ids: string | null }>();
  if (!row || row.active !== 1 || row.center_status !== "active" || row.session_version !== payload.ver) return null;
  // الأدوار المشتقّة: حساب ولي الأمر يُخزَّن بدور 'student' ومدير المرحلة بدور 'teacher'
  // (قيد CHECK على users.role في D1 لا يُوسَّع — انظر رأس migrations/0004 و0008).
  const stages = (row.stages ?? "").split(",").filter(Boolean);
  const circleIds = (row.circle_ids ?? "").split(",").filter(Boolean);
  // مدير المرحلة تعيينٌ فوق حساب المعلّم (قرار المالك): يبقى معلّماً لحلقته ويزيد عليها مراحله.
  const role: Role = row.guardian_id ? "guardian" : stages.length ? "stage_manager" : row.role;
  return {
    userId: row.id,
    centerId: row.center_id,
    role,
    displayName: row.display_name,
    guardianId: row.guardian_id ?? undefined,
    stages: stages.length ? stages : undefined,
    circleIds: circleIds.length ? circleIds : undefined
  };
}

/** حارس الصلاحيات: يمرّر فقط الأدوار المذكورة. بلا أدوار = أي مستخدم مسجَّل. */
export function requireAuth(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = await loadAuth(c);
    if (!auth) throw new HTTPException(401, { message: "الجلسة منتهية، سجّل الدخول من جديد" });
    if (roles.length && !roles.includes(auth.role)) throw new HTTPException(403, { message: "لا تملك صلاحية لهذا الإجراء" });
    c.set("auth", auth);
    await next();
  };
}

/** تحديد المعدّل: يحجب بعد عدد محاولات فاشلة ضمن نافذة زمنية. */
export async function rateLimit(c: Context<AppEnv>, scope: string, identity: string, limit = 8, windowMs = 15 * 60_000, blockMs = 15 * 60_000) {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const keyHash = await sha256(`${scope}:${ip}:${identity.toLowerCase()}`);
  const now = Date.now();
  const row = await c.env.DB.prepare("SELECT attempts, window_start, blocked_until FROM auth_rate_limits WHERE key_hash = ?")
    .bind(keyHash)
    .first<{ attempts: number; window_start: number; blocked_until: number }>();
  const blocked = !!row && row.blocked_until > now;
  return {
    blocked,
    retryAfterSeconds: blocked && row ? Math.ceil((row.blocked_until - now) / 1000) : 0,
    async fail() {
      const within = row && now - row.window_start < windowMs;
      const attempts = within && row ? row.attempts + 1 : 1;
      const windowStart = within && row ? row.window_start : now;
      const blockedUntil = attempts >= limit ? now + blockMs : 0;
      await c.env.DB.prepare(
        `INSERT INTO auth_rate_limits (key_hash, attempts, window_start, blocked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(key_hash) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start, blocked_until = excluded.blocked_until`
      )
        .bind(keyHash, attempts, windowStart, blockedUntil)
        .run();
    },
    async clear() {
      await c.env.DB.prepare("DELETE FROM auth_rate_limits WHERE key_hash = ?").bind(keyHash).run();
    }
  };
}

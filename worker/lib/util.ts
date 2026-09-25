import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z, ZodTypeAny } from "zod";
import type { AppEnv } from "../env";
import { DEFAULT_SETTINGS, type CenterSettings } from "../../shared/settings";

/** يقرأ جسم الطلب ويتحقق منه بـ zod؛ عند الخطأ يرمي 400 برسالة عربية. */
export async function parseBody<S extends ZodTypeAny>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  const raw = await c.req.json().catch(() => null);
  const res = schema.safeParse(raw);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue?.path.join(".") || "الطلب";
    throw new HTTPException(400, { message: issue?.message && /[؀-ۿ]/.test(issue.message) ? issue.message : `بيانات غير صالحة في الحقل: ${where}` });
  }
  return res.data;
}

export function fail(status: 400 | 401 | 403 | 404 | 409 | 429, message: string): never {
  throw new HTTPException(status, { message });
}

export async function loadSettings(db: D1Database, centerId: string): Promise<CenterSettings> {
  const { results } = await db.prepare("SELECT key, value_json FROM center_settings WHERE center_id = ?").bind(centerId).all<{ key: string; value_json: string }>();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of results) {
    try {
      if (r.key in DEFAULT_SETTINGS) merged[r.key] = JSON.parse(r.value_json);
    } catch {
      /* قيمة تالفة: نبقي الافتراضي */
    }
  }
  return merged as unknown as CenterSettings;
}

export async function audit(
  db: D1Database,
  a: { centerId: string; userId: string | null; action: string; entity: string; entityId?: string; details?: string }
) {
  await db
    .prepare("INSERT INTO audit_log (center_id, user_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(a.centerId, a.userId, a.action, a.entity, a.entityId ?? "", a.details ?? "", Date.now())
    .run();
}

export const bool = (v: unknown): boolean => v === 1 || v === true;

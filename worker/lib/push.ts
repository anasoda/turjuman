import type { Context } from "hono";
import type { AppEnv, Env } from "../env";

export interface PushMessage { title: string; body?: string; link?: string }
export interface PushResult { subscriptions: number; accepted: number; failed: number }
const encoder = new TextEncoder();
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const join = (...chunks: Uint8Array[]) => { const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0; for (const c of chunks) { out.set(c, offset); offset += c.length; } return out; };
const bytes = (s: string) => encoder.encode(s);
const hkdf = async (key: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) => {
  const hk = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, hk, length * 8));
};

/** Web Push aes128gcm (RFC 8291), VAPID (RFC 8292). */
async function send(endpoint: string, p256dh: string, authSecret: string, message: PushMessage, env: Env): Promise<Response> {
  const vapidPublic = decode(env.VAPID_PUBLIC_KEY!);
  const vapidPrivate = decode(env.VAPID_PRIVATE_KEY!);
  const signingKey = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", x: encode(vapidPublic.slice(1, 33)), y: encode(vapidPublic.slice(33)), d: encode(vapidPrivate)
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const destination = new URL(endpoint);
  const claims = { aud: destination.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT! };
  const jwtHead = encode(bytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const jwtBody = encode(bytes(JSON.stringify(claims)));
  const unsigned = `${jwtHead}.${jwtBody}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, bytes(unsigned)));
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const receiver = await crypto.subtle.importKey("raw", decode(p256dh), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiver } as never, ephemeral.privateKey, 256));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey) as ArrayBuffer);
  const ikm = await hkdf(shared, decode(authSecret), join(bytes("WebPush: info"), new Uint8Array([0]), decode(p256dh), senderPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(ikm, salt, bytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, bytes("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const payload = join(bytes(JSON.stringify(message)), new Uint8Array([2]));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, payload));
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  const body = join(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, encrypted);
  return fetch(endpoint, { method: "POST", headers: {
    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400",
    "Authorization": `vapid t=${unsigned}.${encode(signature)}, k=${env.VAPID_PUBLIC_KEY}`
  }, body });
}

export async function sendPush(db: D1Database, env: Env, centerId: string, userIds: string[], message: PushMessage): Promise<PushResult> {
  const result: PushResult = { subscriptions: 0, accepted: 0, failed: 0 };
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT || !userIds.length) return result;
  try {
  for (let i = 0; i < userIds.length; i += 40) {
    const ids = userIds.slice(i, i + 40);
    const subscriptions = await db.prepare(`SELECT id, endpoint, p256dh, auth_secret AS authSecret FROM push_subscriptions WHERE center_id = ? AND user_id IN (${ids.map(() => "?").join(",")})`)
      .bind(centerId, ...ids).all<{ id: string; endpoint: string; p256dh: string; authSecret: string }>();
    result.subscriptions += subscriptions.results.length;
    await Promise.all(subscriptions.results.map(async (s) => {
      try {
        const response = await send(s.endpoint, s.p256dh, s.authSecret, message, env);
        if (response.ok) result.accepted++;
        if (response.status === 404 || response.status === 410) await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(s.id).run();
        if (!response.ok) { result.failed++; console.error("push service rejected", response.status); }
      } catch (error) { result.failed++; console.error("push delivery failed", error); }
    }));
  }
  } catch (error) { result.failed++; console.error("push delivery failed", error); }
  return result;
}

/**
 * يُرسل التنبيه بعد إرجاع الرد (waitUntil) كي لا يبطّئ الطلب مع كثرة المشتركين؛ sendPush لا يرمي أخطاء أصلاً.
 * بلا executionCtx (اختبارات الوحدة) يُنتظر مباشرة. الإشعار داخل الموقع يبقى متزامناً في المسارات نفسها.
 */
export async function pushInBackground(c: Context<AppEnv>, centerId: string, userIds: string[], message: PushMessage): Promise<void> {
  const job = sendPush(c.env.DB, c.env, centerId, userIds, message).then(() => undefined);
  let ctx: Context<AppEnv>["executionCtx"] | undefined;
  try { ctx = c.executionCtx; } catch { ctx = undefined; }
  if (ctx) ctx.waitUntil(job); else await job;
}

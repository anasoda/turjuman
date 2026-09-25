// أدوات التشفير: تجزئة كلمات المرور (PBKDF2) والمقارنة الزمنية الثابتة.
// كلمات المرور لا تُخزَّن ولا تُسجَّل ولا تُعاد في أي رد — تُعيَّن من جديد فقط.

export const PBKDF2_ITERATIONS = 100_000;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

export interface PasswordRecord {
  hash: string;
  salt: string;
  iterations: number;
}

export async function createPasswordRecord(password: string): Promise<PasswordRecord> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(password, saltBytes, PBKDF2_ITERATIONS), salt: bytesToBase64Url(saltBytes), iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, rec: PasswordRecord): Promise<boolean> {
  const computed = await derive(password, base64UrlToBytes(rec.salt), rec.iterations);
  return timingSafeEqual(computed, rec.hash);
}

export const newId = (): string => crypto.randomUUID();

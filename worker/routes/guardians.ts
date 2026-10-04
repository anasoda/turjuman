import { Hono, type Context } from "hono";
import { z } from "zod";
import { MIN_PASSWORD, NATIONAL_ID_RE, PHONE_RE, USERNAME_RE, WA_PREFIXES } from "../../shared/constants";
import { completedJuz } from "../../shared/quran";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { createPasswordRecord, newId } from "../lib/crypto";
import { audit, fail, parseBody } from "../lib/util";

/**
 * أولياء الأمور (§15.7 و§15.8، 2026-09-25):
 * ولي الأمر **كيان مستقل** له `guardians.id`؛ بياناته (الاسم، الصفة، رقم الاتصال، واتساب) إجبارية مع كل طالب،
 * و**حسابه اختياري** يُنشأ لاحقاً باسم مستخدم = رقم هويته وكلمة مرور أولية = رقم هويته.
 * العلاقة 1:M — `students.guardian_id` يشير إلى `guardians.id`.
 * الحساب يُخزَّن في users بدور 'student' (قيد D1 CHECK لا يُوسَّع)، والدور الفعلي يُشتق في loadAuth.
 */
export const guardianRoutes = new Hono<AppEnv>();

const MANAGERS = ["admin", "secretary"] as const;

/** بيانات ولي الأمر نفسها — إجبارية (§15.7). */
export const guardianFields = {
  name: z.string().trim().min(3, "اسم ولي الأمر 3 أحرف على الأقل").max(100),
  callPhone: z.string().regex(PHONE_RE, "الرقم يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 أرقام"),
  waCc: z.enum(WA_PREFIXES, { errorMap: () => ({ message: "المقدمة المسموحة 970 أو 972 فقط" }) }).default("970"),
  waNational: z.string().regex(PHONE_RE, "الرقم يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 أرقام").default(""),
  nationalId: z.string().trim().max(20).default("")
};

const createSchema = z.object({
  ...guardianFields,
  /** الحساب اختياري؛ إن طُلب فاسم المستخدم = رقم الهوية وكلمة المرور الأولية = رقم الهوية (§15.8) */
  withAccount: z.boolean().default(false),
  password: z.string().max(200).default(""),
  studentIds: z.array(z.string().min(1)).max(40).default([])
});
const updateSchema = z.object(guardianFields).partial();
const childrenSchema = z.object({ studentIds: z.array(z.string().min(1)).max(40) });
const passwordSchema = z.object({ password: z.string().min(MIN_PASSWORD, `كلمة المرور ${MIN_PASSWORD} خانات على الأقل`).max(200) });
const activeSchema = z.object({ active: z.boolean() });

const SELECT_GUARDIANS = `
  SELECT g.id, g.user_id AS userId, g.name, g.national_id AS nationalId,
         g.call_phone AS callPhone, g.wa_cc AS waCc, g.wa_national AS waNational,
         u.username, u.active
    FROM guardians g LEFT JOIN users u ON u.id = g.user_id`;

interface GuardianRow {
  id: string; userId: string | null; name: string; nationalId: string | null;
  callPhone: string; waCc: string; waNational: string; username: string | null; active: number | null;
}

const shape = (g: GuardianRow) => ({ ...g, hasAccount: !!g.userId, active: g.active === 1 });

async function checkStudents(db: D1Database, centerId: string, ids: string[]): Promise<string[]> {
  const clean = [...new Set(ids)];
  if (!clean.length) return [];
  for (let i = 0; i < clean.length; i += 40) {
    const part = clean.slice(i, i + 40);
    const { results } = await db
      .prepare(`SELECT id FROM students WHERE center_id = ? AND id IN (${part.map(() => "?").join(",")})`)
      .bind(centerId, ...part)
      .all<{ id: string }>();
    if (results.length !== part.length) fail(400, "أحد الطلاب المختارين غير موجود في المركز");
  }
  return clean;
}

interface ChildRow { guardianId: string; id: string; name: string; direction: string; lastSurah: number; lastAyah: number; archivedAt: number | null; circleName: string | null }

/** أبناء ولي أمر (أو عدة أولياء) كصفوف مسطّحة. D1 يقبل 100 معامل ربط كحد أقصى، فتُقسَّم القائمة. */
export async function childrenOf(db: D1Database, centerId: string, guardianIds: string[]): Promise<ChildRow[]> {
  const rows: ChildRow[] = [];
  for (let i = 0; i < guardianIds.length; i += 80) {
    const part = guardianIds.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `SELECT s.guardian_id AS guardianId, s.id, s.name, s.direction, s.last_surah AS lastSurah, s.last_ayah AS lastAyah,
                s.archived_at AS archivedAt, ci.name AS circleName
           FROM students s
           LEFT JOIN circles ci ON ci.id = s.circle_id
          WHERE s.guardian_id IN (${part.map(() => "?").join(",")}) AND s.center_id = ? ORDER BY s.name`
      )
      .bind(...part, centerId)
      .all<ChildRow>();
    rows.push(...results);
  }
  return rows;
}

/**
 * يجد ولي أمر موجوداً أو ينشئ واحداً جديداً — تُستعمل من مسار إنشاء الطالب والاستيراد.
 * المطابقة: رقم الهوية أولاً (فريد)، ثم رقم الواتساب (مقدمة + وطني) — هكذا يُكتشف الإخوة (§15.8).
 */
export async function findOrCreateGuardian(
  db: D1Database,
  centerId: string,
  g: { name: string; callPhone: string; waCc: string; waNational: string; nationalId: string },
  now: number
): Promise<{ id: string; created: boolean }> {
  if (g.nationalId) {
    const byNid = await db.prepare("SELECT id FROM guardians WHERE center_id = ? AND national_id = ?").bind(centerId, g.nationalId).first<{ id: string }>();
    if (byNid) return { id: byNid.id, created: false };
  }
  if (g.waNational) {
    const byWa = await db.prepare("SELECT id FROM guardians WHERE center_id = ? AND wa_cc = ? AND wa_national = ?")
      .bind(centerId, g.waCc || "970", g.waNational).first<{ id: string }>();
    if (byWa) return { id: byWa.id, created: false };
  }
  const id = newId();
  await db.prepare(
    `INSERT INTO guardians (id, center_id, user_id, name, national_id, call_phone, wa_cc, wa_national, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, centerId, g.name, g.nationalId || null, g.callPhone, g.waCc || "970", g.waNational, now, now).run();
  return { id, created: true };
}

/* ============================ للكادر الإداري ============================ */

guardianRoutes.get("/", requireAuth("admin", "secretary", "teacher"), async (c) => {
  const auth = c.get("auth");
  const q = (new URL(c.req.url).searchParams.get("q") || "").trim();
  const teacherScope = auth.role === "teacher" ? "AND EXISTS (SELECT 1 FROM students sx JOIN circle_teachers ctx ON ctx.circle_id = sx.circle_id WHERE sx.guardian_id = g.id AND sx.archived_at IS NULL AND ctx.teacher_id = ?)" : "";
  const where = `${q ? "AND (g.name LIKE ? OR g.wa_national LIKE ? OR g.call_phone LIKE ? OR g.national_id LIKE ?)" : ""}${teacherScope}`;
  const binds = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];
  if (auth.role === "teacher") binds.push(auth.userId);
  const { results } = await c.env.DB.prepare(`${SELECT_GUARDIANS} WHERE g.center_id = ? ${where} ORDER BY g.name LIMIT 300`)
    .bind(auth.centerId, ...binds)
    .all<GuardianRow>();
  const kids = await childrenOf(c.env.DB, auth.centerId, results.map((g) => g.id));
  return c.json({
    guardians: results.map((g) => ({
      ...shape(g),
      children: kids.filter((k) => k.guardianId === g.id).map((k) => ({ id: k.id, name: k.name, circleName: k.circleName, archived: !!k.archivedAt }))
    }))
  });
});

/** طلاب بلا ولي أمر مسجَّل (لا ينبغي أن يوجدوا بعد §15.7 لكن تبقى للبيانات القديمة). */
guardianRoutes.get("/orphans", requireAuth(...MANAGERS), async (c) => {
  const auth = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name FROM students s
      WHERE s.center_id = ? AND s.archived_at IS NULL AND s.guardian_id IS NULL
      ORDER BY s.name LIMIT 500`
  )
    .bind(auth.centerId)
    .all<{ id: string; name: string }>();
  return c.json({ students: results });
});

guardianRoutes.post("/", requireAuth(...MANAGERS), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, createSchema);
  if (b.nationalId) {
    const dupNid = await c.env.DB.prepare("SELECT id FROM guardians WHERE center_id = ? AND national_id = ?").bind(auth.centerId, b.nationalId).first();
    if (dupNid) fail(409, "رقم هوية ولي الأمر مسجَّل مسبقاً");
  }
  const students = await checkStudents(c.env.DB, auth.centerId, b.studentIds);
  const now = Date.now();
  const id = newId();
  const stmts: D1PreparedStatement[] = [];
  let userId: string | null = null;

  if (b.withAccount) {
    // اسم المستخدم = رقم الهوية، وكلمة المرور الأولية = رقم الهوية إن لم تُقدَّم (§15.8)
    if (!NATIONAL_ID_RE.test(b.nationalId)) fail(400, "رقم هوية ولي الأمر (9 أرقام) مطلوب لإنشاء الحساب");
    const username = b.nationalId;
    if (!USERNAME_RE.test(username)) fail(400, "رقم الهوية لا يصلح اسم مستخدم");
    const dupUser = await c.env.DB.prepare("SELECT id FROM users WHERE center_id = ? AND username = ?").bind(auth.centerId, username).first();
    if (dupUser) fail(409, "يوجد حساب بهذا الرقم مسبقاً");
    const password = b.password || b.nationalId;
    if (password.length < MIN_PASSWORD) fail(400, `كلمة المرور ${MIN_PASSWORD} خانات على الأقل`);
    userId = newId();
    const rec = await createPasswordRecord(password);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO users (id, center_id, role, username, display_name, password_hash, password_salt, password_iterations, active, session_version, created_at, updated_at)
         VALUES (?, ?, 'student', ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      ).bind(userId, auth.centerId, username, b.name, rec.hash, rec.salt, rec.iterations, now, now)
    );
  }

  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO guardians (id, center_id, user_id, name, national_id, call_phone, wa_cc, wa_national, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, auth.centerId, userId, b.name, b.nationalId || null, b.callPhone, b.waCc || "970", b.waNational, now, now),
    ...students.map((sid) => c.env.DB.prepare("UPDATE students SET guardian_id = ?, updated_at = ? WHERE id = ? AND center_id = ?").bind(id, now, sid, auth.centerId))
  );
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "guardian", entityId: id, details: `${b.name} — ${students.length} ابناً` });
  return c.json({ ok: true, id, userId }, 201);
});

/** أبناء ولي الأمر المسجَّل نفسه (بوابة ولي الأمر). يُسجَّل قبل /:id حتى لا يلتقطه. */
guardianRoutes.get("/children", requireAuth("guardian"), async (c) => {
  const auth = c.get("auth");
  const kids = await childrenOf(c.env.DB, auth.centerId, [auth.guardianId ?? ""]);
  return c.json({
    children: kids
      .filter((k) => !k.archivedAt)
      .map((k) => ({ id: k.id, name: k.name, circleName: k.circleName, memorizedParts: completedJuz(k.direction as "descending" | "ascending", { surah: k.lastSurah, ayah: k.lastAyah }) }))
  });
});

async function loadGuardian(c: Context<AppEnv>, id: string) {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare(`${SELECT_GUARDIANS} WHERE g.id = ? AND g.center_id = ?`).bind(id, auth.centerId).first<GuardianRow>();
  if (!row) fail(404, "ولي الأمر غير موجود");
  return row;
}

guardianRoutes.patch("/:id", requireAuth("admin", "secretary", "teacher"), async (c) => {
  const auth = c.get("auth");
  const g = await loadGuardian(c, c.req.param("id"));
  if (auth.role === "teacher") {
    const own = await c.env.DB.prepare("SELECT 1 FROM students s JOIN circle_teachers ct ON ct.circle_id = s.circle_id WHERE s.guardian_id = ? AND s.center_id = ? AND s.archived_at IS NULL AND ct.teacher_id = ? LIMIT 1")
      .bind(g.id, auth.centerId, auth.userId).first();
    if (!own) fail(404, "ولي الأمر غير موجود");
  }
  const b = await parseBody(c, updateSchema);
  if (b.nationalId) {
    const dupNid = await c.env.DB.prepare("SELECT id FROM guardians WHERE center_id = ? AND national_id = ? AND id <> ?").bind(auth.centerId, b.nationalId, g.id).first();
    if (dupNid) fail(409, "رقم هوية ولي الأمر مسجَّل مسبقاً");
  }
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE guardians SET name = COALESCE(?, name), national_id = COALESCE(?, national_id),
                            call_phone = COALESCE(?, call_phone), wa_cc = COALESCE(?, wa_cc), wa_national = COALESCE(?, wa_national), updated_at = ?
        WHERE id = ?`
    ).bind(b.name ?? null, b.nationalId ?? null, b.callPhone ?? null, b.waCc ?? null, b.waNational ?? null, now, g.id),
    // الاسم المعروض على الحساب يتبع اسم ولي الأمر
    ...(b.name && g.userId ? [c.env.DB.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").bind(b.name, now, g.userId)] : [])
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "guardian", entityId: g.id });
  return c.json({ ok: true });
});

/** إنشاء حساب دخول لولي أمر موجود بلا حساب: اسم المستخدم وكلمة المرور الأولية = رقم هويته (§15.8). */
guardianRoutes.post("/:id/account", requireAuth(...MANAGERS), async (c) => {
  const auth = c.get("auth");
  const g = await loadGuardian(c, c.req.param("id"));
  if (g.userId) fail(400, "لهذا الولي حساب بالفعل");
  if (!g.nationalId || !NATIONAL_ID_RE.test(g.nationalId)) fail(400, "أضف رقم هوية ولي الأمر (9 أرقام) أولاً — فهو اسم المستخدم");
  const dupUser = await c.env.DB.prepare("SELECT id FROM users WHERE center_id = ? AND username = ?").bind(auth.centerId, g.nationalId).first();
  if (dupUser) fail(409, "يوجد حساب بهذا الرقم مسبقاً");
  const { password } = await parseBody(c, z.object({ password: z.string().max(200).default("") }));
  const pw = password || g.nationalId;
  if (pw.length < MIN_PASSWORD) fail(400, `كلمة المرور ${MIN_PASSWORD} خانات على الأقل`);
  const userId = newId();
  const now = Date.now();
  const rec = await createPasswordRecord(pw);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, center_id, role, username, display_name, password_hash, password_salt, password_iterations, active, session_version, created_at, updated_at)
       VALUES (?, ?, 'student', ?, ?, ?, ?, ?, 1, 1, ?, ?)`
    ).bind(userId, auth.centerId, g.nationalId, g.name, rec.hash, rec.salt, rec.iterations, now, now),
    c.env.DB.prepare("UPDATE guardians SET user_id = ?, updated_at = ? WHERE id = ?").bind(userId, now, g.id)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "guardian_account", entityId: g.id, details: g.name });
  return c.json({ ok: true, userId, username: g.nationalId }, 201);
});

/** تحديد أبناء ولي الأمر (استبدال القائمة كاملة). */
guardianRoutes.put("/:id/children", requireAuth(...MANAGERS), async (c) => {
  const auth = c.get("auth");
  const g = await loadGuardian(c, c.req.param("id"));
  const { studentIds } = await parseBody(c, childrenSchema);
  const clean = await checkStudents(c.env.DB, auth.centerId, studentIds);
  // بيانات ولي الأمر إجبارية لكل طالب (§14.1): لا يُترك طالب بلا ولي. النقل يتم بإضافته إلى ولي آخر.
  const { results: current } = await c.env.DB.prepare("SELECT id, name FROM students WHERE guardian_id = ? AND center_id = ?").bind(g.id, auth.centerId).all<{ id: string; name: string }>();
  const orphaned = current.filter((s) => !clean.includes(s.id));
  if (orphaned.length) fail(400, `لا يمكن إزالة ${orphaned.map((s) => s.name).slice(0, 3).join("، ")} من هذا الولي دون نقله إلى ولي أمر آخر`);
  const now = Date.now();
  await c.env.DB.batch([
    ...clean.map((id) => c.env.DB.prepare("UPDATE students SET guardian_id = ?, updated_at = ? WHERE id = ? AND center_id = ?").bind(g.id, now, id, auth.centerId))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "guardian_children", entityId: g.id, details: `${clean.length}` });
  return c.json({ ok: true, count: clean.length });
});

guardianRoutes.post("/:id/password", requireAuth(...MANAGERS), async (c) => {
  const auth = c.get("auth");
  const g = await loadGuardian(c, c.req.param("id"));
  if (!g.userId) fail(400, "لا حساب لهذا الولي بعد");
  const { password } = await parseBody(c, passwordSchema);
  const rec = await createPasswordRecord(password);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?")
    .bind(rec.hash, rec.salt, rec.iterations, Date.now(), g.userId)
    .run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "reset_password", entity: "guardian", entityId: g.id });
  return c.json({ ok: true });
});

guardianRoutes.post("/:id/active", requireAuth(...MANAGERS), async (c) => {
  const auth = c.get("auth");
  const g = await loadGuardian(c, c.req.param("id"));
  if (!g.userId) fail(400, "لا حساب لهذا الولي بعد");
  const { active } = await parseBody(c, activeSchema);
  await c.env.DB.prepare("UPDATE users SET active = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, Date.now(), g.userId)
    .run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: active ? "activate" : "deactivate", entity: "guardian", entityId: g.id });
  return c.json({ ok: true });
});

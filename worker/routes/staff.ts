import { Hono } from "hono";
import { z } from "zod";
import { AJKAM_COURSES, MIN_PASSWORD, NATIONAL_ID_RE, PHONE_RE, QUALIFICATIONS, STAFF_ROLES, STORED_ROLE, USERNAME_RE, type Role } from "../../shared/constants";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { createPasswordRecord, newId } from "../lib/crypto";
import { audit, fail, loadSettings, parseBody } from "../lib/util";

export const staffRoutes = new Hono<AppEnv>();

/** من يستطيع إدارة أي دور: المدير كل أدوار الكادر، والسكرتير المعلّمين واللجنة فقط (لا مديري المراحل). */
function canManage(actor: Role, target: Role): boolean {
  if (actor === "admin") return (STAFF_ROLES as readonly string[]).includes(target);
  if (actor === "secretary") return target === "teacher" || target === "exam_committee";
  return false;
}

/** مفاتيح مراحل مدير المرحلة (§15.3) — تُفحص مقابل مراحل المركز في الإعدادات. */
async function checkStages(c: import("hono").Context<AppEnv>, stages: string[]) {
  if (!stages.length) fail(400, "اختر مرحلة واحدة على الأقل لمدير المرحلة");
  const settings = await loadSettings(c.env.DB, c.get("auth").centerId);
  const known = new Set(settings.levels.map((l) => l.key));
  const bad = stages.filter((s) => !known.has(s));
  if (bad.length) fail(400, "مرحلة غير معروفة في إعدادات المركز");
}

/** يستبدل مراحل مدير المرحلة بالقائمة المعطاة (حذف ثم إدراج داخل batch واحد). */
function stageStatements(db: D1Database, userId: string, centerId: string, stages: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM stage_managers WHERE user_id = ?").bind(userId),
    ...stages.map((key) => db.prepare("INSERT INTO stage_managers (user_id, center_id, level_key) VALUES (?, ?, ?)").bind(userId, centerId, key))
  ];
}

const minAge = (birth: string, years: number) => (Date.now() - new Date(birth).getTime()) / 31_557_600_000 >= years;

const profileFields = {
  nationalId: z.string().regex(NATIONAL_ID_RE, "رقم الهوية 9 أرقام"),
  phone: z.string().regex(PHONE_RE, "رقم الجوال يبدأ بـ 059 أو 056 ويتكوّن من 10 أرقام"),
  /** رقم الواتساب المستقل بمقدمة دولته (§15.2) — فارغ يعني «استعمل رقم الاتصال». */
  waCc: z.string().trim().max(4).default("970"),
  waNational: z.string().trim().max(20).default(""),
  birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ الميلاد غير صالح"),
  gender: z.enum(["male", "female"]),
  email: z.string().email("البريد الإلكتروني غير صالح").or(z.literal("")).default(""),
  address: z.string().max(200).default(""),
  qualification: z.enum(QUALIFICATIONS),
  ajkamCourse: z.enum(AJKAM_COURSES),
  memorizedParts: z.number().int().min(0).max(30)
};

const createSchema = z.object({
  role: z.enum(STAFF_ROLES),
  /** مراحل مدير المرحلة (§15.3) — إلزامية له، ومتجاهَلة لغيره */
  stages: z.array(z.string().min(1)).max(20).default([]),
  username: z.string().regex(USERNAME_RE, "اسم المستخدم من 3 إلى 64 خانة بلا فراغات"),
  password: z.string().min(MIN_PASSWORD, `كلمة المرور ${MIN_PASSWORD} خانات على الأقل`).max(200),
  displayName: z.string().trim().min(8, "الاسم الرباعي 8 أحرف على الأقل").max(100),
  ...profileFields
});

const updateSchema = z
  .object({
    displayName: z.string().trim().min(8, "الاسم الرباعي 8 أحرف على الأقل").max(100),
    active: z.boolean(),
    stages: z.array(z.string().min(1)).max(20),
    ...profileFields
  })
  .partial();

const passwordSchema = z.object({ password: z.string().min(MIN_PASSWORD, `كلمة المرور ${MIN_PASSWORD} خانات على الأقل`).max(200) });

const SELECT_STAFF = `
  SELECT u.id, u.role, u.username, u.display_name AS displayName, u.active,
         p.national_id AS nationalId, p.phone, p.wa_cc AS waCc, p.wa_national AS waNational, p.birth, p.gender, p.email, p.address,
         p.qualification, p.ajkam_course AS ajkamCourse, p.memorized_parts AS memorizedParts,
         (SELECT group_concat(ci.id) FROM circle_teachers ct JOIN circles ci ON ci.id = ct.circle_id WHERE ct.teacher_id = u.id) AS circleIds,
         (SELECT group_concat(ci.name) FROM circle_teachers ct JOIN circles ci ON ci.id = ct.circle_id WHERE ct.teacher_id = u.id) AS circleNames,
         (SELECT group_concat(ct.kind) FROM circle_teachers ct JOIN circles ci ON ci.id = ct.circle_id WHERE ct.teacher_id = u.id) AS circleKinds,
         (SELECT group_concat(sm.level_key) FROM stage_managers sm WHERE sm.user_id = u.id) AS stageKeys
    FROM users u
    LEFT JOIN staff_profiles p ON p.user_id = u.id`;

staffRoutes.get("/", requireAuth("admin", "secretary"), async (c) => {
  const { centerId } = c.get("auth");
  const { results } = await c.env.DB.prepare(`${SELECT_STAFF} WHERE u.center_id = ? AND u.role IN ('secretary','teacher','exam_committee') ORDER BY u.role, u.display_name`)
    .bind(centerId)
    .all();
  // الدور الفعلي: مدير المرحلة مخزَّن بدور 'teacher' (§15.3). والحلقات قد تكون أكثر من واحدة (0009).
  return c.json({
    staff: results.map((r) => {
      const row = r as { stageKeys: string | null; circleIds: string | null; circleNames: string | null; circleKinds: string | null };
      const stages = String(row.stageKeys ?? "").split(",").filter(Boolean);
      const ids = String(row.circleIds ?? "").split(",").filter(Boolean);
      const names = String(row.circleNames ?? "").split(",");
      const kinds = String(row.circleKinds ?? "").split(",");
      return {
        ...r,
        active: r.active === 1,
        stages,
        role: stages.length ? "stage_manager" : r.role,
        circles: ids.map((id, i) => ({ id, name: names[i] ?? "", kind: (kinds[i] ?? "primary") as "primary" | "assistant" }))
      };
    })
  });
});

staffRoutes.post("/", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, createSchema);
  if (!canManage(auth.role, b.role)) fail(403, "لا تملك صلاحية إنشاء هذا النوع من الحسابات");
  if (b.role === "stage_manager") await checkStages(c, b.stages);
  if (!minAge(b.birth, b.role === "secretary" ? 16 : 18)) fail(400, b.role === "secretary" ? "يجب ألا يقل عمر السكرتير عن 16 عاماً" : "يجب ألا يقل العمر عن 18 عاماً");
  const dupUser = await c.env.DB.prepare("SELECT id FROM users WHERE center_id = ? AND username = ?").bind(auth.centerId, b.username).first();
  if (dupUser) fail(409, "اسم المستخدم مستخدم مسبقاً في هذا المركز");
  const dupNid = await c.env.DB.prepare("SELECT user_id FROM staff_profiles p JOIN users u ON u.id = p.user_id WHERE u.center_id = ? AND p.national_id = ?")
    .bind(auth.centerId, b.nationalId)
    .first();
  if (dupNid) fail(409, "رقم الهوية مسجّل لشخص آخر من الكادر");

  const id = newId();
  const now = Date.now();
  const rec = await createPasswordRecord(b.password);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, center_id, role, username, display_name, password_hash, password_salt, password_iterations, active, session_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
    ).bind(id, auth.centerId, STORED_ROLE[b.role], b.username, b.displayName, rec.hash, rec.salt, rec.iterations, now, now),
    c.env.DB.prepare(
      `INSERT INTO staff_profiles (user_id, national_id, phone, wa_cc, wa_national, birth, gender, email, address, qualification, ajkam_course, memorized_parts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, b.nationalId, b.phone, b.waCc || "970", b.waNational, b.birth, b.gender, b.email, b.address, b.qualification, b.ajkamCourse, b.memorizedParts),
    ...(b.role === "stage_manager" ? stageStatements(c.env.DB, id, auth.centerId, b.stages) : [])
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "staff", entityId: id, details: `${b.role}: ${b.displayName}` });
  return c.json({ ok: true, id }, 201);
});

async function loadTarget(c: import("hono").Context<AppEnv>, id: string) {
  const auth = c.get("auth");
  const target = await c.env.DB.prepare(
    `SELECT u.id, u.role, u.display_name, u.session_version,
            (SELECT group_concat(sm.level_key) FROM stage_managers sm WHERE sm.user_id = u.id) AS stages
       FROM users u WHERE u.id = ? AND u.center_id = ?`
  )
    .bind(id, auth.centerId)
    .first<{ id: string; role: Role; display_name: string; session_version: number; stages: string | null }>();
  // الدور الفعلي قبل فحص الصلاحية: مدير المرحلة مخزَّن 'teacher' فلا يجوز أن يديره السكرتير
  const role: Role = target?.stages ? "stage_manager" : (target?.role as Role);
  if (!target || !canManage(auth.role, role)) fail(404, "الحساب غير موجود");
  return { ...target, role };
}

staffRoutes.patch("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const target = await loadTarget(c, c.req.param("id"));
  const b = await parseBody(c, updateSchema);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  if (b.displayName !== undefined || b.active !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE users SET display_name = COALESCE(?, display_name), active = COALESCE(?, active),
                session_version = session_version + ?, updated_at = ? WHERE id = ?`
      ).bind(b.displayName ?? null, b.active === undefined ? null : b.active ? 1 : 0, b.active === false ? 1 : 0, now, target.id)
    );
  }
  const p = b;
  if (p.nationalId !== undefined || p.phone !== undefined || p.waCc !== undefined || p.waNational !== undefined || p.birth !== undefined || p.gender !== undefined || p.email !== undefined || p.address !== undefined || p.qualification !== undefined || p.ajkamCourse !== undefined || p.memorizedParts !== undefined) {
    if (p.nationalId) {
      const dup = await c.env.DB.prepare("SELECT p.user_id FROM staff_profiles p JOIN users u ON u.id = p.user_id WHERE u.center_id = ? AND p.national_id = ? AND p.user_id <> ?")
        .bind(auth.centerId, p.nationalId, target.id)
        .first();
      if (dup) fail(409, "رقم الهوية مسجّل لشخص آخر من الكادر");
    }
    stmts.push(
      c.env.DB.prepare(
        `UPDATE staff_profiles SET national_id = COALESCE(?, national_id), phone = COALESCE(?, phone),
                wa_cc = COALESCE(?, wa_cc), wa_national = COALESCE(?, wa_national), birth = COALESCE(?, birth),
                gender = COALESCE(?, gender), email = COALESCE(?, email), address = COALESCE(?, address),
                qualification = COALESCE(?, qualification), ajkam_course = COALESCE(?, ajkam_course), memorized_parts = COALESCE(?, memorized_parts)
          WHERE user_id = ?`
      ).bind(p.nationalId ?? null, p.phone ?? null, p.waCc ?? null, p.waNational ?? null, p.birth ?? null, p.gender ?? null, p.email ?? null, p.address ?? null, p.qualification ?? null, p.ajkamCourse ?? null, p.memorizedParts ?? null, target.id)
    );
  }
  if (b.stages !== undefined) {
    if (target.role !== "stage_manager") fail(400, "المراحل تُسنَد لمديري المراحل فقط");
    await checkStages(c, b.stages);
    // تغيير المراحل يغيّر نطاق الجلسة، فتُنهى الجلسات القائمة ليُعاد اشتقاق الدور
    stmts.push(...stageStatements(c.env.DB, target.id, auth.centerId, b.stages));
    stmts.push(c.env.DB.prepare("UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?").bind(now, target.id));
  }
  if (!stmts.length) fail(400, "لا توجد تعديلات");
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "staff", entityId: target.id, details: Object.keys(b).join(",") });
  return c.json({ ok: true });
});

/** المدير (والسكرتير لمن يديرهم) يعيّن كلمة مرور جديدة — لا أحد يرى القديمة. */
staffRoutes.post("/:id/password", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const target = await loadTarget(c, c.req.param("id"));
  const { password } = await parseBody(c, passwordSchema);
  const rec = await createPasswordRecord(password);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?")
    .bind(rec.hash, rec.salt, rec.iterations, Date.now(), target.id)
    .run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "reset_password", entity: "staff", entityId: target.id });
  return c.json({ ok: true });
});

import { Hono, type Context } from "hono";
import { z } from "zod";
import { AJKAM_COURSES, GUARDIAN_RELATIONS, NATIONAL_ID_RE, PHONE_RE, WA_PREFIXES, type GuardianRelation } from "../../shared/constants";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { createPasswordRecord, newId } from "../lib/crypto";
import { audit, fail, loadSettings, parseBody } from "../lib/util";
import { partsOf } from "../lib/parts";
import { todayHebron } from "../lib/dates";
import { planTransfer } from "../lib/transfers";
import { assertStageCircle, stageCircleSql, stagesOf, teacherCircleIds } from "../lib/access";
import { findOrCreateGuardian, guardianFields } from "./guardians";

export const studentRoutes = new Hono<AppEnv>();

const studentFields = {
  nationalId: z.string().regex(NATIONAL_ID_RE, "رقم الهوية 9 أرقام"),
  name: z.string().trim().min(8, "الاسم الرباعي 8 أحرف على الأقل").max(100),
  birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ الميلاد غير صالح"),
  gender: z.enum(["male", "female"]),
  /** اختيارية (§15.7): يُسجَّل الطالب قبل توزيعه على حلقة */
  circleId: z.string().nullable().default(null),
  direction: z.enum(["descending", "ascending"]).default("descending"),
  guardianRelation: z.enum(GUARDIAN_RELATIONS).default("father"),
  /** يُتجاهل: المحفوظ يُحسب من آخر موضع (lib/parts). يبقى اختيارياً لتوافق العملاء القدامى. */
  memorizedParts: z.number().int().min(0).max(30).optional(),
  lastSurah: z.number().int().min(1).max(114).optional(),
  lastAyah: z.number().int().min(0).max(286).default(0),
  ajkamCourse: z.enum(AJKAM_COURSES).or(z.literal("")).default(""),
  monthlyPlanPages: z.number().int().min(0).max(604).default(0),
  monthlyReviewPlanPages: z.number().int().min(0).max(604).default(0),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  // أرقام تواصل الطالب (مقدمة الدولة + الوطني)
  phoneCc: z.enum(WA_PREFIXES, { errorMap: () => ({ message: "المقدمة المسموحة 970 أو 972 فقط" }) }).default("970"),
  phoneNational: z.string().regex(PHONE_RE, "الرقم يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 أرقام").or(z.literal("")).default("")
};

// حساب الطالب الخاص أُلغي كلياً (§14.1). بيانات ولي الأمر إجبارية مع كل طالب (§15.7):
// إما `guardianId` لولي موجود (للطالب إخوة مسجَّلون) أو `guardian` لولي جديد.
const createSchema = z.object({
  ...studentFields,
  guardianId: z.string().min(1).optional(),
  guardian: z.object(guardianFields).optional()
}).refine((b) => !!b.guardianId || !!b.guardian, { message: "بيانات ولي الأمر مطلوبة: اختر ولياً موجوداً أو أضف جديداً", path: ["guardian"] });

// المعلّم يعدّل فقط ما يخص المتابعة اليومية؛ الإداريون يعدّلون كل شيء
const TEACHER_EDITABLE = ["direction", "memorizedParts", "lastSurah", "lastAyah", "ajkamCourse", "monthlyPlanPages", "monthlyReviewPlanPages"] as const;
const updateSchema = z.object(studentFields).partial();
const archiveSchema = z.object({ reason: z.string().trim().min(2, "اكتب سبب الأرشفة").max(200) });
const moveSchema = z.object({ circleId: z.string().min(1), reason: z.string().trim().max(200).default("") });

const SELECT_STUDENTS = `
  SELECT s.id, s.user_id AS userId, s.national_id AS nationalId, s.name, s.birth, s.gender, s.circle_id AS circleId,
         c.name AS circleName, s.direction, s.memorized_parts AS memorizedParts, s.last_surah AS lastSurah,
         s.last_ayah AS lastAyah, s.ajkam_course AS ajkamCourse, s.monthly_plan_pages AS monthlyPlanPages, s.monthly_review_plan_pages AS monthlyReviewPlanPages,
         s.phone_cc AS phoneCc, s.phone_national AS phoneNational, s.guardian_id AS guardianId, COALESCE(NULLIF(s.guardian_relation_detail, ''), s.guardian_relation) AS guardianRelation,
         (SELECT d.review_to_surah FROM daily_records d WHERE d.student_id = s.id AND d.review_to_surah IS NOT NULL ORDER BY d.date DESC LIMIT 1) AS reviewSurah,
         (SELECT d.review_to_ayah FROM daily_records d WHERE d.student_id = s.id AND d.review_to_surah IS NOT NULL ORDER BY d.date DESC LIMIT 1) AS reviewAyah,
         (s.photo <> '') AS hasPhoto, s.honor_consent AS honorConsent, s.joined_at AS joinedAt, s.archived_at AS archivedAt, s.archive_reason AS archiveReason,
         u.username, u.active AS accountActive
    FROM students s
    LEFT JOIN circles c ON c.id = s.circle_id
    LEFT JOIN users u ON u.id = s.user_id`;

type StudentRow = Record<string, unknown> & { id: string; circleId: string | null; gender: string; archivedAt: number | null; userId: string | null };

const shape = (r: Record<string, unknown>) => ({ ...r, memorizedParts: partsOf(r as { direction: string; lastSurah: number; lastAyah: number }), accountActive: r.accountActive === 1, hasPhoto: r.hasPhoto === 1, honorConsent: r.honorConsent === 1 });

function relationBucket(relation: GuardianRelation): "father" | "mother" | "other" {
  return relation === "father" ? "father" : relation === "mother" ? "mother" : "other";
}

async function photoOf(c: Context<AppEnv>, studentId: string): Promise<string> {
  const r = await c.env.DB.prepare("SELECT photo FROM students WHERE id = ?").bind(studentId).first<{ photo: string }>();
  return r?.photo ?? "";
}

/** أولياء أمر الطالب (أصحاب الحسابات المرتبطة به). */
async function guardiansOf(c: Context<AppEnv>, studentId: string) {
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.user_id AS userId, g.name, COALESCE(NULLIF(s.guardian_relation_detail, ''), s.guardian_relation) AS relation, g.national_id AS nationalId,
            g.call_phone AS callPhone, g.wa_cc AS waCc, g.wa_national AS waNational,
            u.username, u.active
       FROM students s JOIN guardians g ON g.id = s.guardian_id
       LEFT JOIN users u ON u.id = g.user_id
      WHERE s.id = ?`
  )
    .bind(studentId)
    .all<{ id: string; userId: string | null; name: string; relation: string; nationalId: string | null; callPhone: string; waCc: string; waNational: string; username: string | null; active: number | null }>();
  return results.map((g) => ({ ...g, hasAccount: !!g.userId, active: g.active === 1 }));
}

/** يحمّل الطالب ويتحقق من الملكية: المعلّم لطلاب حلقته، ومدير المرحلة لطلاب حلقات مراحله. */
async function loadStudent(c: Context<AppEnv>, id: string): Promise<StudentRow> {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare(`${SELECT_STUDENTS} WHERE s.id = ? AND s.center_id = ?`).bind(id, auth.centerId).first<StudentRow>();
  if (!row) fail(404, "الطالب غير موجود");
  if (auth.role === "teacher") {
    if (!row.circleId || !teacherCircleIds(c).includes(row.circleId)) fail(404, "الطالب غير موجود");
  }
  if (auth.role === "stage_manager") {
    const stages = stagesOf(c);
    const ok =
      !!row.circleId &&
      ((auth.circleIds ?? []).includes(row.circleId) ||
        !!(await c.env.DB.prepare(`SELECT 1 FROM circles WHERE id = ? AND center_id = ? AND level_key IN (${stages.map(() => "?").join(",")})`)
          .bind(row.circleId, auth.centerId, ...stages)
          .first()));
    if (!ok) fail(404, "الطالب غير موجود");
  }
  return row;
}

/** الأماكن المتاحة في الحلقة بعد التحقق من صلاحيتها لجنس الطالب. */
async function circleRoom(c: Context<AppEnv>, circleId: string, gender: string, ignoreStudentId?: string): Promise<number> {
  const auth = c.get("auth");
  const circle = await c.env.DB.prepare("SELECT id, category, active FROM circles WHERE id = ? AND center_id = ?").bind(circleId, auth.centerId).first<{ id: string; category: string; active: number }>();
  if (!circle) fail(400, "الحلقة غير موجودة");
  if (circle.active !== 1) fail(400, "الحلقة معطّلة، اختر حلقة فعّالة");
  if (circle.category !== gender) fail(400, "فئة الحلقة لا تطابق جنس الطالب");
  const settings = await loadSettings(c.env.DB, auth.centerId);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE circle_id = ? AND archived_at IS NULL AND id <> ?").bind(circleId, ignoreStudentId ?? "").first<{ n: number }>();
  return settings.maxStudentsPerCircle - (count?.n ?? 0);
}

/** فحوص الحلقة: فعّالة، من فئة جنس الطالب، وفيها مكان. */
async function checkCircle(c: Context<AppEnv>, circleId: string, gender: string, ignoreStudentId?: string) {
  if ((await circleRoom(c, circleId, gender, ignoreStudentId)) <= 0) fail(400, "الحلقة مكتملة العدد");
}

studentRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const archived = url.searchParams.get("archived") === "1";
  const q = (url.searchParams.get("q") || "").trim();
  const circleId = url.searchParams.get("circleId") || "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 30));

  let where = "s.center_id = ? AND s.archived_at IS " + (archived ? "NOT NULL" : "NULL");
  const binds: unknown[] = [auth.centerId];
  if (auth.role === "teacher") {
    const mine = teacherCircleIds(c);
    if (!mine.length) return c.json({ students: [], total: 0, page, pageSize });
    where += ` AND s.circle_id IN (${mine.map(() => "?").join(",")})`;
    binds.push(...mine);
  }
  if (auth.role === "stage_manager") {
    const scope = stageCircleSql(c, "s.circle_id");
    where += scope.sql;
    binds.push(...scope.binds);
  }
  if (circleId) { where += " AND s.circle_id = ?"; binds.push(circleId); }
  if (q) { where += " AND (s.name LIKE ? OR s.national_id LIKE ? OR s.phone_national LIKE ?)"; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM students s WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`${SELECT_STUDENTS} WHERE ${where} ORDER BY s.name LIMIT ? OFFSET ?`)
    .bind(...binds, pageSize, (page - 1) * pageSize)
    .all();
  return c.json({ students: results.map(shape), total: total?.n ?? 0, page, pageSize });
});

/** بطاقة الطالب نفسه (بوابة الطالب). */
studentRoutes.get("/me", requireAuth("student"), async (c) => {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare(`${SELECT_STUDENTS} WHERE s.user_id = ? AND s.center_id = ?`).bind(auth.userId, auth.centerId).first();
  if (!row) fail(404, "لا يوجد ملف طالب لهذا الحساب");
  return c.json({ student: { ...shape(row), photo: await photoOf(c, String(row.id)) } });
});

/* ============================ الاستيراد من ملف Excel ============================ */

const importRow = z.object({
  name: z.string().trim().min(3, "الاسم مطلوب").max(100),
  nationalId: z.string().trim().max(20).default(""),
  birth: z.string().trim().max(20).default(""),
  gender: z.enum(["male", "female"]).optional(),
  phoneCc: z.string().trim().max(4).default("970"),
  phoneNational: z.string().trim().max(20).default(""),
  guardianName: z.string().trim().max(100).default(""),
  guardianRelation: z.enum(GUARDIAN_RELATIONS).default("father"),
  /** رقم الاتصال المحلي (§15.2) */
  guardianCallPhone: z.string().trim().max(20).default(""),
  guardianWaCc: z.string().trim().max(4).default("970"),
  guardianWaNational: z.string().trim().max(20).default(""),
  guardianNationalId: z.string().trim().max(20).default(""),
  direction: z.enum(["descending", "ascending"]).default("descending"),
  lastSurah: z.number().int().min(1).max(114).optional(),
  lastAyah: z.number().int().min(0).max(286).default(0),
  monthlyPlanPages: z.number().int().min(0).max(604).default(0),
  ajkamCourse: z.string().trim().max(40).default(""),
  joinedAt: z.string().trim().max(20).default("")
});

const importSchema = z.object({
  /** اختيارية (§15.7): بلا حلقة يُسجَّل الطلاب ويُوزَّعون لاحقاً */
  circleId: z.string().nullable().default(null),
  /** توليد رقم هوية مؤقت (tmp-…) للصفوف التي لا رقم لها، ليُصحَّح لاحقاً */
  tempIds: z.boolean().default(false),
  /** إنشاء حساب لكل ولي أمر جديد له رقم هوية: اسم المستخدم وكلمة المرور = رقم الهوية (§15.8) */
  createAccounts: z.boolean().default(false),
  rows: z.array(importRow).min(1, "لا صفوف للاستيراد").max(50, "50 صفاً كحد أقصى في الدفعة")
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * استيراد دفعة طلاب إلى حلقة واحدة (الملف يُقرأ في الواجهة: Excel أو CSV).
 * يعيد نتيجة كل صف (أُضيف / مكرّر / خطأ) ولا يُفشل الدفعة كلها بسبب صف واحد.
 * إن حمل الصف بيانات ولي أمر: يُربَط بولي موجود بالهوية أولاً ثم بالجوال؛ وإن قُدِّم اسم مستخدم وكلمة مرور يُنشَأ حساب جديد.
 */
studentRoutes.post("/import", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, importSchema);
  if (auth.role === "teacher" && !(b.circleId && teacherCircleIds(c).includes(b.circleId))) {
    fail(403, "يمكنك الاستيراد إلى إحدى حلقاتك فقط");
  }
  // مدير المرحلة يستورد إلى حلقات مراحله فقط (لا إلى «بلا حلقة»: الطالب بلا حلقة خارج مراحله)
  if (auth.role === "stage_manager") await assertStageCircle(c, b.circleId);
  let circle: { id: string; category: string; active: number } | null = null;
  let room = Number.POSITIVE_INFINITY;
  if (b.circleId) {
    circle = await c.env.DB.prepare("SELECT id, category, active FROM circles WHERE id = ? AND center_id = ?").bind(b.circleId, auth.centerId).first<{ id: string; category: string; active: number }>();
    if (!circle) fail(400, "الحلقة غير موجودة");
    room = await circleRoom(c, b.circleId, circle!.category);
  }

  // أرقام الهوية الموجودة مسبقاً (لكشف التكرار بلا استعلام لكل صف)
  const ids = b.rows.map((r) => r.nationalId).filter(Boolean);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    const { results } = await c.env.DB.prepare(`SELECT national_id AS id FROM students WHERE center_id = ? AND national_id IN (${part.map(() => "?").join(",")})`)
      .bind(auth.centerId, ...part)
      .all<{ id: string }>();
    results.forEach((r) => existing.add(r.id));
  }

  // أولياء موجودون في القاعدة: بالهوية أولاً ثم برقم الواتساب — بهما يُكتشف الإخوة (§15.8)
  const gNids = [...new Set(b.rows.map((r) => r.guardianNationalId).filter(Boolean))];
  const gPhones = [...new Set(b.rows.map((r) => `${r.guardianWaCc || "970"}|${r.guardianWaNational}`).filter((p) => p.split("|")[1]))];
  const byNid = new Map<string, string>();
  const byPhone = new Map<string, string>();
  // D1 يقبل 100 معامل ربط كحد أقصى: 50 صفاً × زوج (رمز + رقم) كانت تتجاوزه، فنقسّم كل بحث إلى دفعات
  for (let i = 0; i < gNids.length; i += 40) {
    const part = gNids.slice(i, i + 40);
    const { results } = await c.env.DB.prepare(`SELECT id, national_id AS nid FROM guardians WHERE center_id = ? AND national_id IN (${part.map(() => "?").join(",")})`)
      .bind(auth.centerId, ...part).all<{ id: string; nid: string }>();
    results.forEach((r) => byNid.set(r.nid, r.id));
  }
  const pairs = gPhones.map((p) => p.split("|"));
  for (let i = 0; i < pairs.length; i += 40) {
    const part = pairs.slice(i, i + 40);
    const { results } = await c.env.DB.prepare(
      `SELECT id, wa_cc AS cc, wa_national AS n FROM guardians WHERE center_id = ? AND (${part.map(() => "(wa_cc = ? AND wa_national = ?)").join(" OR ")})`
    ).bind(auth.centerId, ...part.flat()).all<{ id: string; cc: string; n: string }>();
    results.forEach((r) => byPhone.set(`${r.cc}|${r.n}`, r.id));
  }
  // أرقام هوية لها حسابات مسبقاً (اسم المستخدم = رقم الهوية §15.8)
  const takenUsers = new Set<string>();
  for (let i = 0; i < gNids.length; i += 40) {
    const part = gNids.slice(i, i + 40);
    const { results } = await c.env.DB.prepare(`SELECT username FROM users WHERE center_id = ? AND username IN (${part.map(() => "?").join(",")})`)
      .bind(auth.centerId, ...part).all<{ username: string }>();
    results.forEach((r) => takenUsers.add(r.username));
  }

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const stmts: D1PreparedStatement[] = [];
  const results: Array<{ index: number; name: string; status: "added" | "duplicate" | "error"; message: string }> = [];
  const seen = new Set<string>();
  let guardiansCreated = 0;
  let guardiansLinked = 0;
  let accountsCreated = 0;

  for (let index = 0; index < b.rows.length; index++) {
    const r = b.rows[index];
    const push = (status: "added" | "duplicate" | "error", message: string) => { results.push({ index, name: r.name, status, message }); };
    if (circle && r.gender && r.gender !== circle.category) { push("error", "جنس الطالب لا يطابق فئة الحلقة"); continue; }
    let nid = r.nationalId;
    if (!nid) {
      if (!b.tempIds) { push("error", "رقم الهوية مطلوب"); continue; }
      nid = `tmp-${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    } else if (!NATIONAL_ID_RE.test(nid)) {
      push("error", "رقم الهوية 9 أرقام"); continue;
    }
    if (existing.has(nid) || seen.has(nid)) { push("duplicate", "رقم الهوية مسجّل مسبقاً"); continue; }
    if (circle && room <= 0) { push("error", "الحلقة مكتملة العدد"); continue; }
    // الشروط نفسها كنموذج «إضافة طالب» (studentFields/guardianFields): الاستيراد لا يقبل ما يرفضه النموذج
    if (r.name.length < 8) { push("error", "الاسم الرباعي 8 أحرف على الأقل"); continue; }
    if (!DATE_ONLY.test(r.birth)) { push("error", "تاريخ الميلاد مطلوب (المطلوب YYYY-MM-DD)"); continue; }
    if (!r.gender && !circle) { push("error", "الجنس مطلوب عند التسجيل بلا حلقة"); continue; }
    if (r.joinedAt && !DATE_ONLY.test(r.joinedAt)) { push("error", "تاريخ الانتساب غير صالح (المطلوب YYYY-MM-DD)"); continue; }

    // ولي الأمر إجباري (§15.7): يُطابَق بالهوية ثم برقم الواتساب فيُكتشف الإخوة تلقائياً (§15.8)
    const gCc = r.guardianWaCc || "970";
    const gWa = r.guardianWaNational;
    const phoneKey = gWa ? `${gCc}|${gWa}` : "";
    if (r.guardianName.length < 3) {
      push("error", "بيانات ولي الأمر ناقصة (الاسم 3 أحرف على الأقل)"); continue;
    }
    if (!PHONE_RE.test(r.guardianCallPhone)) {
      push("error", "رقم اتصال ولي الأمر يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 أرقام"); continue;
    }
    if (!(WA_PREFIXES as readonly string[]).includes(gCc)) {
      push("error", "مقدمة الواتساب المسموحة 970 أو 972 فقط"); continue;
    }
    if (!PHONE_RE.test(gWa)) {
      push("error", "رقم واتساب ولي الأمر يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 أرقام"); continue;
    }
    if (r.phoneNational && !(WA_PREFIXES as readonly string[]).includes(r.phoneCc || "970")) {
      push("error", "مقدمة جوال الطالب المسموحة 970 أو 972 فقط"); continue;
    }
    if (r.phoneNational && !PHONE_RE.test(r.phoneNational)) {
      push("error", "رقم اتصال الطالب يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 أرقام"); continue;
    }
    let guardianId = (r.guardianNationalId && byNid.get(r.guardianNationalId)) || (phoneKey && byPhone.get(phoneKey)) || "";
    if (guardianId) {
      guardiansLinked++;
    } else {
      guardianId = newId();
      let userId: string | null = null;
      // الحساب اختياري ولا يُنشأ إلا برقم هوية صالح لم يُستعمل (اسم المستخدم = رقم الهوية)
      if (b.createAccounts && NATIONAL_ID_RE.test(r.guardianNationalId) && !takenUsers.has(r.guardianNationalId)) {
        userId = newId();
        const rec = await createPasswordRecord(r.guardianNationalId);
        takenUsers.add(r.guardianNationalId);
        accountsCreated++;
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO users (id, center_id, role, username, display_name, password_hash, password_salt, password_iterations, active, session_version, created_at, updated_at)
             VALUES (?, ?, 'student', ?, ?, ?, ?, ?, 1, 1, ?, ?)`
          ).bind(userId, auth.centerId, r.guardianNationalId, r.guardianName, rec.hash, rec.salt, rec.iterations, now, now)
        );
      }
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO guardians (id, center_id, user_id, name, national_id, call_phone, wa_cc, wa_national, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(guardianId, auth.centerId, userId, r.guardianName, r.guardianNationalId || null, r.guardianCallPhone, gCc, gWa, now, now)
      );
      guardiansCreated++;
      // تسجيلهما فوراً حتى يلتقط الإخوةُ في الصفوف التالية ولي الأمر نفسه
      if (r.guardianNationalId) byNid.set(r.guardianNationalId, guardianId);
      if (phoneKey) byPhone.set(phoneKey, guardianId);
    }

    seen.add(nid);
    room -= 1;
    const lastSurah = r.lastSurah ?? (r.direction === "ascending" ? 1 : 114);
    const pos = { direction: r.direction, lastSurah, lastAyah: r.lastAyah };
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO students (id, center_id, user_id, national_id, name, birth, gender, circle_id, direction, memorized_parts, last_surah, last_ayah,
                               ajkam_course, monthly_plan_pages, phone_cc, phone_national, guardian_id, guardian_relation, guardian_relation_detail, joined_at, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId(), auth.centerId, nid, r.name, r.birth, r.gender ?? circle!.category, b.circleId, r.direction, partsOf(pos), lastSurah, r.lastAyah,
        (AJKAM_COURSES as readonly string[]).includes(r.ajkamCourse) ? r.ajkamCourse : "", r.monthlyPlanPages,
        r.phoneCc || "970", r.phoneNational, guardianId, relationBucket(r.guardianRelation), r.guardianRelation,
        r.joinedAt || today, now, now)
    );
    push("added", "");
  }

  if (stmts.length) {
    for (let i = 0; i < stmts.length; i += 25) await c.env.DB.batch(stmts.slice(i, i + 25));
    const addedCount = results.filter((r) => r.status === "added").length;
    await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "import", entity: "student", details: `${addedCount} طالباً · +${guardiansCreated} ولي · ⇌${guardiansLinked} · ${accountsCreated} حساباً` });
  }
  return c.json({
    added: results.filter((r) => r.status === "added").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    errors: results.filter((r) => r.status === "error").length,
    guardiansCreated,
    guardiansLinked,
    accountsCreated,
    results
  });
});

studentRoutes.get("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const s = await loadStudent(c, c.req.param("id"));
  const centerId = c.get("auth").centerId;
  // نقل مرتَّب لم يسرِ بعد (يُعرض في بطاقة الطالب): من يراها يعرف أن الطالب سينتقل ومتى
  const pendingTransferP = c.env.DB.prepare(
    `SELECT t.to_circle_id AS toCircleId, ci.name AS toCircleName, t.effective_from AS effectiveFrom
       FROM student_transfers t JOIN circles ci ON ci.id = t.to_circle_id
      WHERE t.student_id = ? AND t.center_id = ? AND t.applied = 0 ORDER BY t.effective_from DESC LIMIT 1`
  ).bind(s.id, centerId).first<{ toCircleId: string; toCircleName: string; effectiveFrom: string }>();
  const [photo, guardians, pendingTransfer] = await Promise.all([photoOf(c, s.id), guardiansOf(c, s.id), pendingTransferP]);
  return c.json({ student: { ...shape(s), photo, guardians, pendingTransfer: pendingTransfer ?? null } });
});

/** إنشاء طالب (وحسابه الخاص إن طُلب): المدير والسكرتير، والمعلّم لحلقته فقط. */
studentRoutes.post("/", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, createSchema);
  if (auth.role === "teacher") {
    const mine = teacherCircleIds(c);
    if (!mine.length) fail(403, "لم تُسنَد إليك حلقة بعد");
    if (!b.circleId) fail(403, "اختر إحدى حلقاتك عند إضافة طالب");
    if (!mine.includes(b.circleId)) fail(403, "يمكنك إضافة طلاب إلى حلقاتك فقط");
  }
  // الحلقة إلزامية لمدير المرحلة: طالب بلا حلقة لا ينتمي إلى مرحلة فلن يراه بعد الإضافة
  if (auth.role === "stage_manager") await assertStageCircle(c, b.circleId);
  // الحلقة اختيارية (§15.7): يُسجَّل الطالب الآن ويُوزَّع لاحقاً
  if (b.circleId) await checkCircle(c, b.circleId, b.gender);
  const dupNid = await c.env.DB.prepare("SELECT id FROM students WHERE center_id = ? AND national_id = ?").bind(auth.centerId, b.nationalId).first();
  if (dupNid) fail(409, "رقم الهوية مسجّل لطالب آخر");

  const now = Date.now();
  // ولي الأمر: إما موجود (للطالب إخوة) أو جديد يُنشأ الآن (§15.8)
  let guardianId: string;
  if (b.guardianId) {
    const g = await c.env.DB.prepare("SELECT id FROM guardians WHERE id = ? AND center_id = ?").bind(b.guardianId, auth.centerId).first<{ id: string }>();
    if (!g) fail(400, "ولي الأمر المختار غير موجود");
    guardianId = g.id;
  } else {
    guardianId = (await findOrCreateGuardian(c.env.DB, auth.centerId, b.guardian!, now)).id;
  }

  const studentId = newId();
  const lastSurah = b.lastSurah ?? (b.direction === "ascending" ? 1 : 114);
  const pos = { direction: b.direction, lastSurah, lastAyah: b.lastAyah };
  await c.env.DB.prepare(
    `INSERT INTO students (id, center_id, user_id, national_id, name, birth, gender, circle_id, direction, memorized_parts, last_surah, last_ayah,
                           ajkam_course, monthly_plan_pages, monthly_review_plan_pages, phone_cc, phone_national, guardian_id, guardian_relation, guardian_relation_detail, joined_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(studentId, auth.centerId, b.nationalId, b.name, b.birth, b.gender, b.circleId, b.direction, partsOf(pos), lastSurah, b.lastAyah,
    b.ajkamCourse, b.monthlyPlanPages, b.monthlyReviewPlanPages, b.phoneCc || "970", b.phoneNational, guardianId, relationBucket(b.guardianRelation), b.guardianRelation,
    b.joinedAt ?? new Date().toISOString().slice(0, 10), now, now).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "student", entityId: studentId, details: b.name });
  return c.json({ ok: true, id: studentId, guardianId }, 201);
});

studentRoutes.patch("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const current = await loadStudent(c, c.req.param("id"));
  const b = await parseBody(c, updateSchema);
  if (auth.role === "teacher") {
    const forbidden = Object.keys(b).filter((k) => !(TEACHER_EDITABLE as readonly string[]).includes(k));
    if (forbidden.length) fail(403, "يمكنك تعديل بيانات المتابعة فقط (الاتجاه، آخر موضع، الخطة الشهرية)");
  }
  // مدير المرحلة يعدّل كالسكرتير لكن لا ينقل الطالب خارج مراحله
  if (auth.role === "stage_manager" && b.circleId !== undefined) await assertStageCircle(c, b.circleId);
  // تغيير حلقة طالب له حلقة يمرّ عبر «نقل» فقط (يحفظ تاريخه ويسري من أول الشهر التالي)
  if (b.circleId && current.circleId && b.circleId !== current.circleId) fail(400, "لنقل الطالب إلى حلقة أخرى استعمل زر «نقل» في بطاقته");
  if (b.circleId !== undefined || b.gender !== undefined) {
    const gender = (b.gender ?? current.gender) as string;
    const circleId = (b.circleId ?? current.circleId) as string;
    if (circleId && (b.circleId !== undefined || b.gender !== undefined)) await checkCircle(c, circleId, gender, current.id);
  }
  if (b.nationalId && b.nationalId !== current.nationalId) {
    const dup = await c.env.DB.prepare("SELECT id FROM students WHERE center_id = ? AND national_id = ? AND id <> ?").bind(auth.centerId, b.nationalId, current.id).first();
    if (dup) fail(409, "رقم الهوية مسجّل لطالب آخر");
  }
  await c.env.DB.prepare(
    `UPDATE students SET national_id = COALESCE(?, national_id), name = COALESCE(?, name), birth = COALESCE(?, birth), gender = COALESCE(?, gender),
            circle_id = COALESCE(?, circle_id), direction = COALESCE(?, direction), memorized_parts = COALESCE(?, memorized_parts),
            last_surah = COALESCE(?, last_surah), last_ayah = COALESCE(?, last_ayah), ajkam_course = COALESCE(?, ajkam_course),
            monthly_plan_pages = COALESCE(?, monthly_plan_pages), monthly_review_plan_pages = COALESCE(?, monthly_review_plan_pages), phone_cc = COALESCE(?, phone_cc), phone_national = COALESCE(?, phone_national),
            guardian_relation = COALESCE(?, guardian_relation), guardian_relation_detail = COALESCE(?, guardian_relation_detail), joined_at = COALESCE(?, joined_at), updated_at = ? WHERE id = ?`
  ).bind(b.nationalId ?? null, b.name ?? null, b.birth ?? null, b.gender ?? null, b.circleId ?? null, b.direction ?? null, null,
    b.lastSurah ?? null, b.lastAyah ?? null, b.ajkamCourse ?? null, b.monthlyPlanPages ?? null, b.monthlyReviewPlanPages ?? null, b.phoneCc ?? null, b.phoneNational ?? null,
    b.guardianRelation ? relationBucket(b.guardianRelation) : null, b.guardianRelation ?? null, b.joinedAt ?? null, Date.now(), current.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "student", entityId: current.id, details: Object.keys(b).join(",") });
  return c.json({ ok: true });
});

const photoSchema = z.object({ photo: z.string().max(250_000, "الصورة كبيرة جداً").refine((v) => v === "" || v.startsWith("data:image/"), "صيغة الصورة غير صالحة") });

/** صورة الطالب الشخصية (تُصغَّر في الواجهة قبل الرفع). المدير والسكرتير والمعلّم لطلابه. */
studentRoutes.get("/:id/photo", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const current = await loadStudent(c, c.req.param("id"));
  const p = await photoOf(c, current.id);
  if (!p || !p.startsWith("data:image/")) return c.body(null, 404);
  const match = p.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
  if (!match) return c.body(null, 404);
  const binary = Uint8Array.from(atob(match[2]), (m) => m.codePointAt(0)!);
  return c.body(binary, 200, {
    "Content-Type": match[1],
    "Cache-Control": "public, max-age=120"
  });
});

studentRoutes.post("/:id/photo", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const current = await loadStudent(c, c.req.param("id"));
  const { photo } = await parseBody(c, photoSchema);
  await c.env.DB.prepare("UPDATE students SET photo = ?, updated_at = ? WHERE id = ?").bind(photo, Date.now(), current.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "student", entityId: current.id, details: photo ? "صورة" : "إزالة الصورة" });
  return c.json({ ok: true });
});

studentRoutes.post("/:id/move", requireAuth("admin", "secretary", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const current = await loadStudent(c, c.req.param("id"));
  const { circleId, reason } = await parseBody(c, moveSchema);
  if (current.archivedAt) fail(400, "الطالب مؤرشف؛ استرجعه أولاً");
  // النقل داخل مراحله فقط (loadStudent ضَمِن أن الحلقة الحالية ضمنها)
  if (auth.role === "stage_manager") await assertStageCircle(c, circleId);
  if (current.circleId === circleId) fail(400, "الطالب في هذه الحلقة أصلاً");
  await checkCircle(c, circleId, current.gender as string, current.id);
  const now = Date.now();
  // طالب بلا حلقة: توزيعه الأول ليس «نقلاً» فيسري فوراً ولا سجل انتقال له
  if (!current.circleId) {
    await c.env.DB.prepare("UPDATE students SET circle_id = ?, updated_at = ? WHERE id = ?").bind(circleId, now, current.id).run();
    await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "move", entity: "student", entityId: current.id, details: `بلا حلقة → ${circleId}` });
    return c.json({ ok: true, immediate: true, effectiveFrom: todayHebron() });
  }
  // نقل طالب له حلقة: يُرتَّب من اليوم 25 ويسري من أول الشهر التالي، أو فوراً من المدير بسبب مكتوب.
  // سجلات ما قبل النقل تبقى منسوبة للحلقة القديمة (worker/lib/transfers.ts).
  const plan = planTransfer(todayHebron(), auth.role, reason);
  if (plan.kind === "denied") fail(plan.status, plan.message);
  const immediate = plan.kind === "immediate";
  await c.env.DB.batch([
    // ترتيب جديد يحلّ محلّ أي انتقال معلّق لم يسرِ بعد
    c.env.DB.prepare("DELETE FROM student_transfers WHERE student_id = ? AND applied = 0").bind(current.id),
    c.env.DB.prepare(
      `INSERT INTO student_transfers (id, center_id, student_id, from_circle_id, to_circle_id, effective_from, reason, applied, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId(), auth.centerId, current.id, current.circleId, circleId, plan.effectiveFrom, reason, immediate ? 1 : 0, auth.userId, now),
    ...(immediate ? [c.env.DB.prepare("UPDATE students SET circle_id = ?, updated_at = ? WHERE id = ?").bind(circleId, now, current.id)] : [])
  ]);
  await audit(c.env.DB, {
    centerId: auth.centerId, userId: auth.userId, action: "move", entity: "student", entityId: current.id,
    details: `${current.circleId} → ${circleId} (${immediate ? "فوري" : "يسري من " + plan.effectiveFrom})${reason ? ": " + reason : ""}`
  });
  return c.json({ ok: true, immediate, effectiveFrom: plan.effectiveFrom });
});

/** الحذف = نقل إلى الأرشيف مع السبب؛ يوقف حساب الطالب ويمكن استرجاعه. */
studentRoutes.post("/:id/archive", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const current = await loadStudent(c, c.req.param("id"));
  const { reason } = await parseBody(c, archiveSchema);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE students SET archived_at = ?, archive_reason = ?, updated_at = ? WHERE id = ?").bind(now, reason, now, current.id),
    ...(current.userId ? [c.env.DB.prepare("UPDATE users SET active = 0, session_version = session_version + 1, updated_at = ? WHERE id = ?").bind(now, current.userId)] : [])
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "archive", entity: "student", entityId: current.id, details: reason });
  return c.json({ ok: true });
});

/** أرشفة جماعية للطلاب النشطين، مع فلترة اختيارية حسب الحلقة. لا تحذف البيانات نهائياً. */
studentRoutes.post("/bulk-archive", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, z.object({ circleId: z.string().nullable().default(null), reason: z.string().trim().min(2).max(200) }));
  if (b.circleId) {
    const circle = await c.env.DB.prepare("SELECT id FROM circles WHERE id = ? AND center_id = ?").bind(b.circleId, auth.centerId).first();
    if (!circle) fail(404, "الحلقة غير موجودة");
  }
  const where = b.circleId ? "center_id = ? AND circle_id = ? AND archived_at IS NULL" : "center_id = ? AND archived_at IS NULL";
  const binds = b.circleId ? [auth.centerId, b.circleId] : [auth.centerId];
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM students WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const n = count?.n ?? 0;
  if (!n) return c.json({ ok: true, archived: 0 });
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE students SET archived_at = ?, archive_reason = ?, updated_at = ? WHERE ${where}`).bind(now, b.reason, now, ...binds),
    c.env.DB.prepare(`UPDATE users SET active = 0, session_version = session_version + 1, updated_at = ? WHERE id IN (SELECT user_id FROM students WHERE center_id = ? AND archived_at = ? AND user_id IS NOT NULL${b.circleId ? " AND circle_id = ?" : ""})`).bind(now, auth.centerId, now, ...(b.circleId ? [b.circleId] : []))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "archive", entity: "student", details: `جماعي: ${n} طالباً${b.circleId ? ` من الحلقة ${b.circleId}` : " من جميع الحلقات"} — ${b.reason}` });
  return c.json({ ok: true, archived: n });
});

studentRoutes.post("/:id/restore", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const current = await loadStudent(c, c.req.param("id"));
  if (!current.archivedAt) fail(400, "الطالب غير مؤرشف");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE students SET archived_at = NULL, archive_reason = '', updated_at = ? WHERE id = ?").bind(now, current.id),
    ...(current.userId ? [c.env.DB.prepare("UPDATE users SET active = 1, updated_at = ? WHERE id = ?").bind(now, current.userId)] : [])
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "restore", entity: "student", entityId: current.id });
  return c.json({ ok: true });
});

// حسابات الطلاب أُلغيت كلياً (§14.1). المسارات POST /:id/account و /:id/password حُذفت.
// createPasswordRecord يُستخدم في /import لإنشاء حساب ولي أمر مع الطالب.

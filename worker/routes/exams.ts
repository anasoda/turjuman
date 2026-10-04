import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { accessibleStudent, studentScope } from "../lib/access";
import { requireAuth } from "../lib/auth";
import { accessibleCourse } from "../lib/courses";
import { newId } from "../lib/crypto";
import { DATE_RE, notTooFuture } from "../lib/dates";
import { notifyMany, studentRecipients } from "../lib/notify";
import { pushInBackground } from "../lib/push";
import { audit, fail, loadSettings, parseBody } from "../lib/util";
import { ayahCount, juzForPosition, orderKey, partsInRange } from "../../shared/quran";
import { examRangeDetails, examQuestionScore, examTotalScore, validExamSlots } from "../../shared/exams";

export const testRoutes = new Hono<AppEnv>();

const rangeFields = {
  testType: z.enum(["single", "chain"]),
  parts: z.number().int().min(1, "عدد الأجزاء من 1 إلى 30").max(30, "عدد الأجزاء من 1 إلى 30"),
  // نطاق حرّ: نص يكتبه المستخدم أو يختاره من الاقتراحات (مثل «عمّ – المجادلة»)
  rangeText: z.string().trim().max(120).default(""),
  range: z.union([
    z.object({ kind: z.literal("juz"), fromJuz: z.number().int().min(1).max(30), toJuz: z.number().int().min(1).max(30) }),
    z.object({ kind: z.literal("surah"), fromSurah: z.number().int().min(1).max(114), toSurah: z.number().int().min(1).max(114) }),
    z.object({ from: z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(286) }), to: z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1).max(286) }) })
  ]).nullable().default(null)
};

function resolvedRange(b: { parts: number; rangeText: string; range: z.infer<typeof rangeFields.range> }) {
  const range = b.range;
  if (!range) return { parts: b.parts, text: b.rangeText, kind: null, fromJuz: null, toJuz: null, fromSurah: null, fromAyah: null, toSurah: null, toAyah: null };
  if ("kind" in range) {
    const detail = examRangeDetails(range);
    if (!detail) fail(400, "نطاق الاختبار غير صالح");
    return { parts: detail.parts, text: detail.text, kind: range.kind,
      fromJuz: range.kind === "juz" ? range.fromJuz : null, toJuz: range.kind === "juz" ? range.toJuz : null,
      fromSurah: range.kind === "surah" ? range.fromSurah : null, fromAyah: range.kind === "surah" ? 1 : null,
      toSurah: range.kind === "surah" ? range.toSurah : null, toAyah: range.kind === "surah" ? ayahCount(range.toSurah) : null };
  }
  const parts = partsInRange(range.from, range.to);
  if (!parts) fail(400, "نطاق الاختبار غير صالح");
  return { parts, text: b.rangeText, kind: "surah", fromJuz: null, toJuz: null,
    fromSurah: range.from.surah, fromAyah: range.from.ayah, toSurah: range.to.surah, toAyah: range.to.ayah };
}

function insertTest(db: D1Database, fields: Record<string, string | number | null>) {
  const entries = Object.entries(fields);
  return db.prepare(`INSERT INTO tests (${entries.map(([name]) => name).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`)
    .bind(...entries.map(([, value]) => value)).run();
}

const trialSchema = z.object({
  id: z.string().uuid().optional(),
  studentId: z.string().min(1),
  date: z.string().regex(DATE_RE, "التاريخ غير صالح"),
  score: z.number().min(0).max(1000),
  notes: z.string().trim().max(300).default(""),
  ...rangeFields
});
const proposeSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1, "اختر طالباً واحداً على الأقل").max(50),
  proposals: z.array(z.object({ studentId: z.string().min(1), id: z.string().uuid() })).max(50).optional(),
  ...rangeFields
});
const decideSchema = z.object({ testDate: z.string().regex(DATE_RE).nullable().default(null), notes: z.string().trim().max(300).default("") });

const SELECT = `SELECT t.id, t.student_id AS studentId, s.name AS studentName, c.name AS circleName, t.kind, t.status, t.test_type AS testType, t.parts,
        t.range_text AS rangeText, t.test_date AS testDate, t.score, t.passed, t.notes, t.created_at AS createdAt,
        t.range_kind AS rangeKind, t.range_from_juz AS rangeFromJuz, t.range_to_juz AS rangeToJuz,
        t.range_from_surah AS rangeFromSurah, t.range_to_surah AS rangeToSurah,
        es.id AS sessionId,
        pu.display_name AS proposedByName, du.display_name AS decidedByName
   FROM tests t JOIN students s ON s.id = t.student_id LEFT JOIN circles c ON c.id = t.circle_id
   LEFT JOIN users pu ON pu.id = t.proposed_by LEFT JOIN users du ON du.id = t.decided_by
   LEFT JOIN exam_sessions es ON es.test_id = t.id`;

/** قائمة الاختبارات: ترقيم وبحث وتصفية بالحالة والنوع. المعلّم لطلابه، واللجنة والإداريون للكل. */
testRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "";
  const kind = url.searchParams.get("kind") || "";
  const studentId = url.searchParams.get("studentId") || "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const scope = studentScope(c);
  let where = `t.center_id = ?${scope.sql}`;
  const binds: unknown[] = [auth.centerId, ...scope.binds];
  if (["proposed", "approved", "rejected", "completed"].includes(status)) { where += " AND t.status = ?"; binds.push(status); }
  if (kind === "trial" || kind === "official") { where += " AND t.kind = ?"; binds.push(kind); }
  if (studentId) { where += " AND t.student_id = ?"; binds.push(studentId); }
  if (q) { where += " AND (s.name LIKE ? OR t.range_text LIKE ?)"; binds.push(`%${q}%`, `%${q}%`); }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tests t JOIN students s ON s.id = t.student_id WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return c.json({ tests: results, total: total?.n ?? 0, page, pageSize });
});

/** اختبار تجريبي: يسجّله المعلّم (أو الإداري) مباشرة بنتيجته. لا تقييد لقيمة العلامة؛ النجاح من إعدادات المركز. */
testRoutes.post("/trial", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, trialSchema);
  const range = resolvedRange(b);
  if (!notTooFuture(b.date)) fail(400, "لا يمكن التسجيل في تاريخ مستقبلي");
  const student = await accessibleStudent(c, b.studentId);
  if (student.archivedAt) fail(400, "الطالب مؤرشف");
  const settings = await loadSettings(c.env.DB, auth.centerId);
  const id = b.id ?? newId();
  if (b.id) {
    const dup = await c.env.DB.prepare("SELECT id FROM tests WHERE id = ?").bind(b.id).first();
    if (dup) return c.json({ ok: true, id, duplicate: true });
  }
  const now = Date.now();
  await insertTest(c.env.DB, { id, center_id: auth.centerId, student_id: student.id, circle_id: student.circleId, kind: "trial", status: "completed",
    test_type: b.testType, parts: range.parts, range_text: range.text, range_kind: range.kind,
    range_from_juz: range.fromJuz, range_to_juz: range.toJuz, range_from_surah: range.fromSurah, range_from_ayah: range.fromAyah,
    range_to_surah: range.toSurah, range_to_ayah: range.toAyah,
    test_date: b.date, score: b.score, passed: b.score >= settings.minPassScore ? 1 : 0,
    proposed_by: auth.userId, decided_by: auth.userId, decided_at: now, notes: b.notes, created_at: now, updated_at: now });
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "test", entityId: id, details: `تجريبي ${student.name}: ${b.score}` });
  const uids = await studentRecipients(c.env.DB, student.id);
  const link = `/app?studentId=${student.id}&tab=tests&testId=${id}`;
  await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "test_result", title: `نتيجة اختبار تجريبي: ${student.name}`, body: `العلامة: ${b.score} — ${b.score >= settings.minPassScore ? "ناجح" : "دون النجاح"}`, link });
  await pushInBackground(c, auth.centerId, uids, { title: `نتيجة اختبار تجريبي: ${student.name}`, body: `العلامة: ${b.score}`, link });
  return c.json({ ok: true, id, passed: b.score >= settings.minPassScore }, 201);
});

/** اقتراح اختبار رسمي: المحفّظ يقترح طلاباً من عنده؛ اللجنة تقبل وتعتمد. */
testRoutes.post("/propose", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, proposeSchema);
  const range = resolvedRange(b);
  const distinctStudents = [...new Set(b.studentIds)];
  const proposalIds = new Map(b.proposals?.map((entry) => [entry.studentId, entry.id]) ?? []);
  if (b.proposals && (proposalIds.size !== distinctStudents.length || b.proposals.length !== distinctStudents.length || new Set(proposalIds.values()).size !== distinctStudents.length || distinctStudents.some((sid) => !proposalIds.has(sid)))) fail(400, "معرّفات الاقتراحات غير متطابقة مع الطلاب");
  const created: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  for (const sid of distinctStudents) {
    const student = await accessibleStudent(c, sid);
    if (student.archivedAt) { skipped.push(student.name); continue; }
    const id = proposalIds.get(sid) ?? newId();
    const existing = await c.env.DB.prepare("SELECT student_id AS studentId, kind FROM tests WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first<{ studentId: string; kind: string }>();
    if (existing) {
      if (existing.studentId !== sid || existing.kind !== "official") fail(409, "معرّف الاقتراح مستخدم لاختبار آخر");
      created.push(id);
      continue;
    }
    const open = await c.env.DB.prepare("SELECT id FROM tests WHERE student_id = ? AND kind = 'official' AND status IN ('proposed','approved') LIMIT 1").bind(student.id).first();
    if (open) { skipped.push(student.name); continue; }
    await insertTest(c.env.DB, { id, center_id: auth.centerId, student_id: student.id, circle_id: student.circleId, kind: "official", status: "proposed",
      test_type: b.testType, parts: range.parts, range_text: range.text, range_kind: range.kind,
      range_from_juz: range.fromJuz, range_to_juz: range.toJuz, range_from_surah: range.fromSurah, range_from_ayah: range.fromAyah,
      range_to_surah: range.toSurah, range_to_ayah: range.toAyah,
      proposed_by: auth.userId, created_at: now, updated_at: now });
    created.push(id);
  }
  if (!created.length) fail(409, "لا يوجد ما يُقترح: الطلاب المختارون لديهم اقتراح قائم أو مؤرشفون");
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "propose", entity: "test", details: `${created.length} طالب` });
  return c.json({ ok: true, created: created.length, skipped }, 201);
});

async function loadTest(c: import("hono").Context<AppEnv>, id: string) {
  const t = await c.env.DB.prepare("SELECT id, student_id AS studentId, status, kind FROM tests WHERE id = ? AND center_id = ?").bind(id, c.get("auth").centerId).first<{ id: string; studentId: string; status: string; kind: string }>();
  if (!t) fail(404, "الاختبار غير موجود");
  return t;
}

/** اعتماد الاقتراح: لجنة الاختبار (والمدير). */
testRoutes.post("/:id/approve", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind === "official" && t.status === "approved") return c.json({ ok: true, existing: true });
  if (t.kind !== "official" || t.status !== "proposed") fail(400, "يمكن اعتماد الاقتراحات المعلّقة فقط");
  const b = await parseBody(c, decideSchema);
  await c.env.DB.prepare("UPDATE tests SET status = 'approved', test_date = ?, notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(b.testDate, b.notes, auth.userId, Date.now(), Date.now(), t.id).run();
  const uids = await studentRecipients(c.env.DB, t.studentId);
  const studentName = (await c.env.DB.prepare("SELECT name FROM students WHERE id = ? AND center_id = ?").bind(t.studentId, auth.centerId).first<{ name: string }>())?.name ?? "الطالب";
  const link = `/app?studentId=${t.studentId}&tab=tests&testId=${t.id}`;
  await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "test_approved", title: `اعتماد اختبار رسمي: ${studentName}`, body: b.testDate ? `موعد الاختبار: ${b.testDate}` : "اعتمدت لجنة الاختبار الاختبار، وسيُحدَّد الموعد قريباً.", link });
  await pushInBackground(c, auth.centerId, uids, { title: `اعتماد اختبار رسمي: ${studentName}`, body: b.testDate ? `موعد الاختبار: ${b.testDate}` : "اعتمد الاختبار، وسيُحدّد موعده قريباً.", link });
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "approve", entity: "test", entityId: t.id });
  return c.json({ ok: true });
});

testRoutes.post("/:id/reject", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind === "official" && t.status === "rejected") return c.json({ ok: true, existing: true });
  if (t.kind !== "official" || t.status !== "proposed") fail(400, "يمكن رفض الاقتراحات المعلّقة فقط");
  const b = await parseBody(c, decideSchema);
  await c.env.DB.prepare("UPDATE tests SET status = 'rejected', notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?")
    .bind(b.notes, auth.userId, Date.now(), Date.now(), t.id).run();
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "reject", entity: "test", entityId: t.id });
  return c.json({ ok: true });
});

/** النتيجة الرسمية تُحفظ من جلسة الأسئلة فقط. */
testRoutes.post("/:id/result", requireAuth("admin", "exam_committee"), async (c) => {
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind !== "official" || t.status !== "approved") fail(400, "سجّل النتيجة للاختبارات المعتمدة فقط");
  fail(400, "افتح جلسة الاختبار وقيّم الأسئلة لحساب النتيجة تلقائياً");
});

/* ==================== جلسة الاختبار التفصيلية ==================== */

const questionSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().min(1).max(20).optional(),
  surah: z.number().int().min(1).max(114).nullable().default(null),
  ayah: z.number().int().min(1).max(286).nullable().default(null),
  warnings: z.number().int().min(0).default(0),
  errors: z.number().int().min(0).default(0),
});
const sessionSchema = z.object({
  questions: z.array(questionSchema).min(1, "أضف سؤالاً واحداً على الأقل").max(20),
  finalize: z.boolean().default(false),
  testDate: z.string().regex(DATE_RE, "التاريخ غير صالح").nullable().default(null),
  notes: z.string().trim().max(300).default("")
});

/** بدء جلسة على اختبار رسمي معتمد، مع تثبيت توزيع الدرجات الحالي. */
testRoutes.post("/:id/session", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  if (t.kind !== "official" || t.status !== "approved") fail(400, "تُفتح الجلسة بعد اعتماد الاختبار الرسمي فقط");
  const existing = await c.env.DB.prepare("SELECT id FROM exam_sessions WHERE test_id = ?").bind(t.id).first();
  if (existing) return c.json({ ok: true, sessionId: existing.id, existing: true });
  const settings = await loadSettings(c.env.DB, auth.centerId);
  if (!validExamSlots(settings.examQuestionSlots)) fail(400, "توزيع أسئلة الاختبار في الإعدادات غير صالح؛ يجب أن يكون مجموعه 100");
  const id = newId();
  const now = Date.now();
  const stmts = [c.env.DB.prepare(
    "INSERT INTO exam_sessions (id, center_id, test_id, student_id, examiner_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)"
  ).bind(id, auth.centerId, t.id, t.studentId, auth.userId, now, now)];
  for (const [index, slot] of settings.examQuestionSlots.entries()) {
    stmts.push(c.env.DB.prepare(
      `INSERT INTO test_questions (id, test_id, session_id, seq, label, is_quranic, max_score, warnings, errors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    ).bind(newId(), t.id, id, index + 1, slot.label, slot.isQuranic ? 1 : 0, slot.maxScore, now));
  }
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "start", entity: "exam_session", entityId: id });
  return c.json({ ok: true, sessionId: id }, 201);
});

async function sessionDetails(c: import("hono").Context<AppEnv>, id: string) {
  const auth = c.get("auth");
  const test = await c.env.DB.prepare(
    `SELECT t.id, t.student_id AS studentId, s.name AS studentName, c.name AS circleName,
            t.test_type AS testType, t.parts, t.range_text AS rangeText, t.test_date AS testDate,
            t.range_kind AS rangeKind, t.range_from_juz AS rangeFromJuz, t.range_to_juz AS rangeToJuz,
            t.range_from_surah AS rangeFromSurah, t.range_from_ayah AS rangeFromAyah,
            t.range_to_surah AS rangeToSurah, t.range_to_ayah AS rangeToAyah,
            t.status AS testStatus, t.score, t.passed, t.notes
       FROM tests t JOIN students s ON s.id = t.student_id LEFT JOIN circles c ON c.id = t.circle_id
      WHERE t.id = ? AND t.center_id = ?`
  ).bind(id, auth.centerId).first<{ id: string; studentId: string; studentName: string; testStatus: string; testDate: string | null; notes: string; score: number | null; passed: number | null; rangeKind: string | null;
    rangeFromJuz: number | null; rangeToJuz: number | null; rangeFromSurah: number | null; rangeFromAyah: number | null;
    rangeToSurah: number | null; rangeToAyah: number | null }>();
  if (!test) fail(404, "الاختبار غير موجود");
  await accessibleStudent(c, test.studentId);
  const session = await c.env.DB.prepare(
    "SELECT id, status, examiner_id AS examinerId, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM exam_sessions WHERE test_id = ? AND center_id = ?"
  ).bind(id, auth.centerId).first<{ id: string; status: string }>();
  if (!session) fail(404, "لم تبدأ جلسة لهذا الاختبار");
  const { results } = await c.env.DB.prepare(
    `SELECT id, seq, label, surah, ayah, max_score AS maxScore, warnings, errors, score
       FROM test_questions WHERE session_id = ? ORDER BY seq`
  ).bind(session.id).all();
  return { test, session, questions: results };
}

testRoutes.get("/:id/session", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) =>
  c.json(await sessionDetails(c, c.req.param("id")))
);

/** حفظ مسودة الجلسة أو إنهاؤها، مع احتساب الدرجة على الخادم من التنبيهات والأخطاء. */
testRoutes.put("/:id/session", requireAuth("admin", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  const details = await sessionDetails(c, c.req.param("id"));
  const b = await parseBody(c, sessionSchema);
  const slots = details.questions as Array<{ id: string; seq: number; maxScore: number; surah: number | null; ayah: number | null; warnings: number; errors: number }>;
  const questionFor = (slot: typeof slots[number]) => b.questions.find((q) => q.id === slot.id || q.seq === slot.seq);
  if (b.questions.length !== slots.length || new Set(slots.map((slot) => questionFor(slot))).size !== slots.length || slots.some((slot) => !questionFor(slot))) {
    fail(400, "أرسل جميع أسئلة الجلسة دون تكرار");
  }
  if (details.session.status !== "draft" || details.test.testStatus !== "approved") {
    if (b.finalize && details.session.status === "completed" && details.test.testStatus === "completed"
      && details.test.testDate === b.testDate && details.test.notes === b.notes
      && slots.every((slot) => { const q = questionFor(slot)!; return slot.surah === q.surah && slot.ayah === q.ayah && slot.warnings === q.warnings && slot.errors === q.errors; }))
      return c.json({ ok: true, existing: true, totalScore: details.test.score, passed: !!details.test.passed });
    fail(409, "هذه الجلسة اكتملت أو تغيّرت على جهاز آخر؛ راجع النتيجة قبل إعادة الإرسال");
  }
  if (b.finalize && (!b.testDate || !notTooFuture(b.testDate))) fail(400, "تاريخ الاختبار مطلوب ويجب ألا يكون في المستقبل");
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const scored: Array<{ maxScore: number; warnings: number; errors: number }> = [];
  for (const slot of slots) {
    const q = questionFor(slot)!;
    if (q.ayah !== null && (q.surah === null || q.ayah > ayahCount(q.surah))) fail(400, "رقم الآية غير صالح للسورة المختارة");
    const { surah, ayah } = q;
    if (surah && ayah && details.test.rangeKind === "juz") {
      const juz = juzForPosition({ surah, ayah });
      if (!juz || juz < (details.test.rangeFromJuz ?? 1) || juz > (details.test.rangeToJuz ?? 30)) fail(400, "موضع السؤال خارج نطاق أجزاء الاختبار");
    }
    if (surah && details.test.rangeKind === "surah" && details.test.rangeFromSurah && details.test.rangeToSurah) {
      if (surah < details.test.rangeFromSurah || surah > details.test.rangeToSurah) fail(400, "السورة خارج نطاق الاختبار");
    }
    if (surah && ayah && details.test.rangeKind === "surah" && details.test.rangeFromSurah && details.test.rangeToSurah) {
      const position = orderKey("ascending", { surah, ayah });
      const from = orderKey("ascending", { surah: details.test.rangeFromSurah, ayah: details.test.rangeFromAyah ?? 1 });
      const to = orderKey("ascending", { surah: details.test.rangeToSurah, ayah: details.test.rangeToAyah ?? ayahCount(details.test.rangeToSurah) });
      if (position < from || position > to) fail(400, "موضع السؤال خارج نطاق سور الاختبار");
    }
    const score = examQuestionScore(slot.maxScore, q.warnings, q.errors);
    scored.push({ maxScore: slot.maxScore, warnings: q.warnings, errors: q.errors });
    stmts.push(c.env.DB.prepare(
      `UPDATE test_questions SET surah = ?, ayah = ?, warnings = ?, errors = ?, score = ?
        WHERE id = ? AND session_id = ?`
    ).bind(surah, ayah, q.warnings, q.errors, score, slot.id, details.session.id));
  }
  const totalScore = examTotalScore(scored);
  if (b.finalize) {
    const settings = await loadSettings(c.env.DB, auth.centerId);
    const passed = totalScore >= settings.minPassScore ? 1 : 0;
    stmts.push(c.env.DB.prepare("UPDATE exam_sessions SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ? AND status = 'draft'")
      .bind(now, now, details.session.id));
    stmts.push(c.env.DB.prepare("UPDATE tests SET status = 'completed', score = ?, passed = ?, test_date = ?, notes = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'")
      .bind(totalScore, passed, b.testDate, b.notes, auth.userId, now, now, details.test.id));
    await c.env.DB.batch(stmts);
    const uids = await studentRecipients(c.env.DB, details.test.studentId);
    const link = `/app?studentId=${details.test.studentId}&tab=tests&testId=${details.test.id}`;
    await notifyMany(c.env.DB, uids, { centerId: auth.centerId, kind: "test_result", title: `نتيجة اختبار ${details.test.studentName}`, body: `العلامة: ${totalScore} — ${passed ? "ناجح" : "دون النجاح"}`, link });
    await pushInBackground(c, auth.centerId, uids, { title: `نتيجة اختبار ${details.test.studentName}`, body: `العلامة: ${totalScore} — ${passed ? "ناجح" : "دون النجاح"}`, link });
    await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "result", entity: "test", entityId: details.test.id, details: `جلسة: ${totalScore}` });
    return c.json({ ok: true, totalScore, passed: !!passed });
  }
  stmts.push(c.env.DB.prepare("UPDATE exam_sessions SET updated_at = ? WHERE id = ? AND status = 'draft'").bind(now, details.session.id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, totalScore });
});

/** توافق قراءة الأسئلة للتقارير القديمة مع التحقق من نطاق الطالب. */
testRoutes.get("/:id/questions", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const details = await sessionDetails(c, c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    `SELECT id, seq, label, is_quranic AS isQuranic, surah, ayah, max_score AS maxScore, warnings, errors, score
       FROM test_questions WHERE session_id = ? ORDER BY seq`
  ).bind(details.session.id).all();
  return c.json({ questions: results });
});

testRoutes.delete("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const auth = c.get("auth");
  const t = await loadTest(c, c.req.param("id"));
  await accessibleStudent(c, t.studentId);
  if (auth.role === "teacher" && !(t.kind === "trial" || t.status === "proposed")) fail(403, "يمكنك حذف الاختبارات التجريبية والاقتراحات المعلّقة فقط");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM test_questions WHERE test_id = ?").bind(t.id),
    c.env.DB.prepare("DELETE FROM exam_sessions WHERE test_id = ?").bind(t.id),
    c.env.DB.prepare("DELETE FROM tests WHERE id = ?").bind(t.id)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "test", entityId: t.id });
  return c.json({ ok: true });
});

/* ============================ دورات الأحكام ============================ */
export const courseRoutes = new Hono<AppEnv>();

const courseSchema = z.object({
  name: z.string().trim().min(2, "اسم الدورة قصير جداً").max(100),
  startsOn: z.string().regex(DATE_RE).nullable().default(null),
  endsOn: z.string().regex(DATE_RE).nullable().default(null),
  status: z.enum(["active", "ended"]),
  teacherId: z.string().min(1).nullable().default(null),
  studentIds: z.array(z.string().min(1)).max(500).default([])
});

/** شيخ الدورة: معلّم فعّال في المركز (مدير المرحلة يُخزَّن بدور teacher أيضاً). */
async function validTeacher(c: import("hono").Context<AppEnv>, id: string | null): Promise<string | null> {
  if (!id) return null;
  const t = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND center_id = ? AND role = 'teacher' AND active = 1").bind(id, c.get("auth").centerId).first();
  if (!t) fail(400, "الشيخ المختار غير موجود ضمن كادر المركز");
  return id;
}

courseRoutes.get("/", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  // المعلّم (ومدير المرحلة) يرى دوراته هو فقط؛ الدورات مستقلة عن الحلقات والمراحل.
  const own = auth.role === "teacher" || auth.role === "stage_manager";
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.starts_on AS startsOn, c.ends_on AS endsOn, c.status, c.teacher_id AS teacherId,
            (SELECT display_name FROM users u WHERE u.id = c.teacher_id) AS teacherName,
            (SELECT COUNT(*) FROM ajkam_course_students x WHERE x.course_id = c.id) AS studentCount,
            (SELECT COUNT(*) FROM ajkam_sessions s WHERE s.course_id = c.id) AS sessionCount,
            (SELECT s.covered_topic FROM ajkam_sessions s WHERE s.course_id = c.id ORDER BY s.held_on DESC LIMIT 1) AS lastTopic,
            (SELECT ROUND(100.0 * SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) / COUNT(*))
               FROM ajkam_attendance a JOIN ajkam_sessions s ON s.id = a.session_id
              WHERE s.course_id = c.id AND a.status <> 'excused') AS attendancePct
       FROM ajkam_courses c WHERE c.center_id = ?${own ? " AND c.teacher_id = ?" : ""} ORDER BY c.status, c.created_at DESC`
  ).bind(auth.centerId, ...(own ? [auth.userId] : [])).all();
  return c.json({ courses: results });
});

courseRoutes.get("/:id", requireAuth("admin", "secretary", "teacher", "stage_manager", "exam_committee"), async (c) => {
  const auth = c.get("auth");
  await accessibleCourse(c, c.req.param("id"), false);
  const course = await c.env.DB.prepare("SELECT id, name, starts_on AS startsOn, ends_on AS endsOn, status, teacher_id AS teacherId FROM ajkam_courses WHERE id = ? AND center_id = ?").bind(c.req.param("id"), auth.centerId).first();
  const { results } = await c.env.DB.prepare(
    "SELECT s.id, s.name FROM ajkam_course_students x JOIN students s ON s.id = x.student_id WHERE x.course_id = ? ORDER BY s.name"
  ).bind(c.req.param("id")).all();
  return c.json({ course, students: results });
});

async function validStudents(c: import("hono").Context<AppEnv>, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    const s = await c.env.DB.prepare("SELECT id FROM students WHERE id = ? AND center_id = ?").bind(id, c.get("auth").centerId).first();
    if (!s) fail(400, "طالب غير موجود ضمن هذا المركز");
    out.push(id);
  }
  return out;
}

courseRoutes.post("/", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const b = await parseBody(c, courseSchema);
  const ids = await validStudents(c, b.studentIds);
  const teacherId = await validTeacher(c, b.teacherId);
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO ajkam_courses (id, center_id, name, starts_on, ends_on, status, teacher_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, auth.centerId, b.name, b.startsOn, b.endsOn, b.status, teacherId, Date.now()),
    ...ids.map((sid) => c.env.DB.prepare("INSERT INTO ajkam_course_students (course_id, student_id) VALUES (?, ?)").bind(id, sid))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "create", entity: "course", entityId: id, details: b.name });
  return c.json({ ok: true, id }, 201);
});

courseRoutes.put("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM ajkam_courses WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first();
  if (!existing) fail(404, "الدورة غير موجودة");
  const b = await parseBody(c, courseSchema);
  const ids = await validStudents(c, b.studentIds);
  const teacherId = await validTeacher(c, b.teacherId);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE ajkam_courses SET name = ?, starts_on = ?, ends_on = ?, status = ?, teacher_id = ? WHERE id = ?").bind(b.name, b.startsOn, b.endsOn, b.status, teacherId, id),
    c.env.DB.prepare("DELETE FROM ajkam_course_students WHERE course_id = ?").bind(id),
    ...ids.map((sid) => c.env.DB.prepare("INSERT INTO ajkam_course_students (course_id, student_id) VALUES (?, ?)").bind(id, sid))
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "course", entityId: id, details: b.name });
  return c.json({ ok: true });
});

courseRoutes.delete("/:id", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, name FROM ajkam_courses WHERE id = ? AND center_id = ?").bind(id, auth.centerId).first<{ id: string; name: string }>();
  if (!existing) fail(404, "الدورة غير موجودة");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM ajkam_attendance WHERE session_id IN (SELECT id FROM ajkam_sessions WHERE course_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM ajkam_sessions WHERE course_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM ajkam_notes WHERE course_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM ajkam_events WHERE course_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM ajkam_course_students WHERE course_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM ajkam_courses WHERE id = ?").bind(id)
  ]);
  await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "delete", entity: "course", entityId: id, details: existing.name });
  return c.json({ ok: true });
});

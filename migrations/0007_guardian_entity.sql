-- 0007: ولي الأمر كيان مستقل عن الحساب + رقمان (اتصال/واتساب). قرارات المالك §15.2 و§15.7 و§15.8.
--
-- لماذا إعادة بناء guardians: كان user_id هو المفتاح الأساسي، فلا يمكن أن يوجد ولي أمر بلا حساب.
-- والمالك قرّر أن بيانات ولي الأمر إجبارية مع كل طالب بينما **الحساب اختياري يُنشأ لاحقاً**.
-- إعادة البناء آمنة هنا لأن **لا جدول يشير إلى guardians بمفتاح أجنبي** (students.guardian_id
-- كان يشير إلى users(id) لا إلى guardians) — بخلاف محاولة إعادة بناء users في 0004 التي فشلت.
--
-- نُبقي id = user_id القديم للصفوف الموجودة، فتبقى قيم students.guardian_id صالحة بلا ترحيل.

-- 1) الجدول الجديد: الاسم والصفة والأرقام داخل guardians نفسه (لا في users).
CREATE TABLE guardians_new (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  -- NULL = ولي أمر بلا حساب دخول بعد (الحساب يُنشأ لاحقاً باسم مستخدم = رقم الهوية)
  user_id     TEXT REFERENCES users(id),
  name        TEXT NOT NULL DEFAULT '',
  relation    TEXT NOT NULL DEFAULT 'father' CHECK (relation IN ('father', 'mother', 'other')),
  national_id TEXT,
  -- رقم الاتصال محلي بلا مقدمة مستقلة (§15.2)؛ الواتساب له مقدمته
  call_phone  TEXT NOT NULL DEFAULT '',
  wa_cc       TEXT NOT NULL DEFAULT '970',
  wa_national TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT INTO guardians_new (id, center_id, user_id, name, relation, national_id, call_phone, wa_cc, wa_national, created_at, updated_at)
SELECT g.user_id, g.center_id, g.user_id,
       COALESCE((SELECT u.display_name FROM users u WHERE u.id = g.user_id), ''),
       g.relation, g.national_id,
       g.phone_national,          -- الرقم القديم كان واحداً: يصير رقم الاتصال
       g.phone_cc, g.phone_national,
       g.created_at, g.updated_at
  FROM guardians g;

DROP INDEX IF EXISTS idx_guardians_center;
DROP INDEX IF EXISTS idx_guardians_national_id_unique;
DROP TABLE guardians;
ALTER TABLE guardians_new RENAME TO guardians;

CREATE INDEX idx_guardians_center      ON guardians(center_id, wa_national);
CREATE INDEX idx_guardians_user        ON guardians(user_id);
-- فريد ضمن المركز ليتسق مع اسم المستخدم (فريد لكل مركز) وقاعدة العزل في الخادم.
-- الموقع لمركز واحد فعلياً؛ السبب عملي: بذرة التطوير تُنشئ مركزين تجريبيين لاختبار العزل.
CREATE UNIQUE INDEX idx_guardians_national_id_unique
  ON guardians(center_id, national_id) WHERE national_id IS NOT NULL AND national_id != '';

-- 2) students.guardian_id كان REFERENCES users(id)؛ صار يشير إلى guardians.id الذي قد لا يقابله مستخدم.
--    SQLite لا يدعم إسقاط قيد؛ والطريق الوحيد هنا إعادة بناء العمود (إعادة بناء students نفسه
--    تفشل لأن جداول كثيرة تشير إليه). DROP/ADD COLUMN مُجرَّب وناجح على هذا الجدول في 0005.
ALTER TABLE students ADD COLUMN guardian_ref TEXT;
UPDATE students SET guardian_ref = guardian_id;
DROP INDEX IF EXISTS idx_students_guardian_id;
ALTER TABLE students DROP COLUMN guardian_id;
ALTER TABLE students ADD COLUMN guardian_id TEXT;
UPDATE students SET guardian_id = guardian_ref;
ALTER TABLE students DROP COLUMN guardian_ref;
CREATE INDEX idx_students_guardian_id ON students(center_id, guardian_id);

-- المرحلة 4: حسابات أولياء الأمور + أرقام التواصل (اتصال/واتساب).
-- قرار المالك (2026-09-24): الحساب لولي الأمر يتابع به أبناءه، وحساب الطالب الخاص اختياري.
-- لا تُعدَّل هذه الهجرة بعد تطبيقها؛ أضف هجرة جديدة.
--
-- ملاحظة مهمة (سبب التصميم): قيد users.role CHECK لا يمكن توسيعه على D1؛
-- إعادة بناء جدول users تفشل لأن D1 يفرض المفاتيح الأجنبية ولا يمرّر
-- PRAGMA defer_foreign_keys/legacy_alter_table داخل مشغّل الهجرات (جُرّب وفشل: FOREIGN KEY constraint failed).
-- لذلك حساب ولي الأمر يُخزَّن في users بدور 'student' ويتميّز بوجود صف له في guardians،
-- ودور الجلسة الفعلي يُحسب في worker/lib/auth.ts (loadAuth) فيصير 'guardian'.

-- 1) أرقام التواصل: جوال الطالب واسم وجوال ولي أمره (لأيقونتي الاتصال والواتساب).
ALTER TABLE students ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN guardian_name TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN guardian_phone TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_students_guardian_phone ON students(center_id, guardian_phone);

-- 2) ملف ولي الأمر (حسابه في users) وربطه بأبنائه.
CREATE TABLE guardians (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  center_id   TEXT NOT NULL REFERENCES centers(id),
  phone       TEXT NOT NULL DEFAULT '',
  relation    TEXT NOT NULL DEFAULT 'father' CHECK (relation IN ('father', 'mother', 'other')),
  national_id TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_guardians_center ON guardians(center_id, phone);

-- طالب قد يرتبط بأكثر من ولي أمر (أب/أم)، وولي الأمر بعدة أبناء.
CREATE TABLE student_guardians (
  student_id       TEXT NOT NULL REFERENCES students(id),
  guardian_user_id TEXT NOT NULL REFERENCES users(id),
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (student_id, guardian_user_id)
);
CREATE INDEX idx_student_guardians_by_guardian ON student_guardians(guardian_user_id);

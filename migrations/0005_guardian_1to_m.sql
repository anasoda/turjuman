-- المرحلة 5 - الدفعة 1 (2026-09-25): تبسيط ولي الأمر إلى 1:M + مقدمة الدولة لكل رقم + إلغاء حساب الطالب.
-- قرارات المالك في الجلسة 6 (docs/requirements.md §14.1). لا بيانات إنتاج (تأكيد المالك).
-- ملاحظة: SQLite/D1 يدعم DROP COLUMN منذ 3.35 ولا يفرض إعادة بناء الجدول في المفاتيح الأجنبية الواردة.

-- 1) إضافة عمود guardian_id على students (nullable — قد يوجد طالب بلا سجل ولي أمر بعد بعد الاستيراد).
ALTER TABLE students ADD COLUMN guardian_id TEXT REFERENCES users(id);
CREATE INDEX idx_students_guardian_id ON students(center_id, guardian_id);

-- 2) ترحيل الروابط من student_guardians: نأخذ أول ولي أمر لكل طالب (created_at الأقدم) — لا بيانات إنتاج فعلية.
UPDATE students
   SET guardian_id = (
     SELECT sg.guardian_user_id
       FROM student_guardians sg
      WHERE sg.student_id = students.id
      ORDER BY sg.created_at ASC
      LIMIT 1
   )
 WHERE guardian_id IS NULL;

-- 3) إسقاط جدول M:N.
DROP INDEX IF EXISTS idx_student_guardians_by_guardian;
DROP TABLE student_guardians;

-- 4) تقسيم رقم جوال ولي الأمر إلى مقدمة + وطني (الافتراضي 970 من الإعدادات).
--    نبقي guardians.phone مؤقتاً كنص خام لسهولة الترحيل ثم نحذفه في الأسفل.
ALTER TABLE guardians ADD COLUMN phone_cc       TEXT NOT NULL DEFAULT '970';
ALTER TABLE guardians ADD COLUMN phone_national TEXT NOT NULL DEFAULT '';
-- الترحيل: كل ما في phone يذهب إلى phone_national كما هو (التطبيع الفعلي في shared/phone.ts).
UPDATE guardians SET phone_national = COALESCE(phone, '');

-- 5) نفس التقسيم على students.phone.
ALTER TABLE students ADD COLUMN phone_cc       TEXT NOT NULL DEFAULT '970';
ALTER TABLE students ADD COLUMN phone_national TEXT NOT NULL DEFAULT '';
UPDATE students SET phone_national = COALESCE(phone, '');

-- 6) UNIQUE على guardians.national_id (فقط للقيم غير الفارغة).
CREATE UNIQUE INDEX idx_guardians_national_id_unique
  ON guardians(national_id)
 WHERE national_id IS NOT NULL AND national_id != '';

-- 7) إسقاط الأعمدة المكرّرة/القديمة.
--    SQLite يرفض DROP COLUMN إن كان العمود مستخدماً في فهرس؛ لذلك نُسقط الفهارس المرتبطة أولاً ثم نعيد بناءها على العمود الجديد.
DROP INDEX IF EXISTS idx_students_guardian_phone;
DROP INDEX IF EXISTS idx_guardians_center;
ALTER TABLE students  DROP COLUMN guardian_name;
ALTER TABLE students  DROP COLUMN guardian_phone;
ALTER TABLE students  DROP COLUMN phone;
ALTER TABLE guardians DROP COLUMN phone;
CREATE INDEX idx_guardians_center ON guardians(center_id, phone_national);
CREATE INDEX idx_students_phone   ON students(center_id, phone_national);

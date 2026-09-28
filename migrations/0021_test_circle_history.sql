-- نفس خلل نسبة السجلات التاريخية (0020) موجود في الاختبارات: قائمة الاختبارات وجلسة الأسئلة
-- كانتا تربطان بحلقة الطالب الحالية (s.circle_id) بدل حلقته وقت تسجيل/اقتراح الاختبار.
ALTER TABLE tests ADD COLUMN circle_id TEXT REFERENCES circles(id) ON DELETE SET NULL;

-- نقطة الإسناد: test_date إن وُجد (التجريبي يُسجَّل بتاريخه فوراً)، وإلا تاريخ الإنشاء (الرسمي المقترح بلا موعد بعد).
UPDATE tests
SET circle_id = COALESCE(
  (SELECT t.from_circle_id FROM student_transfers t
    WHERE t.student_id = tests.student_id
      AND t.effective_from > COALESCE(tests.test_date, date(tests.created_at / 1000, 'unixepoch'))
    ORDER BY t.effective_from ASC LIMIT 1),
  (SELECT circle_id FROM students WHERE id = tests.student_id)
);

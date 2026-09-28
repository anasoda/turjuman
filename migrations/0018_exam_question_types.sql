-- يُثبَّت سماح المدير بالأسئلة غير القرآنية عند فتح جلسة الاختبار.
ALTER TABLE exam_sessions ADD COLUMN allow_non_quranic INTEGER NOT NULL DEFAULT 1;

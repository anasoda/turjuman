-- النطاق المنظم: سور أو أجزاء. أعمدة السور/الآيات أضيفت في 0016.
ALTER TABLE tests ADD COLUMN range_kind TEXT CHECK (range_kind IN ('juz', 'surah'));
ALTER TABLE tests ADD COLUMN range_from_juz INTEGER;
ALTER TABLE tests ADD COLUMN range_to_juz INTEGER;

-- جلسة واحدة لكل اختبار رسمي معتمد، وتظل مسودة حتى اعتماد نتيجتها.
CREATE TABLE exam_sessions (
  id TEXT PRIMARY KEY,
  center_id TEXT NOT NULL REFERENCES centers(id),
  test_id TEXT NOT NULL UNIQUE REFERENCES tests(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id),
  examiner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_exam_sessions_student ON exam_sessions(student_id, created_at DESC);

-- صفوف الأسئلة من 0015 تثبت توزيع المدير عند بدء الجلسة.
ALTER TABLE test_questions ADD COLUMN session_id TEXT REFERENCES exam_sessions(id) ON DELETE CASCADE;
ALTER TABLE test_questions ADD COLUMN position_kind TEXT CHECK (position_kind IN ('surah_start', 'ayah', 'none'));
ALTER TABLE test_questions ADD COLUMN text TEXT NOT NULL DEFAULT '';
ALTER TABLE test_questions ADD COLUMN student_answer TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_test_questions_session_seq ON test_questions(session_id, seq);

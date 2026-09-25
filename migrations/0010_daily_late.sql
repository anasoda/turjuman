-- حضور الطالب اليومي: إضافة «متأخر» (المراجعة، ثم قرار المالك). لا يشير أي جدول إلى daily_records
-- فإعادة بنائه آمنة (على خلاف users/students). البيانات القديمة تُنسخ كما هي دون حذف أو تعديل.
CREATE TABLE daily_records_new (
  id           TEXT PRIMARY KEY,
  center_id    TEXT NOT NULL REFERENCES centers(id),
  student_id   TEXT NOT NULL REFERENCES students(id),
  recorded_by  TEXT REFERENCES users(id),
  date         TEXT NOT NULL,
  attendance   TEXT NOT NULL CHECK (attendance IN ('present', 'absent', 'excused', 'late')),
  direction    TEXT NOT NULL CHECK (direction IN ('descending', 'ascending')),
  from_surah   INTEGER, from_ayah INTEGER,
  to_surah     INTEGER, to_ayah   INTEGER,
  verses       INTEGER NOT NULL DEFAULT 0,
  pages        INTEGER NOT NULL DEFAULT 0,
  grade        TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (student_id, date)
);
INSERT INTO daily_records_new SELECT id, center_id, student_id, recorded_by, date, attendance, direction, from_surah, from_ayah, to_surah, to_ayah, verses, pages, grade, note, created_at, updated_at FROM daily_records;
DROP INDEX IF EXISTS idx_daily_center_date;
DROP TABLE daily_records;
ALTER TABLE daily_records_new RENAME TO daily_records;
CREATE INDEX idx_daily_center_date ON daily_records(center_id, date);

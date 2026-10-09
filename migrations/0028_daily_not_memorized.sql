-- حضور الطالب اليومي: إضافة «مش حافظ» (حضر ولم يسمّع حفظاً ولا مراجعة) ليُسجَّل لكل طالب حضر أي شيء.
-- قيد CHECK لا يُعدَّل في D1 فنعيد بناء الجدول (لا يشير أي جدول إليه، كما في 0010) ونُبقي كل الأعمدة والبيانات كما هي.
CREATE TABLE daily_records_new (
  id           TEXT PRIMARY KEY,
  center_id    TEXT NOT NULL REFERENCES centers(id),
  student_id   TEXT NOT NULL REFERENCES students(id),
  recorded_by  TEXT REFERENCES users(id),
  date         TEXT NOT NULL,
  attendance   TEXT NOT NULL CHECK (attendance IN ('present', 'absent', 'excused', 'late', 'not_memorized')),
  direction    TEXT NOT NULL CHECK (direction IN ('descending', 'ascending')),
  from_surah   INTEGER, from_ayah INTEGER,
  to_surah     INTEGER, to_ayah   INTEGER,
  verses       INTEGER NOT NULL DEFAULT 0,
  pages        INTEGER NOT NULL DEFAULT 0,
  grade        TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  review_from_surah INTEGER,
  review_from_ayah  INTEGER,
  review_to_surah   INTEGER,
  review_to_ayah    INTEGER,
  review_verses     INTEGER NOT NULL DEFAULT 0,
  review_pages      INTEGER NOT NULL DEFAULT 0,
  review_grade      TEXT NOT NULL DEFAULT '',
  circle_id    TEXT REFERENCES circles(id) ON DELETE SET NULL,
  next_memorize_from_surah INTEGER,
  next_memorize_from_ayah  INTEGER,
  next_memorize_to_surah   INTEGER,
  next_memorize_to_ayah    INTEGER,
  next_review_from_surah   INTEGER,
  next_review_from_ayah    INTEGER,
  next_review_to_surah     INTEGER,
  next_review_to_ayah      INTEGER,
  next_note    TEXT NOT NULL DEFAULT '',
  UNIQUE (student_id, date)
);
INSERT INTO daily_records_new (
  id, center_id, student_id, recorded_by, date, attendance, direction, from_surah, from_ayah, to_surah, to_ayah, verses, pages, grade, note, created_at, updated_at,
  review_from_surah, review_from_ayah, review_to_surah, review_to_ayah, review_verses, review_pages, review_grade, circle_id,
  next_memorize_from_surah, next_memorize_from_ayah, next_memorize_to_surah, next_memorize_to_ayah,
  next_review_from_surah, next_review_from_ayah, next_review_to_surah, next_review_to_ayah, next_note
) SELECT
  id, center_id, student_id, recorded_by, date, attendance, direction, from_surah, from_ayah, to_surah, to_ayah, verses, pages, grade, note, created_at, updated_at,
  review_from_surah, review_from_ayah, review_to_surah, review_to_ayah, review_verses, review_pages, review_grade, circle_id,
  next_memorize_from_surah, next_memorize_from_ayah, next_memorize_to_surah, next_memorize_to_ayah,
  next_review_from_surah, next_review_from_ayah, next_review_to_surah, next_review_to_ayah, next_note
FROM daily_records;
DROP INDEX IF EXISTS idx_daily_center_date;
DROP TABLE daily_records;
ALTER TABLE daily_records_new RENAME TO daily_records;
CREATE INDEX idx_daily_center_date ON daily_records(center_id, date);

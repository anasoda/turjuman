-- 0015: جدول أسئلة الاختبار التفصيلية (جلسة الاختبار)
-- المختبر يفتح جلسة على اختبار معتمد، يضيف أسئلة ويقيّم كل سؤال بالتنبيهات والأخطاء.
-- العلامة الكلية تُحسب من مجموع علامات الأسئلة.

CREATE TABLE test_questions (
  id         TEXT PRIMARY KEY,
  test_id    TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  is_quranic INTEGER NOT NULL DEFAULT 1,
  surah      INTEGER,
  ayah       INTEGER,
  max_score  REAL NOT NULL DEFAULT 25,
  warnings   INTEGER NOT NULL DEFAULT 0,
  errors     INTEGER NOT NULL DEFAULT 0,
  score      REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_test_questions_test ON test_questions(test_id, seq);

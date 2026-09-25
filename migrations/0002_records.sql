-- المرحلة 2: التسميع اليومي، السرد، الاختبارات، الكشف الشهري، دورات الأحكام.

-- تسميع وحضور يومي: سجل واحد لكل طالب في اليوم
CREATE TABLE daily_records (
  id           TEXT PRIMARY KEY,
  center_id    TEXT NOT NULL REFERENCES centers(id),
  student_id   TEXT NOT NULL REFERENCES students(id),
  recorded_by  TEXT REFERENCES users(id),
  date         TEXT NOT NULL,
  attendance   TEXT NOT NULL CHECK (attendance IN ('present', 'absent', 'excused')),
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
CREATE INDEX idx_daily_center_date ON daily_records(center_id, date);

-- السرد: من آية إلى آية، مع الأخطاء والتنبيهات؛ الدرجة والتقدير تُحسبان من إعدادات المركز عند الحفظ
CREATE TABLE sard_records (
  id           TEXT PRIMARY KEY,
  center_id    TEXT NOT NULL REFERENCES centers(id),
  student_id   TEXT NOT NULL REFERENCES students(id),
  recorded_by  TEXT REFERENCES users(id),
  date         TEXT NOT NULL,
  stage        TEXT NOT NULL CHECK (stage IN ('trial', 'final')),
  direction    TEXT NOT NULL CHECK (direction IN ('descending', 'ascending')),
  from_surah   INTEGER NOT NULL, from_ayah INTEGER NOT NULL,
  to_surah     INTEGER NOT NULL, to_ayah   INTEGER NOT NULL,
  verses       INTEGER NOT NULL DEFAULT 0,
  mistakes     INTEGER NOT NULL DEFAULT 0,
  alerts       INTEGER NOT NULL DEFAULT 0,
  score        REAL NOT NULL,
  band         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_sard_student ON sard_records(student_id, date);

-- الاختبارات: التجريبي يسجّله المعلّم مباشرة (completed)، والرسمي يقترحه المحفّظ (proposed)
-- فتقبله لجنة الاختبار (approved) ثم تُسجَّل نتيجته (completed) أو يُرفض (rejected).
CREATE TABLE tests (
  id            TEXT PRIMARY KEY,
  center_id     TEXT NOT NULL REFERENCES centers(id),
  student_id    TEXT NOT NULL REFERENCES students(id),
  kind          TEXT NOT NULL CHECK (kind IN ('trial', 'official')),
  status        TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'completed')),
  test_type     TEXT NOT NULL CHECK (test_type IN ('single', 'chain')),
  parts         INTEGER NOT NULL CHECK (parts BETWEEN 1 AND 30),
  range_text    TEXT NOT NULL DEFAULT '',
  test_date     TEXT,
  score         REAL,
  passed        INTEGER,
  proposed_by   TEXT REFERENCES users(id),
  decided_by    TEXT REFERENCES users(id),
  decided_at    INTEGER,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_tests_center_status ON tests(center_id, status, created_at DESC);
CREATE INDEX idx_tests_student ON tests(student_id);

-- الكشف الشهري المحفوظ (تعديل يدوي فوق ما يولَّد تلقائياً من التسميع اليومي)
CREATE TABLE monthly_reports (
  id            TEXT PRIMARY KEY,
  center_id     TEXT NOT NULL REFERENCES centers(id),
  student_id    TEXT NOT NULL REFERENCES students(id),
  month         TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('descending', 'ascending')),
  start_surah   INTEGER NOT NULL, start_ayah INTEGER NOT NULL,
  end_surah     INTEGER NOT NULL, end_ayah   INTEGER NOT NULL,
  pages         INTEGER NOT NULL DEFAULT 0,
  plan_pages    INTEGER NOT NULL DEFAULT 0,
  saved_by      TEXT REFERENCES users(id),
  saved_at      INTEGER NOT NULL,
  UNIQUE (student_id, month)
);
CREATE INDEX idx_reports_center_month ON monthly_reports(center_id, month);

-- دورات الأحكام
CREATE TABLE ajkam_courses (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  name        TEXT NOT NULL,
  starts_on   TEXT,
  ends_on     TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at  INTEGER NOT NULL
);
CREATE TABLE ajkam_course_students (
  course_id   TEXT NOT NULL REFERENCES ajkam_courses(id),
  student_id  TEXT NOT NULL REFERENCES students(id),
  PRIMARY KEY (course_id, student_id)
);

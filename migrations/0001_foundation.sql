-- المرحلة 1: الأساس — المراكز، الإعدادات، الحسابات، الحلقات، الطلاب، سجل التعديلات.
-- لا تُعدَّل هذه الهجرة بعد تطبيقها؛ أضف هجرة جديدة.

CREATE TABLE centers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT 'لتحفيظ القرآن الكريم',
  logo        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  whatsapp    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  INTEGER NOT NULL
);

-- إعدادات المركز (المفاتيح والقيم الافتراضية في shared/settings.ts)
CREATE TABLE center_settings (
  center_id   TEXT NOT NULL REFERENCES centers(id),
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (center_id, key)
);

-- الحسابات: اسم المستخدم فريد في المركز (بغض النظر عن حالة الأحرف)
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  center_id           TEXT NOT NULL REFERENCES centers(id),
  role                TEXT NOT NULL CHECK (role IN ('admin', 'secretary', 'teacher', 'exam_committee', 'student')),
  username            TEXT NOT NULL COLLATE NOCASE,
  display_name        TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  active              INTEGER NOT NULL DEFAULT 1,
  session_version     INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (center_id, username)
);
CREATE INDEX idx_users_center_role ON users(center_id, role);

-- بيانات الكادر الشخصية (مدير/سكرتير/معلّم/لجنة)
CREATE TABLE staff_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users(id),
  national_id       TEXT,
  phone             TEXT NOT NULL DEFAULT '',
  birth             TEXT,
  gender            TEXT CHECK (gender IN ('male', 'female')),
  email             TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  qualification     TEXT NOT NULL DEFAULT '',
  ajkam_course      TEXT NOT NULL DEFAULT '',
  memorized_parts   INTEGER NOT NULL DEFAULT 0,
  photo             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE circles (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('male', 'female')),
  level_key   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (center_id, name)
);

-- لكل معلّم حلقة واحدة فقط، وللحلقة معلّم أساسي واحد ومساعد واحد كحد أقصى
CREATE TABLE circle_teachers (
  circle_id   TEXT NOT NULL REFERENCES circles(id),
  teacher_id  TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('primary', 'assistant')),
  PRIMARY KEY (circle_id, teacher_id),
  UNIQUE (teacher_id)
);
CREATE UNIQUE INDEX idx_circle_one_kind ON circle_teachers(circle_id, kind);

CREATE TABLE students (
  id                  TEXT PRIMARY KEY,
  center_id           TEXT NOT NULL REFERENCES centers(id),
  user_id             TEXT REFERENCES users(id),
  national_id         TEXT NOT NULL,
  name                TEXT NOT NULL,
  birth               TEXT NOT NULL,
  gender              TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  circle_id           TEXT REFERENCES circles(id),
  -- اتجاه الحفظ: descending = من الناس إلى الفاتحة، ascending = من الفاتحة إلى الناس
  direction           TEXT NOT NULL DEFAULT 'descending' CHECK (direction IN ('descending', 'ascending')),
  memorized_parts     INTEGER NOT NULL DEFAULT 0 CHECK (memorized_parts BETWEEN 0 AND 30),
  last_surah          INTEGER NOT NULL DEFAULT 114 CHECK (last_surah BETWEEN 1 AND 114),
  last_ayah           INTEGER NOT NULL DEFAULT 0 CHECK (last_ayah >= 0),
  ajkam_course        TEXT NOT NULL DEFAULT '',
  monthly_plan_pages  INTEGER NOT NULL DEFAULT 0 CHECK (monthly_plan_pages >= 0),
  photo               TEXT NOT NULL DEFAULT '',
  joined_at           TEXT,
  archived_at         INTEGER,
  archive_reason      TEXT NOT NULL DEFAULT '',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (center_id, national_id)
);
CREATE INDEX idx_students_circle ON students(center_id, circle_id);
CREATE INDEX idx_students_archived ON students(center_id, archived_at);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id   TEXT NOT NULL,
  user_id     TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL DEFAULT '',
  details     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_center_time ON audit_log(center_id, created_at DESC);

CREATE TABLE auth_rate_limits (
  key_hash       TEXT PRIMARY KEY,
  attempts       INTEGER NOT NULL,
  window_start   INTEGER NOT NULL,
  blocked_until  INTEGER NOT NULL DEFAULT 0
);

-- المرحلة 3: الإشعارات والإعلانات وإبلاغ الغياب، مواعيد الصلاة، حضور الكادر، جدول الحلقات، ملاحظات داخلية، لوحة الشرف.

-- إشعارات داخل الموقع لكل مستخدم (قناة خارجية كواتساب تُضاف لاحقاً فوق هذا الجدول)
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at, created_at DESC);

-- رسائل الإدارة إلى الأهالي/الكادر
CREATE TABLE announcements (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  audience    TEXT NOT NULL CHECK (audience IN ('all', 'students', 'staff')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_ann_center ON announcements(center_id, created_at DESC);

-- إبلاغ غياب/إجازة من ولي الأمر (عبر حساب الطالب)
CREATE TABLE absence_notices (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  student_id  TEXT NOT NULL REFERENCES students(id),
  date        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (student_id, date)
);
CREATE INDEX idx_absence_center_date ON absence_notices(center_id, date);

-- مواعيد الصلاة (تُستورد من ورقة المركز)
CREATE TABLE prayer_times (
  center_id   TEXT NOT NULL REFERENCES centers(id),
  date        TEXT NOT NULL,
  fajr        TEXT NOT NULL,
  sunrise     TEXT NOT NULL,
  dhuhr       TEXT NOT NULL,
  asr         TEXT NOT NULL,
  maghrib     TEXT NOT NULL,
  isha        TEXT NOT NULL,
  PRIMARY KEY (center_id, date)
);

-- حضور المعلمين والكادر
CREATE TABLE staff_attendance (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  date        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  note        TEXT NOT NULL DEFAULT '',
  recorded_by TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  UNIQUE (user_id, date)
);
CREATE INDEX idx_staff_att_center_date ON staff_attendance(center_id, date);

-- جدول الحلقات (أيام وأوقات ومكان)
CREATE TABLE circle_schedule (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  circle_id   TEXT NOT NULL REFERENCES circles(id),
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  place       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_schedule_circle ON circle_schedule(circle_id);

-- ملاحظات داخلية سرّية عن الطالب (للكادر فقط)
CREATE TABLE student_notes (
  id          TEXT PRIMARY KEY,
  center_id   TEXT NOT NULL REFERENCES centers(id),
  student_id  TEXT NOT NULL REFERENCES students(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_notes_student ON student_notes(student_id, created_at DESC);

-- موافقة ظهور الطالب في لوحة الشرف
ALTER TABLE students ADD COLUMN honor_consent INTEGER NOT NULL DEFAULT 0;

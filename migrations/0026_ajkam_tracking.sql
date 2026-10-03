-- متابعة دورات الأحكام: شيخ للدورة، لقاءات، حضور، ملاحظات، وإعلانات (واجب/اختبار).
-- الدورات مستقلة عن الحلقات والمراحل؛ شيخ الدورة قد لا يكون محفّظ الطالب.
ALTER TABLE ajkam_courses ADD COLUMN teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE ajkam_sessions (
  id            TEXT PRIMARY KEY,
  center_id     TEXT NOT NULL REFERENCES centers(id),
  course_id     TEXT NOT NULL REFERENCES ajkam_courses(id) ON DELETE CASCADE,
  held_on       TEXT NOT NULL,
  covered_topic TEXT NOT NULL DEFAULT '',
  next_topic    TEXT NOT NULL DEFAULT '',
  homework      TEXT NOT NULL DEFAULT '',
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (course_id, held_on)
);
CREATE INDEX idx_ajkam_sessions_course ON ajkam_sessions(course_id, held_on);

CREATE TABLE ajkam_attendance (
  session_id TEXT NOT NULL REFERENCES ajkam_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX idx_ajkam_attendance_student ON ajkam_attendance(student_id);

CREATE TABLE ajkam_notes (
  id         TEXT PRIMARY KEY,
  center_id  TEXT NOT NULL REFERENCES centers(id),
  course_id  TEXT NOT NULL REFERENCES ajkam_courses(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ajkam_notes_course ON ajkam_notes(course_id, student_id);

CREATE TABLE ajkam_events (
  id         TEXT PRIMARY KEY,
  center_id  TEXT NOT NULL REFERENCES centers(id),
  course_id  TEXT NOT NULL REFERENCES ajkam_courses(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('homework', 'exam', 'other')),
  title      TEXT NOT NULL,
  due_on     TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ajkam_events_course ON ajkam_events(course_id, due_on);

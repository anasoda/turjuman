-- خطة مستقلة لكل طالب ولكل شهر. بيانات سبتمبر الحالية تُحفظ قبل بدء جدولة أكتوبر.
CREATE TABLE student_monthly_plans (
  center_id TEXT NOT NULL REFERENCES centers(id),
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  memorize_pages INTEGER NOT NULL CHECK (memorize_pages BETWEEN 0 AND 604),
  review_pages INTEGER NOT NULL CHECK (review_pages BETWEEN 0 AND 604),
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, month)
);
CREATE INDEX idx_student_monthly_plans_center_month ON student_monthly_plans(center_id, month);
INSERT INTO student_monthly_plans (center_id, student_id, month, memorize_pages, review_pages, updated_at)
SELECT center_id, id, '2026-09', monthly_plan_pages, monthly_review_plan_pages, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM students;

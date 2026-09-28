ALTER TABLE daily_records ADD COLUMN circle_id TEXT REFERENCES circles(id) ON DELETE SET NULL;
ALTER TABLE sard_records ADD COLUMN circle_id TEXT REFERENCES circles(id) ON DELETE SET NULL;

UPDATE daily_records
SET circle_id = COALESCE(
  (SELECT t.from_circle_id FROM student_transfers t WHERE t.student_id = daily_records.student_id AND t.effective_from > daily_records.date ORDER BY t.effective_from ASC LIMIT 1),
  (SELECT circle_id FROM students WHERE id = daily_records.student_id)
);

UPDATE sard_records
SET circle_id = COALESCE(
  (SELECT t.from_circle_id FROM student_transfers t WHERE t.student_id = sard_records.student_id AND t.effective_from > sard_records.date ORDER BY t.effective_from ASC LIMIT 1),
  (SELECT circle_id FROM students WHERE id = sard_records.student_id)
);

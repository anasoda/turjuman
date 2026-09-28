-- 0012: Move guardian relation from guardians table to students table

ALTER TABLE students ADD COLUMN guardian_relation TEXT NOT NULL DEFAULT 'father' CHECK (guardian_relation IN ('father', 'mother', 'other'));

UPDATE students
SET guardian_relation = (SELECT relation FROM guardians WHERE guardians.id = students.guardian_id)
WHERE guardian_id IS NOT NULL;

-- In SQLite we can't easily DROP COLUMN with constraints without recreating the table, but D1 supports DROP COLUMN
-- as long as it's not the primary key. However, removing it might break existing views or checks.
ALTER TABLE guardians DROP COLUMN relation;

-- 0009: المعلّم قد يدرّس أكثر من حلقة (§15.5 و§14.2).
--
-- كان في 0001: UNIQUE (teacher_id) — أي حلقة واحدة لكل معلّم. SQLite لا يدعم إسقاط قيد،
-- فيلزم إعادة بناء الجدول. إعادة البناء آمنة هنا لأن **لا مفتاح أجنبي يشير إلى circle_teachers**
-- (تحقَّقتُ: لا REFERENCES circle_teachers في أي هجرة) — بخلاف users في 0004.
--
-- يبقى قيدان:
--   PRIMARY KEY (circle_id, teacher_id) = لا يتكرر المعلّم في الحلقة نفسها.
--   idx_circle_one_kind (circle_id, kind) = لكل حلقة أساسي واحد ومساعد واحد كحد أقصى.
-- والمرفوع فقط: أن يكون للمعلّم حلقة واحدة في المركز كله.

CREATE TABLE circle_teachers_new (
  circle_id   TEXT NOT NULL REFERENCES circles(id),
  teacher_id  TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('primary', 'assistant')),
  PRIMARY KEY (circle_id, teacher_id)
);

INSERT INTO circle_teachers_new (circle_id, teacher_id, kind)
SELECT circle_id, teacher_id, kind FROM circle_teachers;

DROP INDEX IF EXISTS idx_circle_one_kind;
DROP TABLE circle_teachers;
ALTER TABLE circle_teachers_new RENAME TO circle_teachers;

CREATE UNIQUE INDEX idx_circle_one_kind ON circle_teachers(circle_id, kind);
-- البحث الشائع صار «حلقات هذا المعلّم» (loadAuth يقرأها في كل طلب)
CREATE INDEX idx_circle_teachers_teacher ON circle_teachers(teacher_id);

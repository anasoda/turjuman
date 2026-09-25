-- 0008: دور «مدير المرحلة» (§15.3).
--
-- لماذا جدول منفصل ولا نوسّع users.role: قيد CHECK على users.role لا يُوسَّع في D1
-- (إعادة بناء users تفشل لأن جداول كثيرة تشير إليها بمفاتيح أجنبية — فشل موثَّق في 0004).
-- فالحساب يُخزَّن بدور 'teacher' (أضيق دور آمن: بلا صف في circle_teachers لا يرى شيئاً
-- إن حُذفت صفوفه هنا)، والدور الفعلي 'stage_manager' يُشتق في worker/lib/auth.ts —
-- نفس حيلة 'guardian' في 0004.
--
-- level_key = circles.level_key (مفتاح المرحلة من إعدادات المركز settings.levels).
-- صف لكل مرحلة: مدير المرحلة قد يدير أكثر من مرحلة.

CREATE TABLE stage_managers (
  user_id   TEXT NOT NULL REFERENCES users(id),
  center_id TEXT NOT NULL REFERENCES centers(id),
  level_key TEXT NOT NULL,
  PRIMARY KEY (user_id, level_key)
);

CREATE INDEX idx_stage_managers_center ON stage_managers(center_id, level_key);

-- سجل انتقالات الطلاب بين الحلقات (قرار المالك: تاريخ الطالب لا يضيع عند النقل).
-- يُرتَّب النقل من اليوم 25 حتى نهاية الشهر ويسري `effective_from` = أول الشهر التالي،
-- ويبقى `students.circle_id` على الحلقة القديمة حتى ذلك اليوم ثم يُبدَّل كسولاً عند أول طلب
-- (لا cron في Cloudflare Workers). نسبة أي سجل (تسميع/كشف) إلى حلقة يوم D تُشتقّ من هذا الجدول:
-- أول انتقال `effective_from > D` يعطي `from_circle_id`، وإلا فالحلقة الحالية.
-- لا حذف ولا تعديل لأي بيانات قديمة، ولا مفاتيح أجنبية (كي لا نحتاج إعادة بناء جداول لاحقاً).
CREATE TABLE student_transfers (
  id TEXT PRIMARY KEY,
  center_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  from_circle_id TEXT NOT NULL,
  to_circle_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  applied INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_transfers_student ON student_transfers(student_id, effective_from);
CREATE INDEX idx_transfers_due ON student_transfers(center_id, applied, effective_from);

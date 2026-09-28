-- مسار المراجعة بجانب مسار الحفظ (docs/requirements.md §16، قرار المالك 2026-09-25).
-- المحفّظ يحدّد بداية المراجعة ونهايتها كل يوم، ويُقترح موضع بداية اليوم التالي من نهاية اليوم السابق.
-- أعمدة إضافية على سجل اليوم نفسه (لا جدول جديد ولا قيد فريد جديد): يبقى سجل واحد لكل طالب/يوم، فلا يتضاعف الحضور في الإحصاءات.
-- لا حذف ولا تعديل لأي بيانات قديمة: كل الأعمدة الجديدة فارغة/صفر للسجلات الحالية.
ALTER TABLE daily_records ADD COLUMN review_from_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN review_from_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN review_to_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN review_to_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN review_verses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_records ADD COLUMN review_pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_records ADD COLUMN review_grade TEXT NOT NULL DEFAULT '';

-- خطة المراجعة الشهرية بالصفحات (بجانب خطة الحفظ monthly_plan_pages)
ALTER TABLE students ADD COLUMN monthly_review_plan_pages INTEGER NOT NULL DEFAULT 0;

-- الكشف الشهري المحفوظ يحتفظ بمنجز المراجعة وخطتها وقت الحفظ (كما يحتفظ بخطة الحفظ)
ALTER TABLE monthly_reports ADD COLUMN review_pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monthly_reports ADD COLUMN review_plan_pages INTEGER NOT NULL DEFAULT 0;

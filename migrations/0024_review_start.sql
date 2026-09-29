-- نقطة بداية المراجعة قبل أول تسميع؛ آخر مراجعة يومية مسجلة تبقى المصدر الأحدث.
ALTER TABLE students ADD COLUMN review_start_surah INTEGER CHECK (review_start_surah BETWEEN 1 AND 114);
ALTER TABLE students ADD COLUMN review_start_ayah INTEGER CHECK (review_start_ayah BETWEEN 1 AND 286);

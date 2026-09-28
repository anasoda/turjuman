-- المطلوب من الطالب في اللقاء القادم: حفظاً ومراجعة معاً ممكنان (كل منهما مستقل واختياري)، يُسجَّلان
-- مع سجل اليوم نفسه (لا جدول جديد) ويُرسَل إشعاراً فورياً لولي الأمر عند تسجيلهما أو تغييرهما.
-- كل الأعمدة الجديدة فارغة/NULL للسجلات الحالية؛ لا حذف ولا تعديل لبيانات قديمة.
ALTER TABLE daily_records ADD COLUMN next_memorize_from_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_memorize_from_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_memorize_to_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_memorize_to_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_from_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_from_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_to_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_to_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_note TEXT NOT NULL DEFAULT '';

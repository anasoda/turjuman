-- One-time repair for the production D1 schema recorded as migration 0023.
-- Applied to production on 2026-09-29; do not run again on that database.
-- Production still has the older next_kind/next_from_*/next_to_* columns.
-- The current 0023 migration already creates these columns on fresh/local databases,
-- so this file must be applied only to the verified production schema, once.
-- All added columns are nullable; existing daily records are preserved.
ALTER TABLE daily_records ADD COLUMN next_memorize_from_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_memorize_from_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_memorize_to_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_memorize_to_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_from_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_from_ayah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_to_surah INTEGER;
ALTER TABLE daily_records ADD COLUMN next_review_to_ayah INTEGER;

-- Carry forward assignments saved with the older one-kind format.
UPDATE daily_records
SET next_memorize_from_surah = next_from_surah,
    next_memorize_from_ayah = next_from_ayah,
    next_memorize_to_surah = next_to_surah,
    next_memorize_to_ayah = next_to_ayah
WHERE next_kind = 'memorize';

UPDATE daily_records
SET next_review_from_surah = next_from_surah,
    next_review_from_ayah = next_from_ayah,
    next_review_to_surah = next_to_surah,
    next_review_to_ayah = next_to_ayah
WHERE next_kind = 'review';

-- حصة ملغاة (§14.6): المعلّم أو الإدارة يعلن إلغاء حصة حلقة في يوم بسبب معلن (اعتذار، عطلة، طارئ)،
-- فيراها أولياء الأمور ولا تُسجَّل فيها متابعة ولا يُحسب فيها غياب.
CREATE TABLE session_cancellations (
  id           TEXT PRIMARY KEY,
  center_id    TEXT NOT NULL REFERENCES centers(id),
  circle_id    TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  reason       TEXT NOT NULL,
  cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (circle_id, date)
);
CREATE INDEX idx_session_cancellations_date ON session_cancellations(center_id, date);

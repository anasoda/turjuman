-- نطاق الرسالة يبقى في الأعمدة الجديدة مع إبقاء audience القديم للتوافق.
ALTER TABLE announcements ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'center';
ALTER TABLE announcements ADD COLUMN scope_id TEXT;

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  center_id TEXT NOT NULL REFERENCES centers(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subscriptions(center_id, user_id);

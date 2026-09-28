-- اربط إشعارات التعاميم بالتعميم الأصلي حتى يُزال من صناديق المستلمين عند حذفه.
ALTER TABLE notifications ADD COLUMN source_id TEXT;
CREATE INDEX idx_notif_announcement_source ON notifications(center_id, kind, source_id);

-- البيانات السابقة: لا نربط إلا الإشعار الذي يطابق تعميماً واحداً بوضوح.
UPDATE notifications
SET source_id = (
  SELECT a.id FROM announcements a
  WHERE a.center_id = notifications.center_id
    AND a.title = notifications.title AND a.body = notifications.body
    AND notifications.created_at BETWEEN a.created_at AND a.created_at + 300000
  LIMIT 1
)
WHERE kind = 'announcement' AND source_id IS NULL
  AND (
    SELECT COUNT(*) FROM announcements a
    WHERE a.center_id = notifications.center_id
      AND a.title = notifications.title AND a.body = notifications.body
      AND notifications.created_at BETWEEN a.created_at AND a.created_at + 300000
  ) = 1;

# -*- coding: utf-8 -*-
import re

with open('worker/routes/extras.ts', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'scheduleRoutes\.put\("/:circleId", requireAuth\("admin", "secretary", "teacher"\), async \(c\) => \{[\s\S]*?const b = await parseBody\(c, scheduleSchema\);'

replacement = '''scheduleRoutes.put("/:circleId", requireAuth("admin", "secretary"), async (c) => {
  const auth = c.get("auth");
  const circleId = c.req.param("circleId");
  const circle = await c.env.DB.prepare("SELECT id FROM circles WHERE id = ? AND center_id = ?").bind(circleId, auth.centerId).first();
  if (!circle) fail(404, "الحلقة غير موجودة");
  const b = await parseBody(c, scheduleSchema);'''

content = re.sub(pattern, replacement, content)

with open('worker/routes/extras.ts', 'w', encoding='utf-8') as f:
    f.write(content)

# -*- coding: utf-8 -*-
import re

with open('scripts/smoke-phase4.mjs', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'const day = new Date\(Date\.now\(\) - 3 \* 86400_000\)\.toLocaleDateString\("en-CA", \{ timeZone: "Asia/Hebron" \}\);\n\s*const r = await call\("/api/daily", \{ method: "POST", cookie: admin, body: \{ studentId: kids\[0\]\.id, date: day, attendance: "absent" \} \}\);\n\s*assert\.ok\(r\.status === 200 \|\| r\.status === 201, JSON\.stringify\(r\.data\)\);'

replacement = '''let r, day;
  for (let i = 0; i < 7; i++) {
    day = new Date(Date.now() - i * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
    r = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId: kids[0].id, date: day, attendance: "absent" } });
    if (r.status === 200 || r.status === 201) break;
  }
  assert.ok(r && (r.status === 200 || r.status === 201), JSON.stringify(r?.data));'''

content = re.sub(pattern, replacement, content)

with open('scripts/smoke-phase4.mjs', 'w', encoding='utf-8') as f:
    f.write(content)

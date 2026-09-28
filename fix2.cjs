const fs = require('fs');
const files = ['src/pages/Staff.tsx', 'src/pages/Circles.tsx', 'src/pages/Announcements.tsx', 'src/pages/Courses.tsx', 'src/pages/Daily.tsx', 'src/pages/Sard.tsx', 'src/pages/StudentExtras.tsx', 'src/pages/Tests.tsx'];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');
  
  // Clean up bad syntax if it exists
  code = code.replace(/if \(\{\s*title.*?&&\s*if/g, 'if');
  code = code.replace(/\"\)\)\)\)/g, '"))');
  code = code.replace(/if \(await confirm.*?&&\s*await run/g, 'if (await run'); // Just in case it's in between
  
  // The original match we want: if (await run(() => api(`/api/daily/${record.id}`, { method: "DELETE" }), "حذف"))
  // We'll just replace the start `if (await run` -> `if (await confirm(...) && await run`
  
  code = code.replace(/if \(\s*await run\(\(\) => api\(`\/api\/[^`]+`,\s*\{\s*method:\s*"DELETE"\s*\}\),\s*"[^"]+"\)\)/g, (match) => {
    // extract everything inside `if (`
    const inner = match.substring(4, match.length - 1);
    return `if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && ${inner})`;
  });

  fs.writeFileSync(file, code);
}

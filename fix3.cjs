const fs = require('fs');
const files = ['src/pages/Staff.tsx', 'src/pages/Circles.tsx', 'src/pages/Announcements.tsx', 'src/pages/Courses.tsx', 'src/pages/Daily.tsx', 'src/pages/Sard.tsx', 'src/pages/StudentExtras.tsx', 'src/pages/Tests.tsx'];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');
  // It looks like: if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`/api/courses/${course.id}`, { method: "DELETE" }), "حذف"))) void onSaved();
  // See the 3 `)` at the end of the match.
  // Wait, I did `code = code.replace(/\"\)\)\)\)/g, '"))');` earlier.
  // Maybe it's missing something else.
  // Let me just replace the WHOLE line to what it should be.
  code = code.replace(/if \(await confirm\(\{ title: "تأكيد الحذف".*?&&\s*await run\(\(\) => api\(`(\/api\/[^`]+)`,\s*\{\s*method:\s*"DELETE"\s*\}\),\s*"[^"]+"\)\)+/g, 
    'if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`$1`, { method: "DELETE" }), "حذف"))');
  
  fs.writeFileSync(file, code);
}

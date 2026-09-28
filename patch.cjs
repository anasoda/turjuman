const fs = require('fs');
const files = ['src/pages/Staff.tsx', 'src/pages/Circles.tsx', 'src/pages/Announcements.tsx', 'src/pages/Courses.tsx', 'src/pages/Daily.tsx', 'src/pages/Sard.tsx', 'src/pages/StudentExtras.tsx', 'src/pages/Tests.tsx', 'src/components/Shell.tsx', 'src/pages/More.tsx'];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');
  if (code.includes('useUi()') && !code.includes(' confirm ')) {
    code = code.replace(/const \{([^}]+)\} = useUi\(\)/, (m, p1) => `const { confirm, ${p1.trim()} } = useUi()`);
  }
  code = code.replace(/if \(\s*await run\(\(\) => api\(`\/api\/[^`]+`,\s*\{\s*method:\s*"DELETE"\s*\}\),\s*"[^"]+"\)\)/g, (match) => {
    return `if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && ${match})`;
  });
  code = code.replace(/onClick=\{\(\) => void logout\(\)\}/g, 'onClick={async () => { if (await confirm({ title: "تسجيل الخروج", message: "هل أنت متأكد من الخروج؟", confirmLabel: "خروج", danger: true })) { void logout(); } }}');
  fs.writeFileSync(file, code);
}

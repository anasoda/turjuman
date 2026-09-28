const fs = require('fs');
const files = ['src/pages/Staff.tsx', 'src/pages/Circles.tsx', 'src/pages/Announcements.tsx', 'src/pages/Courses.tsx', 'src/pages/Daily.tsx', 'src/pages/Sard.tsx', 'src/pages/StudentExtras.tsx', 'src/pages/Tests.tsx', 'src/components/Shell.tsx', 'src/pages/More.tsx'];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');
  // Revert the bad replacement
  code = code.replace(/if \(await confirm\([^)]+\) && if \(/g, 'if (');
  code = code.replace(/\"\)\)\)\)/g, '"))');
  fs.writeFileSync(file, code);
}

const fs = require('fs');
let code = fs.readFileSync('src/pages/StudentForm.tsx', 'utf8');

code = code.replace(/hint="المراجعة تُسجَّل يومياً مع التسميع"/, '');
code = code.replace(/hint="0 = لم يحفظ منها شيئاً"/, '');
code = code.replace(/hint="0\s*=\s*لم يحفظ منها شيئاً"/, ''); // flexible spacing

fs.writeFileSync('src/pages/StudentForm.tsx', code);

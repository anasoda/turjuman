const fs = require('fs');
let code = fs.readFileSync('src/pages/StudentForm.tsx', 'utf8');

// Replace everything that matches the hint in Field component
code = code.replace(/hint="المراجعة تُسجَّل يومياً مع التسميع"/g, '');
code = code.replace(/hint="0 = لم يحفظ منها شيئاً"/g, '');
code = code.replace(/hint="[^"]*يوميا[^"]*"/g, '');
code = code.replace(/hint="[^"]*لم يحفظ[^"]*"/g, '');

fs.writeFileSync('src/pages/StudentForm.tsx', code);

const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.tsx', 'utf8');

code = code.replace(/\{detail && circles\.data && \(/, '{!form && detail && circles.data && (');

fs.writeFileSync('src/pages/Students.tsx', code);

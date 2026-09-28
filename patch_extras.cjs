const fs = require('fs');
const file = 'src/pages/StudentExtras.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/\{ max: 256, quality: 0\.8, maxChars: 200_000 \}/g, '{ max: 200, quality: 0.6, maxChars: 150_000, cropSquare: true }');
fs.writeFileSync(file, code);

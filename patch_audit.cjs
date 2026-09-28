const fs = require('fs');
let code = fs.readFileSync('worker/routes/students.ts', 'utf8');

// The messed up audit line:
code = code.replace(/details: photo \? [^;]+;/g, 'details: photo ? "photo updated" : "photo removed" });');

fs.writeFileSync('worker/routes/students.ts', code);

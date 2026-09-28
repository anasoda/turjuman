const fs = require('fs');
let code = fs.readFileSync('worker/routes/students.ts', 'utf8');

const regex = /await audit\(c\.env\.DB,\s*\{.*?details:\s*photo \?.*?\}\);/g;
code = code.replace(regex, 'await audit(c.env.DB, { centerId: auth.centerId, userId: auth.userId, action: "update", entity: "student", entityId: current.id, details: photo ? "added photo" : "removed photo" });');

fs.writeFileSync('worker/routes/students.ts', code);

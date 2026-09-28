const fs = require('fs');
let code = fs.readFileSync('worker/routes/staff.ts', 'utf8');

// Remove minAge function entirely
code = code.replace(/const minAge = [^\n]+\n+/, '');

// Remove the age check in POST /
code = code.replace(/if \(\!minAge\(b\.birth.*?;/g, '');

fs.writeFileSync('worker/routes/staff.ts', code);

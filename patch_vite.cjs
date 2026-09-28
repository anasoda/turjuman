const fs = require('fs');
const file = 'vite.config.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/server: \{ port: 5173/, 'server: { host: true, port: 5173');
fs.writeFileSync(file, code);

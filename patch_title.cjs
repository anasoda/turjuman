const fs = require('fs');

const phoneTitle = 'title="يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 خانات"';
const idTitle = 'title="رقم الهوية يجب أن يتكون من 9 خانات"';

// Helper to add title attribute after pattern
function addTitle(file) {
  if (!fs.existsSync(file)) return;
  let code = fs.readFileSync(file, 'utf8');
  
  code = code.replace(/pattern="05\[96\]\[0-9\]\{7\}"(?!\s+title)/g, `pattern="05[96][0-9]{7}" ${phoneTitle}`);
  code = code.replace(/pattern="\[0-9\]\{9\}"(?!\s+title)/g, `pattern="[0-9]{9}" ${idTitle}`);
  
  fs.writeFileSync(file, code);
}

addTitle('src/pages/Staff.tsx');
addTitle('src/components/GuardianFields.tsx');
addTitle('src/pages/StudentForm.tsx');

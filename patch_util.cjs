const fs = require('fs');
let code = fs.readFileSync('worker/lib/util.ts', 'utf8');

const fieldMap = `const FIELD_MAP: Record<string, string> = {
  nationalId: "رقم الهوية",
  phone: "رقم الجوال",
  waCc: "مفتاح الدولة",
  waNational: "رقم الواتساب",
  birth: "تاريخ الميلاد",
  gender: "الجنس",
  email: "البريد الإلكتروني",
  address: "العنوان",
  qualification: "المؤهل",
  ajkamCourse: "دورة الأحكام",
  memorizedParts: "الأجزاء المحفوظة",
  username: "اسم المستخدم",
  password: "كلمة المرور",
  displayName: "الاسم الكامل",
  role: "الدور",
  stages: "المراحل",
  relation: "صلة القرابة",
  callPhone: "رقم الهاتف",
  studentIds: "أبناء ولي الأمر",
  active: "حالة التفعيل",
  name: "الاسم",
  date: "التاريخ",
  amount: "المقدار",
  mark: "العلامة",
  title: "العنوان",
  content: "المحتوى"
};
`;

code = code.replace(/const where = issue\?\.path\.join\("\."\) \|\| "غير معروف";/, fieldMap + '\n      const p = issue?.path.join(".") || "غير معروف";\n      const where = FIELD_MAP[p] || p;');
code = code.replace(/throw new HTTPException\(400, \{ message: issue\?\.message && \/\[أ-ي\]\/\.test\(issue\.message\) \? issue\.message : `البيانات غير صالحة في حقل: \$\{where\}` \}\);/, 'throw new HTTPException(400, { message: issue?.message && /[أ-ي]/.test(issue.message) ? issue.message : `خطأ في بيانات (${where})` });');

fs.writeFileSync('worker/lib/util.ts', code);

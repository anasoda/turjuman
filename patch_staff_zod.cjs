const fs = require('fs');
let code = fs.readFileSync('worker/routes/staff.ts', 'utf8');

code = code.replace(/gender: z\.enum\(\["male", "female"\]\)/, 'gender: z.enum(["male", "female"], { errorMap: () => ({ message: "الجنس مطلوب" }) })');
code = code.replace(/qualification: z\.enum\(QUALIFICATIONS\)/, 'qualification: z.enum(QUALIFICATIONS, { errorMap: () => ({ message: "المؤهل غير صالح" }) })');
code = code.replace(/ajkamCourse: z\.enum\(AJKAM_COURSES\)/, 'ajkamCourse: z.enum(AJKAM_COURSES, { errorMap: () => ({ message: "دورة الأحكام غير صالحة" }) })');
code = code.replace(/memorizedParts: z\.number\(\)\.int\(\)\.min\(0\)\.max\(30\)/, 'memorizedParts: z.number({ invalid_type_error: "الأجزاء المحفوظة يجب أن تكون رقماً" }).int().min(0, "الأجزاء المحفوظة لا تقل عن 0").max(30, "الأجزاء المحفوظة لا تزيد عن 30")');
code = code.replace(/waNational: z\.string\(\)\.trim\(\)\.max\(20\)\.default\(""\)/, 'waNational: z.string().trim().max(20, "رقم الواتساب طويل جداً").default("")');

fs.writeFileSync('worker/routes/staff.ts', code);

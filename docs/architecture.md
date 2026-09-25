# معمارية ترجمان v2

## الصورة العامة
- **Worker واحد** (Cloudflare) يخدم: (1) الواجهة المبنية من `dist/` (SPA + PWA)، (2) واجهة `/api/*` بـ Hono.
- **D1** (SQLite) قاعدة البيانات؛ جداول علائقية، كل صف يحمل `center_id` (عزل المراكز).
- `wrangler.jsonc`: `assets.run_worker_first = ["/api/*"]` و`not_found_handling = single-page-application`. رؤوس الأمان لصفحات الواجهة في `public/_headers` (CSP صارمة: `script-src 'self'`، الخطوط مستضافة ذاتياً عبر `@fontsource`).
- **التطوير**: `wrangler dev` (الخادم :8787، يحتاج مجلد `dist` موجوداً — `scripts/ensure-dist.mjs`) + `vite` (الواجهة :5173 مع proxy لـ `/api`). الأسرار المحلية عبر `--var` في `package.json` (قيم تطوير فقط).

## المصادقة والجلسات
- تسجيل دخول واحد: `POST /api/auth/login {centerId, username, password}`؛ الدور يُقرأ من الحساب.
- JWT HS256 (`hono/jwt`) في كوكي `tq_session` (`HttpOnly`, `SameSite=Strict`, `Secure` على https)، مدة 30 يوماً.
- **كل طلب** يعيد التحقق من القاعدة: الحساب فعّال، المركز فعّال، `session_version` مطابق. تغيير كلمة المرور/إعادة تعيينها/إيقاف الحساب/أرشفة الطالب ترفع `session_version` فتنتهي الجلسات القديمة.
- كلمات المرور PBKDF2-SHA256 (100k دورة، ملح لكل مستخدم). **لا تُعرض ولا تُسجَّل أبداً.** المدير/المعلّم/السكرتير يعيّنون كلمة جديدة فقط (`POST .../password`).
- تحديد المعدّل: 8 محاولات دخول فاشلة → حظر 15 دقيقة (مفتاح = IP + مركز + اسم مستخدم، مجزّأ).
- رسائل الدخول تكشف موضع الخطأ (قرار المالك).

## الصلاحيات (تُطبَّق في الخادم)
| المورد | admin | secretary | teacher | stage_manager | exam_committee | guardian |
|---|---|---|---|---|---|---|
| الإعدادات | كتابة | قراءة | قراءة | قراءة | قراءة | — |
| هوية المركز | كتابة | — | — | — | — | — |
| سجل التعديلات | قراءة | — | — | — | — | — |
| حسابات الكادر | إدارة الكل | معلمون + لجنة | — | — | — | — |
| حضور الكادر | الكل (بمن فيهم مدير المرحلة) | الكل | — | معلّمو مراحله **دون نفسه** | — | — |
| أولياء الأمور | إدارة | إدارة | — | — | — | حسابه فقط |
| الحلقات | إدارة | إدارة | قراءة (حلقاته) | قراءة (مراحله + حلقاته) | قراءة | — |
| الطلاب | إدارة | إدارة | حلقاته: إضافة + تعديل المتابعة | مراحله ∪ حلقاته: إضافة + تعديل كامل | قراءة | بوابة أبنائه فقط |
| نقل الطلاب | نعم | نعم | لا | داخل مراحله | لا | لا |
| أرشفة الطلاب | نعم | نعم | لا | لا | لا | لا |

القاعدة العامة: ولي الأمر يرى أبناءه فقط عبر `/api/portal/summary?studentId=`؛ المعلّم لحلقته (أساسي أو مساعد) فقط؛ **مدير المرحلة لحلقات مراحله** عبر دوال `worker/lib/access.ts` (`studentScope`, `circleScope`, `stageTeacherScope`, `assertStageCircle`)؛ الأدوار الإدارية كل المركز. الطالب أو الحلقة خارج النطاق يعطيان **404** لا 403 حتى لا نكشف وجودهما. **طالب بلا حلقة لا ينتمي إلى مرحلة** فلا يراه مدير المرحلة ولا يستطيع إنشاءه بلا حلقة. **الطلاب لا يملكون حسابات مستقلة (§14.1)** — دور `student` مخصَّص فقط لتخزين حساب ولي الأمر في `users`، والدور الفعلي `guardian` يُحسب في `loadAuth` من وجود صف في `guardians`.

## قاعدة البيانات
**مطبَّقة (هجرة 0001):** `centers`, `center_settings`, `users`, `staff_profiles`, `circles`, `circle_teachers`, `students`, `audit_log`, `auth_rate_limits`.
- `users(center_id, username)` فريد (بلا حساسية لحالة الأحرف). `students.user_id` يبقى `NULL` دائماً بعد §14.1 (الحسابات ألغيت).
- `circle_teachers`: `PRIMARY KEY (circle_id, teacher_id)` وفهرس فريد `(circle_id, kind)` = أساسي واحد ومساعد واحد لكل حلقة. **المعلّم قد يدرّس أكثر من حلقة** (هجرة 0009 رفعت `UNIQUE(teacher_id)`)؛ `auth.circleIds` يحمل حلقاته من الجلسة.
- `students.direction`: `descending` (الناس→الفاتحة) | `ascending` (الفاتحة→الناس). `last_surah` (1..114) و`last_ayah` (0 = لم يبدأ السورة).
- الأرشفة: `students.archived_at/archive_reason`.
- الإعدادات كمفاتيح JSON في `center_settings`؛ القيم الافتراضية والأنواع في `shared/settings.ts`.

**مطبَّقة (هجرة 0002):** `daily_records` (UNIQUE طالب+تاريخ)، `sard_records` (مرحلة trial/final)، `tests` (kind trial/official، status proposed/approved/rejected/completed)، `monthly_reports` (UNIQUE طالب+شهر)، `ajkam_courses` + `ajkam_course_students`.

**مطبَّقة (هجرة 0003):** `notifications` (داخل الموقع؛ القنوات الخارجية تُبنى فوقها)، `announcements`، `absence_notices` (UNIQUE طالب+تاريخ)، `prayer_times` (مركز+تاريخ)، `staff_attendance`، `circle_schedule`، `student_notes` + `students.honor_consent`.

**مطبَّقة (هجرة 0004):** أول جدول `guardians` (مرتبط بـ `users`). حساب ولي الأمر يُخزَّن في `users` بدور `student` (قيد CHECK لا يُوسَّع)، والدور الفعلي `guardian` يُشتق في `loadAuth`.

**مطبَّقة (هجرة 0005):** `students.guardian_id` (1:M)، `students.phone_cc`/`phone_national`، وإسقاط جدول `student_guardians` والأعمدة `students.phone`/`guardian_phone`/`guardian_name`.

**مطبَّقة (هجرة 0006):** `circle_schedule.slot` (موعد بصلاة أو بالساعات: فارغ = ساعات)، و`staff_profiles.wa_cc`/`wa_national` (واتساب الكادر بمقدمته؛ `phone` يبقى رقم الاتصال المحلي).

**مطبَّقة (هجرة 0007):** إعادة بناء `guardians` كيانٌ مستقل: `id` مفتاح أساسي و`user_id` قابل للفراغ (ولي بلا حساب)، و`name`, `relation`, `national_id`, `call_phone`, `wa_cc`, `wa_national`. فهرس فريد `(center_id, national_id)`. `students.guardian_id` صار يشير إلى `guardians.id` (أُعيد بناء العمود بـ ADD/COPY/DROP/ADD لأن إعادة بناء `students` تفشل: جداول كثيرة تشير إليه). إعادة بناء `guardians` آمنة لأنه لا مفتاح أجنبي يشير إليه.
- كل استعلام «أبناء هذا الولي» يقارن `students.guardian_id = auth.guardianId`. الاستعلامات نصوص SQL خام فلا يلتقط typecheck نسياناً — راجع `extras.ts`, `notices.ts`, `reports.ts`, `lib/notify.ts`, `guardians.ts`.
- `findOrCreateGuardian` (في `routes/guardians.ts`) يكتشف الإخوة بالهوية ثم بالواتساب، ويُستعمل من إنشاء الطالب والاستيراد.

**حدود D1:** 100 معامل ربط كحد أقصى للاستعلام الواحد → تُقسَّم قوائم `IN (...)` الكبيرة (انظر `buildReportRows`).

**مطبَّقة (هجرة 0008):** `stage_managers(user_id, center_id, level_key)`، صف لكل مرحلة (مدير المرحلة قد يدير أكثر من مرحلة). `level_key` = `circles.level_key` من إعدادات المركز. الحساب يُخزَّن في `users` بدور **`teacher`** (`STORED_ROLE` في `shared/constants.ts`) والدور الفعلي `stage_manager` يُشتق في `loadAuth` كما يُشتق `guardian`. اختير `teacher` أضيقَ دور آمن: بلا صف في `circle_teachers` لا يرى شيئاً إن فُقدت صفوف مراحله.
- تبديل مراحله يرفع `session_version` فتنتهي جلساته، لأن نطاقه كله مشتق من الجلسة.
- `loadTarget` في `routes/staff.ts` يشتق الدور الفعلي **قبل** `canManage`، وإلا أدار السكرتيرُ مديرَ المرحلة على أنه معلّم.
- `circles.checkTeachers` و`/api/stats/teachers` يستثنيان `stage_managers` حتى لا يظهر مدير المرحلة معلّماً قابلاً للإسناد.

**مطبَّقة محلياً (هجرة 0010: `daily_records.attendance` يقبل `late`؛ 0009 أدناه)**

**مطبَّقة (هجرة 0009، على الإنتاج منذ 2026-09-25):** إعادة بناء `circle_teachers` بلا `UNIQUE(teacher_id)` (آمنة: لا مفتاح أجنبي يشير إليه) مع فهرس `idx_circle_teachers_teacher`. **أي استعلام يصل معلّماً بحلقته عبر `LEFT JOIN circle_teachers` سيكرّر المعلّم بعدد حلقاته** — اجمعها بـ `group_concat` كما في `routes/staff.ts` و`/api/stats/teachers`.

**مخطَّط لاحقاً:** حالة الجلسة + توسيع الحضور، `circle_types`، ملاحظات لولي الأمر، اختبار بنطاق حرّ، متابعة القاعدة النورانية، شاشة «طلاب يحتاجون متابعة». الترتيب في `progress.md`.

## حساب القرآن (منفَّذ في `shared/quran.ts`)
- البيانات: `shared/quran-data.ts` (114 سورة + 604 صفحة، مولَّدة من النظام القديم وموثّقة باختبارات).
- الوحدة النقية (تُكتب في `shared/quran.ts` مع اختبارات): `mushafPageFor(surah, ayah)`، عدّ الآيات والصفحات بين موضعين **حسب اتجاه الحفظ**، أول آية تالية لآخر موضع (`nextStart(direction, lastSurah, lastAyah)`)، الأجزاء المكتملة، الإنجاز مقابل الخطة الشهرية.
- قاعدة النظام القديم المحفوظة: موضع البداية المسجَّل يُعدّ إنجازاً سابقاً ويُستبعد؛ العدّ من الآية التالية حتى النهاية شاملةً؛ الصفحات المشتركة تُعدّ مرة واحدة.

## الواجهة
- React Router: `/` عامة، `/login`، `/app/*` محمية داخل `Shell` (شريط سفلي في الجوال، شريط جانبي ≥900px).
- `lib/session.tsx` (سياق الجلسة)، `lib/api.ts` (مغلّف fetch)، `components/ui.tsx` (`Sheet`، `useUi().toast/confirm`، `Field`، `useAction`).
- جميع النماذج في أوراق منبثقة (Sheet). لا `alert/prompt/confirm`.
- **العمل دون إنترنت** (`src/lib/offline.ts` + `api.ts`): كاش قراءة في IndexedDB يُخدَم عند انقطاع الشبكة؛ صندوق صادر للكتابات الميدانية (`POST /api/daily`, `/api/sard`, `/api/tests/trial`) يُرسل بالترتيب؛ السرد والاختبار التجريبي يحملان `id` من الجهاز فلا يتكرران؛ قاعدة التعارض «آخر حفظ يغلب»؛ الصندوق مرتبط بمستخدمه والكاش يُمسح عند الخروج. الباقي (تعديل/حذف/إعدادات…) يتطلب اتصالاً.

## النشر
```bash
npx wrangler d1 create turjuman-v2-db        # ثم ضع database_id في wrangler.jsonc
npx wrangler d1 migrations apply turjuman-v2-db --remote
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_BOOTSTRAP_KEY
npm run deploy
# إنشاء مركز: POST /api/owner/provision-center برأس x-bootstrap-key
```

-- 0006: موعد الحلقة إما بصلاة (فجراً/ظهراً/عصراً/مغرباً/عشاءً) أو بالساعات (قرار المالك §15.6).
-- slot = '' يعني الموعد بالساعات (start_time/end_time). غير ذلك: اسم الصلاة، وتبقى الساعات
-- محفوظة كتقدير للعرض والترتيب فقط.

ALTER TABLE circle_schedule ADD COLUMN slot TEXT NOT NULL DEFAULT '';

-- رقم واتساب مستقل للكادر بمقدمة دولته (§15.2). staff_profiles.phone يبقى «رقم الاتصال» المحلي.
ALTER TABLE staff_profiles ADD COLUMN wa_cc TEXT NOT NULL DEFAULT '970';
ALTER TABLE staff_profiles ADD COLUMN wa_national TEXT NOT NULL DEFAULT '';

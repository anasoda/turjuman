-- تفاصيل صلة القرابة مع إبقاء guardian_relation القديم للتوافق مع البيانات السابقة.
ALTER TABLE students ADD COLUMN guardian_relation_detail TEXT NOT NULL DEFAULT '';
UPDATE students SET guardian_relation_detail = guardian_relation WHERE guardian_relation_detail = '';

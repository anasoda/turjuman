import { useState, type FormEvent } from "react";
import { AJKAM_COURSES, CATEGORY_LABELS, DIRECTION_LABELS, GENDER_LABELS, GUARDIAN_RELATIONS, RELATION_LABELS, type Direction, type Gender } from "@shared/constants";
import { SURAHS } from "@shared/quran-data";
import { nextStart } from "@shared/quran";
import { COUNTRY_CODES, GuardianFields, emptyGuardian } from "../components/GuardianFields";
import { Field, Sheet, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useDebounced, useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle, Guardian, GuardianInput, Student } from "../lib/types";

/**
 * نموذج الطالب — ترتيب الحقول يتبع §15.7:
 * الإجباري أولاً (الطالب ثم ولي أمره)، ثم قسم «بيانات المتابعة» الاختياري (يُعيَّن لاحقاً).
 * ولي الأمر: إما اختيار ولي موجود (للطالب إخوة مسجَّلون) أو إدخال ولي جديد.
 */
export function StudentForm({ student, circles, onClose, onSaved }: { student: Student | null; circles: Circle[]; onClose: () => void; onSaved: () => void }) {
  const { user, settings } = useMe();
  const { busy, run } = useAction();
  const teacher = user.role === "teacher";
  const editing = !!student;
  const usable = circles.filter((c) => c.active);

  const [circleId, setCircleId] = useState(student?.circleId ?? "");
  const [gender, setGender] = useState<Gender>(student?.gender ?? "male");
  const [direction, setDirection] = useState<Direction>(student?.direction ?? "descending");
  const [surah, setSurah] = useState(student?.lastSurah ?? 114);
  const [ayah, setAyah] = useState(student?.lastAyah ?? 0);
  const [hasReviewStart, setHasReviewStart] = useState(!!student?.reviewStartSurah);
  const [reviewSurah, setReviewSurah] = useState(student?.reviewStartSurah ?? 114);
  const [reviewAyah, setReviewAyah] = useState(student?.reviewStartAyah ?? 1);
  const [more, setMore] = useState(editing);
  const [gMode, setGMode] = useState<"new" | "existing">("new");
  const [guardian, setGuardian] = useState<GuardianInput>(emptyGuardian());
  const [pickedGuardian, setPickedGuardian] = useState("");
  const [pickedRelation, setPickedRelation] = useState<GuardianInput["relation"]>("father");
  const [gQuery, setGQuery] = useState("");
  const dgq = useDebounced(gQuery);
  const found = useFetch<{ guardians: Guardian[] }>(gMode === "existing" ? `/api/guardians?q=${encodeURIComponent(dgq)}` : "");

  const circle = circles.find((c) => c.id === circleId);
  const maxAyah = SURAHS[surah - 1]?.[1] ?? 286;
  const nextMemorization = nextStart(direction, { surah, ayah });

  const changeDirection = (d: Direction) => {
    setDirection(d);
    if (!editing) { setSurah(d === "descending" ? 114 : 1); setAyah(0); }
  };
  const pickCircle = (id: string) => {
    setCircleId(id);
    const c = circles.find((x) => x.id === id);
    if (c) setGender(c.category);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const follow = {
      direction, lastSurah: surah, lastAyah: Math.min(ayah, maxAyah),
      ajkamCourse: String(f.get("ajkamCourse") || "")
    };
    const reviewStart = hasReviewStart
      ? { reviewStartSurah: reviewSurah, reviewStartAyah: reviewAyah }
      : { reviewStartSurah: null, reviewStartAyah: null };
    const contact = { phoneCc: String(f.get("phoneCc") || "970").trim(), phoneNational: String(f.get("phoneNational") || "").trim() };
    const core = { name: String(f.get("name")), nationalId: String(f.get("nationalId")), birth: String(f.get("birth")), gender, circleId: circleId || null };
    if (editing) {
      const tracking = student.hasReviewRecord ? follow : { ...follow, ...reviewStart };
      const body = teacher ? tracking : { ...tracking, ...contact, ...core };
      if (await run(() => api(`/api/students/${student.id}`, { method: "PATCH", body }), "تم حفظ التعديلات")) onSaved();
      return;
    }
    if (gMode === "existing" && !pickedGuardian) return void (await run(async () => { throw new Error("اختر ولي أمر من القائمة"); }));
    const link = gMode === "existing" ? { guardianId: pickedGuardian, guardianRelation: pickedRelation } : { guardian };
    if (await run(() => api("/api/students", { method: "POST", body: { ...follow, ...reviewStart, ...contact, ...core, ...link } }), "تمت إضافة الطالب")) onSaved();
  };

  return (
    <Sheet title={editing ? "تعديل بيانات الطالب" : "إضافة طالب"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {!(editing && teacher) && (
          <>
            <Field label="الاسم الرباعي"><input name="name" required minLength={8} defaultValue={student?.name} /></Field>
            <div className="form-grid two">
              <Field label="رقم الهوية"><input name="nationalId" required pattern="[0-9]{9}" title="رقم الهوية يجب أن يتكون من 9 خانات" inputMode="numeric" defaultValue={student?.nationalId} dir="ltr" /></Field>
              <Field label="تاريخ الميلاد"><input name="birth" type="date" required defaultValue={student?.birth} /></Field>
            </div>
            {!circleId && (
              <Field label="الجنس" hint="يُضبط تلقائياً عند اختيار الحلقة">
                <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                  <option value="male">{GENDER_LABELS.male}</option>
                  <option value="female">{GENDER_LABELS.female}</option>
                </select>
              </Field>
            )}
          </>
        )}

        {!editing && (
          <fieldset className="card" style={{ border: 0, display: "grid", gap: 10 }}>
            <legend style={{ fontWeight: 700 }}>ولي الأمر</legend>
            <div className="radio-row">
              <label><input type="radio" checked={gMode === "new"} onChange={() => setGMode("new")} />ولي أمر جديد</label>
              <label><input type="radio" checked={gMode === "existing"} onChange={() => setGMode("existing")} />له إخوة مسجَّلون</label>
            </div>
            {gMode === "new" ? <GuardianFields value={guardian} onChange={setGuardian} /> : (
              <>
                <Field label="ابحث عن ولي الأمر" hint="بالاسم أو رقم الجوال أو الهوية">
                  <input className="input" value={gQuery} onChange={(e) => setGQuery(e.target.value)} placeholder="اسم الأب أو رقمه" />
                </Field>
                <Field label="صلة القرابة للطالب">
                  <select value={pickedRelation} onChange={(e) => setPickedRelation(e.target.value as GuardianInput["relation"])}>
                    {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABELS[r]}</option>)}
                  </select>
                </Field>
                <div className="pick-list">
                  {(found.data?.guardians ?? []).map((g) => (
                    <label key={g.id} className="check">
                      <input type="radio" checked={pickedGuardian === g.id} onChange={() => setPickedGuardian(g.id)} />
                      {g.name} <small className="muted">{g.children.map((k) => k.name.split(" ")[0]).join("، ") || "بلا أبناء"}</small>
                    </label>
                  ))}
                  {!found.data?.guardians.length && <small className="muted">لا نتائج — جرّب «ولي أمر جديد».</small>}
                </div>
              </>
            )}
          </fieldset>
        )}

        {!(editing && teacher) && (
          <div className="form-grid two">
            <Field label="مقدمة جوال الطالب">
              <select name="phoneCc" defaultValue={student?.phoneCc || "970"}>
                {COUNTRY_CODES.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
              </select>
            </Field>
            <Field label="جوال الطالب" hint="اختياري"><input name="phoneNational" defaultValue={student?.phoneNational ?? ""} inputMode="tel" pattern="05[96][0-9]{7}" title="يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 خانات" dir="ltr" placeholder="0591234567" /></Field>
          </div>
        )}

        {!more && !editing && (
          <button className="btn ghost small" type="button" onClick={() => setMore(true)}>＋ بيانات المتابعة (اختيارية — يمكن تعيينها لاحقاً)</button>
        )}

        {(more || editing) && (
          <>
            {!(editing && teacher) && (
              <Field label="الحلقة" hint={circle ? `فئة الحلقة: ${CATEGORY_LABELS[circle.category]}` : "اتركها فارغة ووزّعه لاحقاً"}>
                <select value={circleId} onChange={(e) => pickCircle(e.target.value)} disabled={editing && !!student?.circleId} title={editing && student?.circleId ? "لنقل الطالب استعمل زر «نقل» في بطاقته" : undefined}>
                  <option value="">بلا حلقة بعد</option>
                  {usable.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.studentCount}/{settings.maxStudentsPerCircle})</option>)}
                </select>
              </Field>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="muted" style={{ fontSize: ".85rem", marginBottom: 4 }}>اتجاه الحفظ</legend>
              <div className="radio-row">
                {(["descending", "ascending"] as Direction[]).map((d) => (
                  <label key={d}><input type="radio" name="direction" checked={direction === d} onChange={() => changeDirection(d)} />{DIRECTION_LABELS[d]}</label>
                ))}
              </div>
            </fieldset>
            {!editing && <p className="muted" style={{ margin: 0 }}>بعد إضافة الطالب، ضع خطة الشهر المطلوب من زر «خطة الشهر» في بطاقته.</p>}
            <div className="form-grid two">
              <Field label="موضع الحفظ الجديد: آخر سورة وصل إليها">
                <select value={surah} onChange={(e) => { setSurah(Number(e.target.value)); setAyah(0); }}>
                  {SURAHS.map((s, i) => <option key={s[0]} value={i + 1}>{i + 1}. {s[0]}</option>)}
                </select>
              </Field>
              <Field label="آخر آية حفظها" >
                <input type="number" min={0} max={maxAyah} value={ayah} onChange={(e) => setAyah(Math.max(0, Math.min(maxAyah, Number(e.target.value))))} />
              </Field>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>
              {nextMemorization
                ? `بداية الحفظ القادمة: سورة ${SURAHS[nextMemorization.surah - 1][0]}، آية ${nextMemorization.ayah}. إذا سيبدأ من منتصف السورة، أدخل الآية السابقة في «آخر آية حفظها».`
                : "أتمّ الطالب مسار الحفظ بهذا الاتجاه."}
            </p>
            {student?.hasReviewRecord ? (
              <p className="muted">موضع المراجعة الحالي من آخر تسميع مسجّل؛ لتصحيحه عدّل سجل التسميع.</p>
            ) : (
              <div className="form-grid">
                <label className="check"><input type="checkbox" checked={hasReviewStart} onChange={(e) => setHasReviewStart(e.target.checked)} />تحديد موضع المراجعة الذي وصل إليه الطالب</label>
                {hasReviewStart && <div className="form-grid two">
                  <Field label="آخر سورة راجعها"><select value={reviewSurah} onChange={(e) => { setReviewSurah(Number(e.target.value)); setReviewAyah(1); }}>
                    {SURAHS.map((s, i) => <option key={s[0]} value={i + 1}>{i + 1}. {s[0]}</option>)}
                  </select></Field>
                  <Field label="آخر آية راجعها"><input type="number" required min={1} max={SURAHS[reviewSurah - 1]?.[1] ?? 286} value={reviewAyah} onChange={(e) => setReviewAyah(Number(e.target.value))} /></Field>
                </div>}
              </div>
            )}
            <Field label="آخر دورة أحكام">
              <select name="ajkamCourse" defaultValue={student?.ajkamCourse ?? ""}>
                <option value="">لا يوجد</option>
                {AJKAM_COURSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </>
        )}
        <button className="btn" disabled={busy}>{editing ? "حفظ التعديلات" : "إضافة الطالب"}</button>
      </form>
    </Sheet>
  );
}

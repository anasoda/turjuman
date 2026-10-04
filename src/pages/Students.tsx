import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DIRECTION_LABELS, GENDER_LABELS, RELATION_LABELS } from "@shared/constants";
import { SURAHS } from "@shared/quran-data";
import { planTransfer } from "@shared/transfer-plan";
import { Field, Icons, Sheet, useAction, useUi } from "../components/ui";
import { ContactIcons, ContactRow } from "../components/Contact";
import { StudentImport } from "./StudentImport";
import { StudentForm } from "./StudentForm";
import { StudentPlan } from "./StudentPlan";
import { api } from "../lib/api";
import { initials, useDebounced, useFetch, useWantsNew } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle, Student } from "../lib/types";
import { PhotoControls, StudentTools } from "./StudentExtras";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { countAr, fmtDay, fmtPos, fmtPosPage, STUDENTS_AR, todayIso } from "../lib/format";

const PAGE = 30;

export function Students() {
  const { user } = useMe();
  const { confirm, toast } = useUi();
  const [searchParams] = useSearchParams();
  // لا نعرض للمعلم زر إضافة طالب؛ الإضافة تتطلب حلقة مسندة إليه.
  const canCreate = user.role === "admin" || user.role === "secretary" || user.role === "stage_manager";
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const dq = useDebounced(q);
  const [circleId, setCircleId] = useState("");
  const [items, setItems] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const wantsNew = useWantsNew();
  const [form, setForm] = useState<Student | "new" | null>(wantsNew ? "new" : null);
  const [detail, setDetail] = useState<Student | null>(null);
  const [importing, setImporting] = useState(false);
  const circles = useFetch<{ circles: Circle[] }>("/api/circles");

  const load = useCallback(async (p: number, replace: boolean) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(PAGE) });
      if (dq) qs.set("q", dq);
      if (circleId) qs.set("circleId", circleId);
      const r = await api<{ students: Student[]; total: number }>(`/api/students?${qs}`);
      setItems((prev) => (replace ? r.students : [...prev, ...r.students]));
      setTotal(r.total);
      setPage(p);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  }, [dq, circleId]);

  useEffect(() => { void load(1, true); }, [load]);
  const refresh = () => load(1, true);

  const bulkArchive = async () => {
    if (!total) return;
    const scope = circleId ? `الحلقة المحددة (${total} طالباً)` : `جميع الطلاب (${total} طالباً)`;
    if (!(await confirm({ title: `أرشفة ${scope}؟`, message: "سيختفي الطلاب من القوائم النشطة ويمكن استرجاعهم من الأرشيف.", confirmLabel: "متابعة", danger: true }))) return;
    if (!(await confirm({ title: "تأكيد العملية", message: `سيتم أرشفة ${scope}. لا تستخدم هذا الزر إلا إذا كنت متأكداً.`, confirmLabel: "أرشفة الطلاب", danger: true }))) return;
    const r = await api<{ archived: number }>("/api/students/bulk-archive", { method: "POST", body: { circleId: circleId || null, reason: circleId ? "أرشفة جماعية للحلقة" : "أرشفة جماعية للمركز" } });
    setDetail(null);
    await refresh();
    toast(`تمت أرشفة ${r.archived} طالباً`, "ok");
  };

  return (
    <main className="page">
      <div className="page-head">
        <div><h1>{user.role === "teacher" ? "طلابي" : user.role === "stage_manager" ? "طلاب مرحلتي" : "الطلاب"}</h1><p>{countAr(total, STUDENTS_AR)}</p></div>
      </div>
      <div className="search-row">
        <input className="input" placeholder="ابحث بالاسم أو رقم الهوية" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
        {user.role !== "teacher" && (
          <select className="input" style={{ maxWidth: 170 }} value={circleId} onChange={(e) => setCircleId(e.target.value)} aria-label="الحلقة">
            <option value="">كل الحلقات</option>
            {circles.data?.circles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      {(user.role === "admin" || user.role === "secretary") && total > 0 && <div className="actions">
        <button className="btn ghost danger small" type="button" onClick={() => void bulkArchive()}>{circleId ? "أرشفة طلاب الحلقة" : "أرشفة جميع الطلاب"}</button>
      </div>}
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {items.map((s) => (
          <div key={s.id} className="card row-card">
              <button className="row-main" type="button" onClick={() => setDetail(s)}>
                {s.hasPhoto ? <img src={`/api/students/${s.id}/photo?v=2`} alt={s.name} className="avatar" style={{ objectFit: "cover" }} /> : <span className="avatar">{initials(s.name)}</span>}
                <span className="grow">

                <b>{s.name}</b>
                <small>{s.direction === "descending" ? "↓" : "↑"} {s.circleName ?? "بلا حلقة"} · حفظ: {s.lastAyah ? fmtPos({ surah: s.lastSurah, ayah: s.lastAyah }) : "لم يبدأ"} · مراجعة: {s.reviewSurah ? fmtPos({ surah: s.reviewSurah, ayah: s.reviewAyah! }) : "—"}</small>
              </span>
            </button>
            <ContactIcons cc={s.phoneCc} national={s.phoneNational} label={s.name} subject={`بخصوص الطالب ${s.name}`} />
          </div>
        ))}
        {!loading && !items.length && !error && <div className="empty">لا يوجد طلاب مطابقون.</div>}
      </div>
      {items.length < total && <button className="btn ghost" type="button" disabled={loading} onClick={() => void load(page + 1, false)}>عرض المزيد</button>}
      {canCreate && (
        <div className="fab-row">
          <button className="fab ghost" type="button" onClick={() => setImporting(true)}>{Icons.clipboard}استيراد Excel</button>
          <button className="fab" type="button" onClick={() => setForm("new")}>{Icons.plus}إضافة طالب</button>
        </div>
      )}

      {form && circles.data ? (
        <StudentForm student={form === "new" ? null : form} circles={circles.data.circles} onClose={() => setForm(null)} onSaved={() => { setForm(null); setDetail(null); void refresh(); }} />
      ) : importing && circles.data ? (
        <StudentImport circles={circles.data.circles} onClose={() => setImporting(false)} onDone={() => void refresh()} />
      ) : detail && circles.data ? (
        <StudentDetail student={detail} circles={circles.data.circles} onClose={() => setDetail(null)} onEdit={() => { setForm(detail); }} onChanged={() => { setDetail(null); void refresh(); }} />
      ) : null}
    </main>
  );
}

/* ------------------------------ تفاصيل الطالب وإجراءاته ------------------------------ */
function StudentDetail({ student: s, circles, onClose, onEdit, onChanged }: { student: Student; circles: Circle[]; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { user } = useMe();
  const canEditFully = user.role === "admin" || user.role === "secretary" || user.role === "stage_manager";
  const canEdit = canEditFully || user.role === "teacher";
  // مدير المرحلة كالسكرتير داخل مراحله، لكن الأرشفة وأولياء الأمور للإدارة وحدها
  const isAdminish = user.role === "admin" || user.role === "secretary";
  const [mode, setMode] = useState<"" | "move" | "archive" | "plan">("");
  const surah = SURAHS[s.lastSurah - 1]?.[0] ?? "";
  const full = useFetch<{ student: Student }>(`/api/students/${s.id}`);
  const guardians = full.data?.student.guardians ?? [];
  const photo = full.data?.student.photo;
  const [zoom, setZoom] = useState(false);

  if (mode === "move") return <MoveSheet s={s} circles={circles} onClose={() => setMode("")} onDone={onChanged} />;
  if (mode === "archive") return <ArchiveSheet s={s} onClose={() => setMode("")} onDone={onChanged} />;
  if (mode === "plan") return <StudentPlan student={s} onClose={() => setMode("")} onSaved={onChanged} />;

  return (
    <Sheet title={s.name} onClose={onClose}>
      <div className="sd-hero">
        <button type="button" className="sd-photo" disabled={!photo} onClick={() => setZoom(true)} aria-label={photo ? "عرض الصورة كاملة" : "لا توجد صورة"}>
          {photo ? <img src={photo} alt="" /> : initials(s.name)}
        </button>
        <div className="sd-id">
          <div className="sd-chips">
            <span className="chip">{s.circleName ?? "بلا حلقة"}</span>
            <span className="chip">{GENDER_LABELS[s.gender]}</span>
            <span className="chip">{DIRECTION_LABELS[s.direction]}</span>
          </div>
          {canEdit && <PhotoControls student={s} photo={photo} onUpdated={() => void full.reload()} />}
        </div>
      </div>

      <section className="sd-section">
        <h3>البيانات الشخصية</h3>
        <dl className="sd-grid">
          <div className="sd-tile"><dt>رقم الهوية</dt><dd dir="ltr" style={{ textAlign: "end" }}>{s.nationalId}</dd></div>
          <div className="sd-tile"><dt>الميلاد</dt><dd>{s.birth}</dd></div>
          {full.data?.student.pendingTransfer && <div className="sd-tile wide"><dt>نقل مرتَّب</dt><dd>إلى {full.data.student.pendingTransfer.toCircleName} من {fmtDay(full.data.student.pendingTransfer.effectiveFrom)}</dd></div>}
        </dl>
      </section>

      <section className="sd-section">
        <h3>مسيرة الحفظ</h3>
        <dl className="sd-grid">
          <div className="sd-tile wide"><dt>موضع الحفظ الجديد</dt><dd>سورة {surah}{s.lastAyah ? ` — آية ${s.lastAyah}` : " (لم يبدأ فيها)"}</dd></div>
          <div className="sd-tile wide"><dt>موضع المراجعة</dt><dd>{s.reviewSurah ? fmtPosPage({ surah: s.reviewSurah, ayah: s.reviewAyah! }) : "لم يُحدّد بعد"}</dd></div>
          <div className="sd-tile"><dt>خطة الحفظ لهذا الشهر</dt><dd>{s.monthlyPlanPages} صفحة</dd></div>
          <div className="sd-tile"><dt>خطة المراجعة لهذا الشهر</dt><dd>{s.monthlyReviewPlanPages} صفحة</dd></div>
          <div className="sd-tile"><dt>آخر دورة أحكام</dt><dd>{s.ajkamCourse || "—"}</dd></div>
        </dl>
      </section>

      <section className="sd-section">
        <h3>التواصل</h3>
        {(s.phoneNational || !guardians.length) && (
          <div className="contact-block">
            <ContactRow cc={s.phoneCc} national={s.phoneNational} label={s.name} title="جوال الطالب" subject={`بخصوص الطالب ${s.name}`} />
            {!s.phoneNational && !guardians.length && <small className="muted">لا أرقام تواصل مسجَّلة — أضفها من «تعديل» أو من شاشة «أولياء الأمور».</small>}
          </div>
        )}
        {guardians.map((g) => (
          <div key={g.id} className="contact-block">
            <Link to={`/app/guardians?q=${encodeURIComponent(g.nationalId ?? g.name)}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <ContactRow cc={g.waCc} national={g.waNational} callNational={g.callPhone} label={g.name}
                title={`${RELATION_LABELS[g.relation]}: ${g.name}`} subject={`بخصوص الطالب ${s.name}`}
                templates={{ guardian: g.name, students: [{ name: s.name, circle: s.circleName, memorized: s.memorizedParts, plan: s.monthlyPlanPages,
                  position: `سورة ${surah}${s.lastAyah ? ` — آية ${s.lastAyah}` : ""}` }] }} />
            </Link>
          </div>
        ))}
      </section>

      {canEdit && (
        <section className="sd-section">
          <h3>الإجراءات</h3>
          <div className="actions">
            <button className="btn small" type="button" onClick={() => setMode("plan")}>خطة الشهر</button>
            <button className="btn small" type="button" onClick={onEdit}>تعديل</button>
          </div>
          <StudentTools student={s} canHonor={isAdminish} section="print" />
          <div className="actions">
            <StudentTools student={s} canHonor={isAdminish} section="manage" />
            {canEditFully && <button className="btn ghost small" type="button" onClick={() => setMode("move")}>نقل إلى حلقة أخرى</button>}
            {isAdminish && <Link className="btn ghost small" to="/app/guardians">أولياء الأمور</Link>}
          </div>
          {isAdminish && <div className="sd-danger"><button className="btn ghost danger small" type="button" onClick={() => setMode("archive")}>أرشفة الطالب</button></div>}
        </section>
      )}
      {zoom && photo && <PhotoLightbox src={photo} alt={`صورة ${s.name}`} onClose={() => setZoom(false)} />}
    </Sheet>
  );
}

function MoveSheet({ s, circles, onClose, onDone }: { s: Student; circles: Circle[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const { settings, user } = useMe();
  const options = circles.filter((c) => c.active && c.category === s.gender && c.id !== s.circleId);
  const [to, setTo] = useState(options[0]?.id ?? "");
  const [reason, setReason] = useState("");
  // طالب بلا حلقة يُوزَّع فوراً؛ من له حلقة يخضع لقاعدة الشهر (يُرتَّب من اليوم 25 ويسري من أول الشهر التالي)
  const plan = s.circleId ? planTransfer(todayIso(), user.role, reason) : null;
  const needsReason = !!plan && (plan.kind === "immediate" || (plan.kind === "denied" && plan.status === 400));
  const blocked = !!plan && plan.kind === "denied" && plan.status === 403;
  const done = plan?.kind === "arranged" ? `رُتّب النقل ويسري من ${fmtDay(plan.effectiveFrom)}` : "تم نقل الطالب";
  return (
    <Sheet title={`نقل ${s.name}`} onClose={onClose}>
      {options.length === 0 ? <p className="muted">لا توجد حلقة فعّالة أخرى من نفس الفئة.</p> : blocked ? (
        <div className="error-box">{plan!.kind === "denied" ? plan!.message : ""}</div>
      ) : (
        <>
          <Field label="الحلقة الجديدة">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.studentCount}/{settings.maxStudentsPerCircle})</option>)}
            </select>
          </Field>
          {plan?.kind === "arranged" && <p className="muted">يسري النقل من {fmtDay(plan.effectiveFrom)}؛ يبقى الطالب وسجلات هذا الشهر في حلقته الحالية حتى ذلك اليوم.</p>}
          {needsReason && (
            <Field label="سبب النقل (إجباري)" hint="النقل قبل اليوم 25 استثناء من مدير المركز ويسري فوراً؛ سجلاته السابقة تبقى في الحلقة القديمة.">
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            </Field>
          )}
          <button className="btn" disabled={busy || !to || (needsReason && reason.trim().length < 3)} onClick={async () => {
            if (await run(() => api(`/api/students/${s.id}/move`, { method: "POST", body: { circleId: to, reason: reason.trim() } }), done)) onDone();
          }}>{plan?.kind === "arranged" ? "ترتيب النقل" : "نقل"}</button>
        </>
      )}
    </Sheet>
  );
}

function ArchiveSheet({ s, onClose, onDone }: { s: Student; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const { confirm } = useUi();
  return (
    <Sheet title={`أرشفة ${s.name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={async (e) => {
        e.preventDefault();
        const reason = String(new FormData(e.currentTarget).get("reason"));
        if (!(await confirm({ title: "تأكيد الأرشفة", message: "يُنقل الطالب إلى الأرشيف ويُوقف حسابه، ويمكن استرجاعه لاحقاً.", confirmLabel: "أرشفة", danger: true }))) return;
        if (await run(() => api(`/api/students/${s.id}/archive`, { method: "POST", body: { reason } }), "تمت الأرشفة")) onDone();
      }}>
        <Field label="سبب الأرشفة أو الانقطاع"><textarea name="reason" required minLength={2} placeholder="مثال: انتقل إلى مدينة أخرى" /></Field>
        <button className="btn danger" disabled={busy}>أرشفة الطالب</button>
      </form>
    </Sheet>
  );
}

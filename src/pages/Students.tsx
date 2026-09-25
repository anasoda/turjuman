import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DIRECTION_LABELS, GENDER_LABELS, RELATION_LABELS } from "@shared/constants";
import { SURAHS } from "@shared/quran-data";
import { Field, Icons, Sheet, useAction, useUi } from "../components/ui";
import { ContactIcons, ContactRow } from "../components/Contact";
import { StudentImport } from "./StudentImport";
import { StudentForm } from "./StudentForm";
import { api } from "../lib/api";
import { initials, useDebounced, useFetch, useWantsNew } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle, Student } from "../lib/types";
import { StudentTools } from "./StudentExtras";
import { countAr, PARTS_AR, STUDENTS_AR } from "../lib/format";

const PAGE = 30;

export function Students() {
  const { user } = useMe();
  const canCreate = user.role === "admin" || user.role === "secretary" || user.role === "teacher" || user.role === "stage_manager";
  const [q, setQ] = useState("");
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
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {items.map((s) => (
          <div key={s.id} className="card row-card">
            <button className="row-main" type="button" onClick={() => setDetail(s)}>
              <span className="avatar">{initials(s.name)}</span>
              <span className="grow">
                <b>{s.name}</b>
                <small>{s.direction === "descending" ? "↓" : "↑"} {s.circleName ?? "بلا حلقة"} · {countAr(s.memorizedParts, PARTS_AR)} · خطة {s.monthlyPlanPages} ص/شهر</small>
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

      {form && circles.data && (
        <StudentForm student={form === "new" ? null : form} circles={circles.data.circles} onClose={() => setForm(null)} onSaved={() => { setForm(null); setDetail(null); void refresh(); }} />
      )}
      {importing && circles.data && <StudentImport circles={circles.data.circles} onClose={() => setImporting(false)} onDone={() => void refresh()} />}
      {detail && circles.data && (
        <StudentDetail student={detail} circles={circles.data.circles} onClose={() => setDetail(null)} onEdit={() => { setForm(detail); }} onChanged={() => { setDetail(null); void refresh(); }} />
      )}
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
  const [mode, setMode] = useState<"" | "move" | "archive">("");
  const surah = SURAHS[s.lastSurah - 1]?.[0] ?? "";
  const full = useFetch<{ student: Student }>(`/api/students/${s.id}`);
  const guardians = full.data?.student.guardians ?? [];

  if (mode === "move") return <MoveSheet s={s} circles={circles} onClose={() => setMode("")} onDone={onChanged} />;
  if (mode === "archive") return <ArchiveSheet s={s} onClose={() => setMode("")} onDone={onChanged} />;

  return (
    <Sheet title={s.name} onClose={onClose}>
      <dl className="kv">
        <dt>الحلقة</dt><dd>{s.circleName ?? "—"}</dd>
        <dt>رقم الهوية</dt><dd dir="ltr" style={{ textAlign: "end" }}>{s.nationalId}</dd>
        <dt>الميلاد</dt><dd>{s.birth}</dd>
        <dt>الجنس</dt><dd>{GENDER_LABELS[s.gender]}</dd>
        <dt>اتجاه الحفظ</dt><dd>{DIRECTION_LABELS[s.direction]}</dd>
        <dt>المحفوظ</dt><dd>{countAr(s.memorizedParts, PARTS_AR)} مكتملة</dd>
        <dt>آخر موضع</dt><dd>سورة {surah}{s.lastAyah ? ` — آية ${s.lastAyah}` : " (لم يبدأ فيها)"}</dd>
        <dt>الخطة الشهرية</dt><dd>{s.monthlyPlanPages} صفحة</dd>
        <dt>آخر دورة أحكام</dt><dd>{s.ajkamCourse || "—"}</dd>
      </dl>

      <div className="contact-block">
        <ContactRow cc={s.phoneCc} national={s.phoneNational} label={s.name} title="جوال الطالب" subject={`بخصوص الطالب ${s.name}`} />
        {!s.phoneNational && !guardians.length && <small className="muted">لا أرقام تواصل مسجَّلة — أضفها من «تعديل» أو من شاشة «أولياء الأمور».</small>}
      </div>

      {!!guardians.length && (
        <div className="contact-block">
          <b>ولي الأمر</b>
          {guardians.map((g) => (
            <ContactRow key={g.id} cc={g.waCc} national={g.waNational} callNational={g.callPhone} label={g.name}
              title={`${RELATION_LABELS[g.relation]}: ${g.name}`} subject={`بخصوص الطالب ${s.name}`} />
          ))}
        </div>
      )}
      {canEdit && <StudentTools student={s} canHonor={isAdminish} onChanged={onChanged} />}
      <div className="actions">
        {canEdit && <button className="btn small" type="button" onClick={onEdit}>تعديل</button>}
        {canEditFully && <button className="btn ghost small" type="button" onClick={() => setMode("move")}>نقل إلى حلقة أخرى</button>}
        {isAdminish && <Link className="btn ghost small" to="/app/guardians">أولياء الأمور</Link>}
        {isAdminish && <button className="btn ghost danger small" type="button" onClick={() => setMode("archive")}>أرشفة</button>}
      </div>
    </Sheet>
  );
}

function MoveSheet({ s, circles, onClose, onDone }: { s: Student; circles: Circle[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const { settings } = useMe();
  const options = circles.filter((c) => c.active && c.category === s.gender && c.id !== s.circleId);
  const [to, setTo] = useState(options[0]?.id ?? "");
  return (
    <Sheet title={`نقل ${s.name}`} onClose={onClose}>
      {options.length === 0 ? <p className="muted">لا توجد حلقة فعّالة أخرى من نفس الفئة.</p> : (
        <>
          <Field label="الحلقة الجديدة">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.studentCount}/{settings.maxStudentsPerCircle})</option>)}
            </select>
          </Field>
          <button className="btn" disabled={busy || !to} onClick={async () => { if (await run(() => api(`/api/students/${s.id}/move`, { method: "POST", body: { circleId: to } }), "تم نقل الطالب")) onDone(); }}>نقل</button>
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

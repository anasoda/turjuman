import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isQueued } from "../lib/api";

/* ---------- ورقة منبثقة (Sheet): بديل نوافذ prompt/alert ---------- */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- إشعارات وتأكيد ---------- */
interface ConfirmOpts { title: string; message?: string; confirmLabel?: string; danger?: boolean }
interface UiValue {
  toast: (message: string, kind?: "ok" | "err") => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}
const UiCtx = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toastState, setToast] = useState<{ message: string; kind: "ok" | "err" } | null>(null);
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const timer = useRef<number>(0);

  const toast = useCallback((message: string, kind: "ok" | "err" = "ok") => {
    setToast({ message, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })), []);
  const close = (v: boolean) => { pending?.resolve(v); setPending(null); };

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      {toastState && <div className={`toast ${toastState.kind === "err" ? "err" : ""}`} role="status">{toastState.message}</div>}
      {pending && (
        <Sheet title={pending.title} onClose={() => close(false)}>
          {pending.message && <p className="muted" style={{ margin: 0 }}>{pending.message}</p>}
          <div className="actions">
            <button className={`btn ${pending.danger ? "danger" : ""}`} type="button" onClick={() => close(true)}>{pending.confirmLabel ?? "تأكيد"}</button>
            <button className="btn ghost" type="button" onClick={() => close(false)}>إلغاء</button>
          </div>
        </Sheet>
      )}
    </UiCtx.Provider>
  );
}

export function useUi(): UiValue {
  const v = useContext(UiCtx);
  if (!v) throw new Error("useUi خارج UiProvider");
  return v;
}

/* ---------- حقل نموذج ---------- */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** ينفّذ إجراءً غير متزامن ويعرض رسالة الخطأ عبر toast. يعيد true عند النجاح. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await fn();
        if (isQueued(result)) toast(result.reason === "login" ? "انتهت جلستك: حُفظ على الجهاز وسيُرسل بعد تسجيل الدخول" : "حُفظ على الجهاز وسيُرسل تلقائياً عند عودة الاتصال");
        else if (okMessage) toast(okMessage);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : "حدث خطأ", "err");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );
  return { busy, run };
}

/* ---------- أيقونات بسيطة (خطوط) ---------- */
const svg = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const Icons = {
  home: svg("M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"),
  users: svg("M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8M21 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"),
  circle: svg("M12 21a9 9 0 100-18 9 9 0 000 18M12 7v5l3 2"),
  staff: svg("M12 12a4 4 0 100-8 4 4 0 000 8M4 21a8 8 0 0116 0"),
  more: svg("M5 12h.01M12 12h.01M19 12h.01"),
  book: svg("M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M8 7h7"),
  plus: svg("M12 5v14M5 12h14"),
  userPlus: svg("M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M19 8v6M22 11h-6"),
  check: svg("M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9"),
  mic: svg("M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v1a7 7 0 01-14 0v-1M12 18v4"),
  award: svg("M12 15a6 6 0 100-12 6 6 0 000 12zM8.2 13.9L7 22l5-3 5 3-1.2-8.1"),
  chart: svg("M3 3v18h18M8 17V11M13 17V7M18 17v-4"),
  megaphone: svg("M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15.5 8.5a5 5 0 010 7M18.4 5.6a9 9 0 010 12.8"),
  clipboard: svg("M9 3h6a1 1 0 011 1v2H8V4a1 1 0 011-1zM16 5h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h2M9 13l2 2 4-4"),
  calendar: svg("M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"),
  scroll: svg("M8 21h12a2 2 0 002-2v-2H10v2a2 2 0 11-4 0V5a2 2 0 00-2-2 2 2 0 00-2 2v3h4M19 17V5a2 2 0 00-2-2H4"),
  sun: svg("M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 11-8 0 4 4 0 018 0z"),
  moon: svg("M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"),
  phone: svg("M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"),
  chat: svg("M21 11.5a8.4 8.4 0 01-9 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.2a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 018.5-8.5h.5a8.5 8.5 0 018 8z"),
  login: svg("M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h4M14 7l-5 5 5 5M9 12h12")
};

/** حلقة زخرفية (نجوم صغيرة على دائرة) تدور حول الشعار. */
export function StarRing() {
  const angles = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="100" cy="100" r="96" strokeWidth="1" strokeDasharray="2 5" opacity=".7" />
      <circle cx="100" cy="100" r="88" strokeWidth=".8" opacity=".45" />
      {angles.map((a) => (
        <path key={a} transform={`rotate(${a} 100 100)`} d="M100 4l3 6-3 6-3-6z" fill="currentColor" stroke="none" opacity={a % 45 === 0 ? 1 : 0.55} />
      ))}
    </svg>
  );
}

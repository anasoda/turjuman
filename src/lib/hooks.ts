import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, SYNC_UPDATED_EVENT } from "./api";

/** يجلب مساراً عند التحميل ويوفّر reload. لا كاش؛ الترقيم والبحث بتغيير المسار. */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    window.addEventListener(SYNC_UPDATED_EVENT, load);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, load);
  }, [load]);

  return { data, error, loading, reload: load };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const initials = (name: string) => name.trim().charAt(0) || "؟";

/** يفتح نموذج الإضافة مباشرة عند الوصول برابط ‎?new=1‎ (من اختصارات الرئيسية)، ثم يحذف المعامل من الرابط. */
export function useWantsNew(): boolean {
  const [params, setParams] = useSearchParams();
  const [wants] = useState(() => params.has("new"));
  useEffect(() => {
    if (!params.has("new")) return;
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, setParams]);
  return wants;
}

/**
 * حالة تُحفظ في عنوان الصفحة (?key=value) بدل الذاكرة فقط: تبقى بعد التحديث (refresh) وتُشارَك بالرابط.
 * تُكتب بـ replace كي لا يمتلئ سجل التصفح. القيمة الافتراضية لا تُكتب في العنوان.
 */
export function useUrlState(key: string, initial = ""): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.has(key) ? params.get(key)! : initial;
  const set = useCallback((next: string) => {
    // من العنوان الحالي لا من لقطة العرض: استدعاءان متتاليان (مثل البحث ثم تصفير الصفحة) لا يمحو أحدهما الآخر
    const copy = new URLSearchParams(window.location.search);
    if (next === initial) copy.delete(key); else copy.set(key, next);
    setParams(copy, { replace: true });
  }, [key, initial, setParams]);
  return [value, set];
}

/** رقم الصفحة في العنوان (?page=2)؛ الصفحة 1 لا تُكتب. */
export function useUrlPage(key = "page"): [number, (page: number) => void] {
  const [raw, setRaw] = useUrlState(key, "1");
  const page = Math.max(1, Number(raw) || 1);
  return [page, (next: number) => setRaw(String(Math.max(1, next)))];
}

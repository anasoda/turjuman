// الوضع الليلي: يتبع النظام افتراضياً ويمكن تثبيته يدوياً (يُحفظ في الجهاز).
const KEY = "tq-theme";
export type ThemeMode = "system" | "light" | "dark";

export function getTheme(): ThemeMode {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}

export function applyTheme(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0b1510" : "#053d24");
}

export function setTheme(mode: ThemeMode) {
  try { mode === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, mode); } catch { /* تجاهل */ }
  applyTheme(mode);
}

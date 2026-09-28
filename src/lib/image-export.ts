import { toBlob } from "html-to-image";

/**
 * يحفظ عنصراً من الصفحة كصورة PNG (بدل PDF/طباعة): تقرير الطالب وصفحة إنجازه وتقارير المحفّظ.
 * على الجوال يُعرض خيار المشاركة (واتساب…) إن دعمه الجهاز، وإلا تُنزَّل الصورة.
 * العناصر بالصنف `no-image` تُستثنى (الأزرار).
 */
export async function saveAsImage(node: HTMLElement, filename: string): Promise<"shared" | "downloaded"> {
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const blob = await toBlob(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: bg,
    filter: (el) => !(el instanceof HTMLElement && el.classList.contains("no-image"))
  });
  if (!blob) throw new Error("تعذّر إنشاء الصورة");
  const name = filename.endsWith(".png") ? filename : `${filename}.png`;
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      // إلغاء المستخدم لنافذة المشاركة ليس خطأً؛ نعود للتنزيل
      if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

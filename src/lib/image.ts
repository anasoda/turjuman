/** يصغّر صورة إلى أقصى بُعد محدد ويضغطها WebP (للشعار والصور الشخصية). يرمي رسالة عربية عند الفشل. */
export function compressImage(file: File, opts: { max: number; quality?: number; maxChars?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("اختر ملف صورة"));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("حجم الصورة كبير، اختر صورة أصغر من 8 ميجابايت"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, opts.max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const out = canvas.toDataURL("image/webp", opts.quality ?? 0.8);
      out.length > (opts.maxChars ?? 200_000) ? reject(new Error("تعذّر ضغط الصورة للحجم المناسب، اختر صورة أبسط")) : resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذّر قراءة الصورة")); };
    img.src = url;
  });
}

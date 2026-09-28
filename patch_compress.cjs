const fs = require('fs');
const file = 'src/lib/image.ts';
let code = fs.readFileSync(file, 'utf8');

const replacement = `export function compressImage(file: File, opts: { max: number; quality?: number; maxChars?: number; cropSquare?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("الملف ليس صورة"));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("حجم الصورة كبير جدا"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("تعذر معالجة الصورة"));

      if (opts.cropSquare) {
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        const targetSize = Math.min(opts.max, minDim);
        canvas.width = targetSize;
        canvas.height = targetSize;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
      } else {
        const scale = Math.min(1, opts.max / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      
      URL.revokeObjectURL(url);
      const out = canvas.toDataURL("image/webp", opts.quality ?? 0.8);
      out.length > (opts.maxChars ?? 200_000) ? reject(new Error("الصورة لا تزال كبيرة بعد الضغط")) : resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("خطأ في قراءة الصورة")); };
    img.src = url;
  });
}`;

code = code.replace(/export function compressImage[\s\S]*\}\s*$/, replacement + '\n');
fs.writeFileSync(file, code);

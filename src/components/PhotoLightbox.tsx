import { useEffect, useRef } from "react";

/** عرض الصورة كاملة بحجم كبير فوق كل شيء؛ Esc أو النقر خارجها أو زر الإغلاق يغلقها دون إغلاق ما تحتها. */
export function PhotoLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // مرحلة الالتقاط: كي لا يصل Esc إلى الورقة التي تحتها فتُغلق معها
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button ref={closeRef} className="lightbox-close" type="button" onClick={onClose} aria-label="إغلاق الصورة">×</button>
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

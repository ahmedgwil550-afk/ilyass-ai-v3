import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, Share2, X } from "lucide-react";

export async function shareImage(src: string, name: string) {
  const blob = await (await fetch(src)).blob();
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "ILYASS AI" });
  else saveImage(src, name);
}
export function saveImage(src: string, name: string) {
  const a = document.createElement("a");
  a.href = src; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
export async function openImage(src: string) {
  const url = URL.createObjectURL(await (await fetch(src)).blob());
  window.open(url, "_blank", "noopener");
}

export default function ImageViewer({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const btn = "rounded-full bg-background/20 p-2.5 text-foreground backdrop-blur hover:bg-background/40";
  return createPortal(
    <div className="dark fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 p-4" onClick={onClose}>
      <div className="absolute right-4 top-4 flex gap-2" onClick={e => e.stopPropagation()}>
        <button className={btn} onClick={() => openImage(src)} aria-label="Ouvrir"><ExternalLink className="h-5 w-5" /></button>
        <button className={btn} onClick={() => saveImage(src, name)} aria-label="Enregistrer"><Download className="h-5 w-5" /></button>
        <button className={btn} onClick={() => shareImage(src, name).catch(() => {})} aria-label="Partager"><Share2 className="h-5 w-5" /></button>
        <button className={btn} onClick={onClose} aria-label="Fermer"><X className="h-5 w-5" /></button>
      </div>
      <img src={src} alt="Image agrandie" className="max-h-[92vh] max-w-full rounded-xl object-contain" onClick={e => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

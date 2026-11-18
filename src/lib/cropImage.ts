import { cropRect, type Box } from "@/lib/recognition";

/** يقصّ منطقة نسبية من صورة (data URL) ويعيدها JPEG؛ يرمي إن تعذّر القصّ أو كانت المنطقة ضئيلة */
export async function cropDataUrl(dataUrl: string, box: Box, pad = 0.015): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image-load-failed"));
    el.src = dataUrl;
  });
  const { sx, sy, sw, sh } = cropRect(box, img.naturalWidth, img.naturalHeight, pad);
  if (sw < 40 || sh < 40) throw new Error("crop-too-small");
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no-canvas");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/jpeg", 0.92);
}

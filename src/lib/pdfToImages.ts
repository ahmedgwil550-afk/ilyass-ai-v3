import * as pdfjsLib from "pdfjs-dist";

// Use CDN worker to avoid bundling issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PdfConversionResult {
  pageImages: string[]; // base64 data URLs
  totalPages: number;
}

/**
 * Convert all pages of a PDF file to images (base64 data URLs).
 * Each page is rendered at a reasonable resolution for AI analysis.
 */
export async function pdfToImages(
  file: File,
  onProgress?: (page: number, total: number) => void,
  maxWidth = 1400,
  quality = 0.8
): Promise<PdfConversionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const pageImages: string[] = [];

  for (let i = 1; i <= totalPages; i++) {
    onProgress?.(i, totalPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / viewport.width, 2);
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
    pageImages.push(canvas.toDataURL("image/jpeg", quality));
    canvas.remove();
  }

  return { pageImages, totalPages };
}

/**
 * Extract base64 (without data URL prefix) from a data URL
 */
export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1];
}

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, ExternalLink, ImageIcon, PenLine, Share2 } from "lucide-react";
import ImageViewer, { openImage, saveImage, shareImage } from "./ImageViewer";
import { annotateSheet } from "@/lib/annotateSheet";
import { Button } from "@/components/ui/button";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import AnswerImageLoader from "./AnswerImageLoader";
import { useToast } from "@/hooks/use-toast";

// Renders the answer locally to PNG: exact math/tables, no extra AI request or cost.
export default function AnswerImage({ content, lang, id, sheetImage }: { content: string; lang: "ar" | "fr"; id: string; sheetImage?: string }) {
  const [generatingImage, setGeneratingImage] = useState(false);
  const [answerImage, setAnswerImage] = useState<string | null>(null);
  const [mountSheet, setMountSheet] = useState(false);
  const [viewer, setViewer] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const ar = lang === "ar";

  const handleGenerateImage = async () => {
    if (generatingImage) return;
    setGeneratingImage(true);
    setAnswerImage(null);
    setMountSheet(true);
    try {
      await new Promise(r => setTimeout(r, 400)); // let the sheet + KaTeX render
      await document.fonts.ready;
      const node = sheet.current;
      if (!node) throw new Error("sheet missing");
      const data = await toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true, width: node.scrollWidth, height: node.scrollHeight });
      setAnswerImage(data);
    } catch (error) {
      console.error("Answer image export failed", error);
      toast({ title: ar ? "تعذر إنشاء الصورة" : "Impossible de créer l’image", variant: "destructive" });
    } finally {
      setGeneratingImage(false);
      setMountSheet(false);
    }
  };

  const name = `ILYASS-AI-reponse-${id}.png`;
  const handleSolveOnSheet = async () => {
    if (!sheetImage || generatingImage) return;
    setGeneratingImage(true);
    setAnswerImage(null);
    try { setAnswerImage(await annotateSheet(sheetImage, content)); }
    catch (error) {
      console.error("Sheet annotation failed", error);
      toast({ title: ar ? "تعذر كتابة الحل على الورقة" : "Impossible d’écrire sur la feuille", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setGeneratingImage(false); }
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex justify-end gap-2">
        {sheetImage && (
          <Button type="button" variant="ghost" size="sm" disabled={generatingImage} onClick={handleSolveOnSheet} className="gap-1.5 text-xs text-muted-foreground">
            <PenLine className="h-4 w-4" />{ar ? "حل على الورقة" : "Sur la feuille"}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={generatingImage} onClick={handleGenerateImage} className="gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="h-4 w-4" />{ar ? "إنشاء صورة الحل" : "Créer l’image"}
        </Button>
      </div>
      {generatingImage && <AnswerImageLoader label={ar ? "جاري رسم الحل..." : "Sketching it out"} />}
      {answerImage && !generatingImage && (
        <div className="overflow-hidden rounded-2xl border border-border">
          <img src={answerImage} alt={ar ? "صورة الحل" : "Image de la solution"} className="block w-full cursor-zoom-in" onClick={() => setViewer(true)} />
          <div className="flex justify-center gap-1 border-t border-border bg-muted/30 p-1 text-xs">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => openImage(answerImage)}><ExternalLink className="h-4 w-4" />{ar ? "فتح" : "Ouvrir"}</Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => saveImage(answerImage, name)}><Download className="h-4 w-4" />{ar ? "حفظ" : "Enregistrer"}</Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => shareImage(answerImage, name).catch(() => {})}><Share2 className="h-4 w-4" />{ar ? "مشاركة" : "Partager"}</Button>
          </div>
        </div>
      )}
      {viewer && answerImage && <ImageViewer src={answerImage} name={name} onClose={() => setViewer(false)} />}
      {mountSheet && (
        <div aria-hidden="true" className="answer-export-stage">
          <div ref={sheet} className="answer-sheet">
            <header className="answer-sheet-header"><strong>ILYASS AI</strong><span>Correction / Réponses</span></header>
            <section className="answer-sheet-body"><MarkdownRenderer content={content} /></section>
          </div>
        </div>
      )}
    </div>
  );
}

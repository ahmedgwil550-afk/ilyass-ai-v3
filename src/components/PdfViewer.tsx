import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, FileText, X, Loader2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

interface PdfViewerProps {
  file: File;
  pageImages: string[];
  currentPage: number;
  totalPages: number;
  isConverting: boolean;
  analyzingPage?: number;
  onPageChange: (page: number) => void;
  onRemove: () => void;
}

const PdfViewer = ({
  file,
  pageImages,
  currentPage,
  totalPages,
  isConverting,
  analyzingPage,
  onPageChange,
  onRemove,
}: PdfViewerProps) => {
  const { lang } = useLanguage();

  return (
    <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium truncate max-w-[200px]">{file.name}</span>
          <span className="text-xs text-muted-foreground">
            ({totalPages} {lang === "ar" ? "صفحات" : "pages"})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {analyzingPage !== undefined && (
            <span className="flex items-center gap-1.5 text-xs text-primary animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              {lang === "ar" ? `تحليل الصفحة ${analyzingPage}` : `Analyse page ${analyzingPage}`}
            </span>
          )}
          <button onClick={onRemove} className="rounded-full p-1 hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Page display */}
      <div className="relative flex items-center justify-center bg-muted/30 p-4" style={{ minHeight: 200 }}>
        {isConverting ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              {lang === "ar" ? "جاري تحويل الصفحات..." : "Conversion des pages..."}
            </span>
          </div>
        ) : pageImages[currentPage - 1] ? (
          <img
            src={pageImages[currentPage - 1]}
            alt={`Page ${currentPage}`}
            className="max-h-[400px] w-auto rounded-lg shadow-md object-contain"
          />
        ) : null}
      </div>

      {/* Navigation */}
      {totalPages > 1 && !isConverting && (
        <div className="flex items-center justify-center gap-4 border-t border-border px-4 py-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="rounded-full p-1.5 hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="rounded-full p-1.5 hover:bg-muted transition-colors disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default PdfViewer;

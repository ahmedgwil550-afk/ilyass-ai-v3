import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw, ScanLine } from "lucide-react";
import {
  detectPageBoundaries,
  isOpenCvReady,
  type PageBoundaryCandidate,
} from "@/lib/opencvPageDetection";
import { detectPageBoundariesJs } from "@/lib/jsPageDetection";
import { detectLivePage, smoothCorners, type LivePageDetectors } from "@/lib/livePageDetection";
import { getContainGeometry } from "@/lib/cameraOverlayGeometry";
import { Button } from "@/components/ui/button";

/** Frame colours match the reference scanner: mint-green fill with a thin solid edge. */
const FRAME_STROKE = "rgb(62, 207, 165)";
const FRAME_FILL = "rgba(62, 207, 165, 0.26)";
/** Live frames are analysed at a reduced size so detection stays fast on phones. */
const LIVE_ANALYSIS_SIDE = 640;
const ANALYSIS_INTERVAL_MS = 400;

/**
 * The camera never loads OpenCV itself. Its runtime is a very large dynamic
 * import, and the app's root guard reloads the whole page when a dynamic import
 * fails, which would close the camera seconds after it opens. The built-in
 * detector draws the frame; OpenCV is used only if an earlier photo upload in
 * this session has already loaded it.
 */
const LIVE_DETECTORS: LivePageDetectors = {
  opencvReady: isOpenCvReady,
  opencv: detectPageBoundaries,
  js: detectPageBoundariesJs,
};

interface LivePageCameraProps {
  lang: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function LivePageCamera({ lang, onCapture, onClose }: LivePageCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const smoothedCornersRef = useRef<PageBoundaryCandidate["corners"] | null>(null);
  const missedFramesRef = useRef(0);
  const mountedRef = useRef(true);
  const warnedOpenCvRef = useRef(false);
  const [detectorFailed, setDetectorFailed] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [ready, setReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [candidate, setCandidate] = useState<PageBoundaryCandidate | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const isArabic = lang === "ar";

  // Keep overlay geometry in the same CSS-pixel space as the cover-cropped video.
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const containGeometry = getContainGeometry(
    dimensions.width,
    dimensions.height,
    previewSize.width,
    previewSize.height,
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let timer = 0;

    const start = async () => {
      setCameraError("");
      setReady(false);
      setCandidate(null);
      smoothedCornersRef.current = null;
      missedFramesRef.current = 0;
      stopCamera();
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("CAMERA_UNAVAILABLE");
        }
        const viewportAspect = previewSize.width && previewSize.height
          ? previewSize.width / previewSize.height
          : window.innerWidth / window.innerHeight;
        const portrait = viewportAspect < 1;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: portrait ? 1080 : 1920 },
            height: { ideal: portrait ? 1920 : 1080 },
            aspectRatio: { ideal: viewportAspect },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error("VIDEO_UNAVAILABLE");
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
        setReady(true);

        const analyze = async () => {
          if (cancelled || !mountedRef.current) return;
          const currentVideo = videoRef.current;
          if (!currentVideo || currentVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || busyRef.current) {
            timer = window.setTimeout(analyze, ANALYSIS_INTERVAL_MS);
            return;
          }
          busyRef.current = true;
          setAnalyzing(true);
          try {
            const scale = Math.min(1, LIVE_ANALYSIS_SIDE / Math.max(currentVideo.videoWidth, currentVideo.videoHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(96, Math.round(currentVideo.videoWidth * scale));
            canvas.height = Math.max(96, Math.round(currentVideo.videoHeight * scale));
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (context) {
              context.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
              const result = await detectLivePage(
                context.getImageData(0, 0, canvas.width, canvas.height),
                LIVE_DETECTORS,
              );
              if (result.opencvError && !warnedOpenCvRef.current) {
                warnedOpenCvRef.current = true;
                console.warn("OpenCV page detection failed; using the built-in detector:", result.opencvError);
              }
              if (!cancelled && mountedRef.current) {
                setDetectorFailed(false);
                const best = result.candidate;
                if (best) {
                  // Map detector coordinates to video pixels and smooth frame-to-frame jitter.
                  const nextCorners = best.corners.map((point) => ({
                    x: point.x / scale,
                    y: point.y / scale,
                  })) as PageBoundaryCandidate["corners"];
                  const smoothed = smoothCorners(smoothedCornersRef.current, nextCorners, {
                    alpha: 0.5,
                    resetDistance: Math.hypot(currentVideo.videoWidth, currentVideo.videoHeight) * 0.1,
                  });
                  smoothedCornersRef.current = smoothed;
                  missedFramesRef.current = 0;
                  setCandidate({ ...best, corners: smoothed });
                } else {
                  // Ignore a couple of missed frames to prevent flicker during brief blur.
                  missedFramesRef.current += 1;
                  if (missedFramesRef.current >= 3) {
                    smoothedCornersRef.current = null;
                    setCandidate(null);
                  }
                }
              }
            }
          } catch (error) {
            // Keep the camera usable even if both detectors fail.
            console.warn("Live page detection unavailable:", error);
            if (!cancelled && mountedRef.current) setDetectorFailed(true);
          } finally {
            busyRef.current = false;
            if (!cancelled && mountedRef.current) setAnalyzing(false);
            if (!cancelled && mountedRef.current) timer = window.setTimeout(analyze, ANALYSIS_INTERVAL_MS);
          }
        };
        timer = window.setTimeout(analyze, 250);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "";
          setCameraError(message === "CAMERA_UNAVAILABLE"
            ? (isArabic ? "هذا المتصفح لا يدعم تشغيل الكاميرا." : "Ce navigateur ne prend pas en charge la caméra.")
            : (isArabic ? "تعذّر تشغيل الكاميرا. تحقق من الإذن ثم حاول مجدداً." : "Impossible d’ouvrir la caméra. Vérifiez l’autorisation puis réessayez."));
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [facingMode, isArabic, stopCamera]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopCamera();
  }, [stopCamera]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `ilyass-scan-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopCamera();
      onCapture(file);
    }, "image/jpeg", 0.94);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" dir={isArabic ? "rtl" : "ltr"}>
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={isArabic ? "إغلاق الكاميرا" : "Fermer la caméra"} className="rounded-full text-white hover:bg-white/10 hover:text-white">
          <X className="h-6 w-6" />
        </Button>
        <div className="flex items-center gap-2 text-sm font-medium">
          <ScanLine className="h-4 w-4 text-emerald-400" />
          {isArabic ? "مسح الورقة" : "Scanner une feuille"}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => setFacingMode((value) => value === "environment" ? "user" : "environment")} aria-label={isArabic ? "تبديل الكاميرا" : "Changer de caméra"} className="rounded-full text-white hover:bg-white/10 hover:text-white">
          <RefreshCw className="h-5 w-5" />
        </Button>
      </header>

      <main className="relative flex min-h-0 flex-1 overflow-hidden bg-black">
        <div ref={previewRef} className="relative h-full w-full overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-contain"
          />
          {ready && dimensions.width > 0 && candidate && containGeometry && previewSize.width > 0 && (
            <svg
              viewBox={`0 0 ${previewSize.width} ${previewSize.height}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <polygon
                points={candidate.corners.map((point) => `${point.x * containGeometry.scale + containGeometry.offsetX},${point.y * containGeometry.scale + containGeometry.offsetY}`).join(" ")}
                fill={FRAME_FILL}
                stroke={FRAME_STROKE}
                strokeWidth={3}
                strokeLinejoin="round"
              />
            </svg>
          )}
          {!ready && !cameraError && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">{isArabic ? "جارٍ تشغيل الكاميرا…" : "Démarrage de la caméra…"}</p>}
          {cameraError && <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-xl bg-neutral-900/95 p-4 text-center text-sm">{cameraError}</div>}
        </div>
      </main>

      <footer className="flex shrink-0 flex-col items-center gap-4 px-5 pb-8 pt-4">
        <p className="min-h-5 text-center text-sm text-white/80" aria-live="polite">
          {candidate
            ? (isArabic ? "تم اكتشاف الورقة — حافظ على ثبات الهاتف" : "Feuille détectée — gardez le téléphone stable")
            : detectorFailed
              ? (isArabic ? "تعذّر تشغيل التعرّف التلقائي — يمكنك التقاط الصورة مباشرة" : "Détection automatique indisponible — vous pouvez prendre la photo directement")
              : analyzing
                ? (isArabic ? "جارٍ البحث عن حواف الورقة…" : "Recherche des bords de la feuille…")
                : (isArabic ? "وجّه الكاميرا نحو الورقة كاملة" : "Cadrez toute la feuille dans l’image")}
          {analyzing && !candidate && !detectorFailed ? " ·" : ""}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={capture}
          disabled={!ready || !!cameraError}
          aria-label={isArabic ? "التقاط الصورة" : "Prendre la photo"}
          className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-[5px] border-accent bg-primary-foreground text-foreground shadow-[0_0_0_5px_hsl(var(--accent)/0.22)] hover:bg-primary-foreground disabled:opacity-40"
        >
          <Camera className="h-8 w-8 text-foreground" />
        </Button>
      </footer>
    </div>
  );
}

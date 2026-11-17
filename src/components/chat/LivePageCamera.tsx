import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw, ScanLine } from "lucide-react";
import { detectPageBoundaries, type PageBoundaryCandidate } from "@/lib/opencvPageDetection";

interface LivePageCameraProps {
  lang: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function LivePageCamera({ lang, onCapture, onClose }: LivePageCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const smoothedCornersRef = useRef<PageBoundaryCandidate["corners"] | null>(null);
  const missedFramesRef = useRef(0);
  const mountedRef = useRef(true);
  const [cameraError, setCameraError] = useState("");
  const [ready, setReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [candidate, setCandidate] = useState<PageBoundaryCandidate | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const isArabic = lang === "ar";

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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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
            timer = window.setTimeout(analyze, 650);
            return;
          }
          busyRef.current = true;
          setAnalyzing(true);
          try {
            const scale = Math.min(1, 1280 / Math.max(currentVideo.videoWidth, currentVideo.videoHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(96, Math.round(currentVideo.videoWidth * scale));
            canvas.height = Math.max(96, Math.round(currentVideo.videoHeight * scale));
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (context) {
              context.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
              const result = await detectPageBoundaries(context.getImageData(0, 0, canvas.width, canvas.height));
              if (!cancelled && mountedRef.current) {
                const best = result?.candidates[0];
                if (best) {
                  // Map detector coordinates to video pixels and smooth frame-to-frame jitter.
                  const nextCorners = best.corners.map((point) => ({
                    x: point.x / scale,
                    y: point.y / scale,
                  })) as PageBoundaryCandidate["corners"];
                  const previous = smoothedCornersRef.current;
                  const alpha = previous ? 0.42 : 1;
                  const smoothed = nextCorners.map((point, index) => ({
                    x: previous ? previous[index].x + (point.x - previous[index].x) * alpha : point.x,
                    y: previous ? previous[index].y + (point.y - previous[index].y) * alpha : point.y,
                  })) as PageBoundaryCandidate["corners"];
                  smoothedCornersRef.current = smoothed;
                  missedFramesRef.current = 0;
                  setCandidate({ ...best, corners: smoothed });
                } else {
                  // Ignore one missed frame to prevent flicker during brief blur.
                  missedFramesRef.current += 1;
                  if (missedFramesRef.current >= 2) {
                    smoothedCornersRef.current = null;
                    setCandidate(null);
                  }
                }
              }
            }
          } catch (error) {
            // Keep the camera usable even if OpenCV fails to initialize.
            console.warn("Live page detection unavailable:", error);
          } finally {
            busyRef.current = false;
            if (!cancelled && mountedRef.current) setAnalyzing(false);
            if (!cancelled && mountedRef.current) timer = window.setTimeout(analyze, 650);
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
        <button type="button" onClick={onClose} aria-label={isArabic ? "إغلاق الكاميرا" : "Fermer la caméra"} className="rounded-full p-2 hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2 text-sm font-medium">
          <ScanLine className="h-4 w-4 text-emerald-400" />
          {isArabic ? "مسح الورقة" : "Scanner une feuille"}
        </div>
        <button type="button" onClick={() => setFacingMode((value) => value === "environment" ? "user" : "environment")} aria-label={isArabic ? "تبديل الكاميرا" : "Changer de caméra"} className="rounded-full p-2 hover:bg-white/10">
          <RefreshCw className="h-5 w-5" />
        </button>
      </header>

      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-950">
        <div className="relative h-full w-full overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        {ready && dimensions.width > 0 && candidate && (
          <svg
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="pointer-events-none absolute h-auto w-full max-h-full"
            style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}`, width: "auto", height: "100%", maxWidth: "100%" }}
          >
            <polygon
              points={candidate.corners.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="rgba(16,185,129,0.10)"
              stroke="#10b981"
              strokeWidth={Math.max(4, dimensions.width / 360)}
              strokeLinejoin="round"
            />
            {candidate.corners.map((point, index) => (
              <circle key={index} cx={point.x} cy={point.y} r={Math.max(7, dimensions.width / 110)} fill="#10b981" stroke="white" strokeWidth={Math.max(2, dimensions.width / 700)} />
            ))}
          </svg>
        )}
        {!ready && !cameraError && <p className="absolute text-sm text-white/70">{isArabic ? "جارٍ تشغيل الكاميرا…" : "Démarrage de la caméra…"}</p>}
        {cameraError && <div className="absolute mx-6 rounded-xl bg-neutral-900/95 p-4 text-center text-sm">{cameraError}</div>}
        </div>
      </main>

      <footer className="flex shrink-0 flex-col items-center gap-4 px-5 pb-8 pt-4">
        <p className="min-h-5 text-center text-sm text-white/80">
          {candidate
            ? (isArabic ? "تم اكتشاف الورقة — حافظ على ثبات الهاتف" : "Feuille détectée — gardez le téléphone stable")
            : (isArabic ? "وجّه الكاميرا نحو الورقة كاملة" : "Cadrez toute la feuille dans l’image")}
          {analyzing && !candidate ? " ·" : ""}
        </p>
        <button
          type="button"
          onClick={capture}
          disabled={!ready || !!cameraError}
          aria-label={isArabic ? "التقاط الصورة" : "Prendre la photo"}
          className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-[5px] border-emerald-400 bg-white shadow-[0_0_0_5px_rgba(16,185,129,0.2)] disabled:opacity-40"
        >
          <Camera className="h-8 w-8 text-neutral-900" />
        </button>
      </footer>
    </div>
  );
}

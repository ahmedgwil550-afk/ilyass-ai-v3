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

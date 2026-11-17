import { motion } from "framer-motion";

export default function AnswerImageLoader({ label }: { label: string }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border bg-muted/30">
      <div className="relative flex min-h-[260px] items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/10 opacity-40" />
        <div className="relative z-10 flex flex-col items-center gap-5">
          <div className="text-lg font-semibold text-foreground">{label}</div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <motion.span
                key={i}
                className="h-2 w-2 rounded-full bg-primary"
                animate={{ y: [0, -8, 0], opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

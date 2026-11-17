import { forwardRef, useImperativeHandle, useState, memo, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type Suggestion = { label: string; prompt: string; icon?: string };

export interface DynamicSuggestionsHandle {
  setQuery: (q: string) => void;
}

interface Props {
  subject: string;
  lang: "ar" | "fr";
  getSuggestions: (query: string, subject: string, lang: "ar" | "fr") => Suggestion[];
  onPick: (prompt: string) => void;
}

/**
 * Isolated suggestions row. Parent updates it imperatively via ref.setQuery(...)
 * so the parent does not re-render on every keystroke.
 */
const DynamicSuggestions = memo(
  forwardRef<DynamicSuggestionsHandle, Props>(function DynamicSuggestions(
    { subject, lang, getSuggestions, onPick },
    ref,
  ) {
    const [query, setQuery] = useState("");
    useImperativeHandle(ref, () => ({ setQuery }), []);

    const suggestions = useMemo(
      () => getSuggestions(query, subject, lang),
      [query, subject, lang, getSuggestions],
    );

    if (suggestions.length === 0) return null;

    return (
      <div className="flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
        <AnimatePresence mode="popLayout">
          {suggestions.slice(0, 3).map((s) => (
            <motion.button
              key={s.label}
              layout
              initial={{ opacity: 0, scale: 0.85, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: -8 }}
              transition={{ duration: 0.2 }}
              onClick={() => onPick(s.prompt)}
              className="shrink-0 rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm px-4 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground hover:bg-muted/50 active:scale-95"
            >
              {s.icon && <span className="mr-1">{s.icon}</span>}
              {s.label}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    );
  }),
);

export default DynamicSuggestions;

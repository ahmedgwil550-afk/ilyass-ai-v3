import { useAnswerFontSize, ANSWER_FONT_MIN, ANSWER_FONT_MAX, ANSWER_FONT_DEFAULT } from "@/hooks/use-answer-font";
import { AnswerFontSlider } from "@/components/answer/AnswerFontSlider";
import UiScaleControl from "@/components/UiScaleControl";
import { Calculator, Globe, Sun, Moon, LineChart, Shapes } from "lucide-react";
import { MessageIcon, HistoryIcon, TrashIcon, StarGrowIcon, SettingsIcon, CloseIcon, CaptionIcon } from "@/components/icons";
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@/lib/nav";
import { useTheme } from "@/hooks/use-theme";
import { useLanguage } from "@/hooks/use-language";
const aiLogo = "/E2CC92A9-49D9-494A-B24A-B6719AE370F2.png";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatHistoryItem {
  id: string;
  title?: string;
  question?: string;
  subject: string;
  timestamp: number;
  messages?: ChatHistoryMessage[];
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  examMode: boolean;
  onToggleExam: () => void;
}

const ChatSidebar = ({ isOpen, onClose, onNewChat, examMode, onToggleExam }: ChatSidebarProps) => {
  const navigate = useNavigate();
  const { isDark, toggle: toggleTheme } = useTheme();
  const { lang, toggle: toggleLang } = useLanguage();
  const [history, setHistory] = useState<ChatHistoryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [answerFontSize, setAnswerFontSize] = useAnswerFontSize();

  useEffect(() => {
    const raw = localStorage.getItem("ilyass-history");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ChatHistoryItem[];
        const sorted = [...parsed].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setHistory(sorted.slice(0, 30));
      } catch {}
    }
  }, [isOpen]);

  const getHistoryTitle = (item: ChatHistoryItem) => {
    if (item.title?.trim()) return item.title;
    if (item.question?.trim()) return item.question;
    const firstUser = item.messages?.find((m) => m.role === "user")?.content?.trim();
    if (firstUser) return firstUser;
    return lang === "ar" ? "محادثة بدون عنوان" : "Conversation sans titre";
  };

  const clearHistory = () => {
    if (!window.confirm(lang === "ar" ? "هل تريد حذف سجل المحادثات بالكامل؟" : "Effacer tout l'historique des conversations ?")) return;
    localStorage.removeItem("ilyass-history");
    setHistory([]);
  };

  const changeAnswerFontSize = (value: number) => setAnswerFontSize(value);

  const todayItems = history.filter((h) => {
    const diff = Date.now() - h.timestamp;
    return diff < 86400000;
  });

  const olderItems = history.filter((h) => {
    const diff = Date.now() - h.timestamp;
    return diff >= 86400000;
  });

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 z-50 flex h-full w-[280px] flex-col bg-sidebar-background transition-transform duration-300 ease-in-out ${
          lang === "ar" ? "right-0" : "left-0"
        } ${
          isOpen
            ? "translate-x-0"
            : lang === "ar"
            ? "translate-x-full"
            : "-translate-x-full"
        } lg:relative lg:translate-x-0`}
      >
        <div className="flex items-center gap-3 px-4 py-4">
          <img src={aiLogo} alt="ILYASS AI" className="h-8 w-8 rounded-lg" />
          <span className="text-sm font-bold text-sidebar-foreground" style={{ fontFamily: "Poppins, sans-serif" }}>
            ILYASS AI
          </span>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border px-3 py-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
          >
            <MessageIcon size={16} className="h-4 w-4" />
            {lang === "ar" ? "محادثة جديدة" : "Nouveau chat"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {todayItems.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 px-2 text-xs font-medium text-sidebar-foreground/60">
                {lang === "ar" ? "اليوم" : "Aujourd'hui"}
              </p>
              {todayItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onClose();
                    navigate(`/history?id=${item.id}`);
                  }}
                  className="w-full rounded-lg px-2 py-2 text-left text-sm text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent"
                >
                  <p className="truncate">{getHistoryTitle(item)}</p>
                </button>
              ))}
            </div>
          )}

          {olderItems.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 px-2 text-xs font-medium text-sidebar-foreground/60">
                {lang === "ar" ? "سابقاً" : "Précédent"}
              </p>
              {olderItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onClose();
                    navigate(`/history?id=${item.id}`);
                  }}
                  className="w-full rounded-lg px-2 py-2 text-left text-sm text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent"
                >
                  <p className="truncate">{getHistoryTitle(item)}</p>
                </button>
              ))}
            </div>
          )}

          {history.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-sidebar-foreground/30">
              {lang === "ar" ? "لا توجد محادثات سابقة" : "Aucune conversation"}
            </p>
          )}
        </div>

        <div className="border-t border-sidebar-border px-3 py-3 space-y-1">
          <button
            onClick={() => {
              onToggleExam();
              onClose();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              examMode
                ? "bg-sidebar-primary/20 text-sidebar-primary font-medium"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
            }`}
          >
            <StarGrowIcon size={16} className="h-4 w-4" />
            {lang === "ar" ? "وضع الامتحان" : "Mode examen"}
          </button>

          <Link
            to="/history"
            onClick={onClose}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
          >
            <HistoryIcon size={16} className="h-4 w-4" />
            {lang === "ar" ? "السجل" : "Historique"}
          </Link>

          <Link
            to="/calculator"
            onClick={onClose}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
          >
            <Calculator className="h-4 w-4" />
            {lang === "ar" ? "الحاسبة" : "Calculatrice"}
          </Link>

          <Link
            to="/graphing"
            onClick={onClose}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
          >
            <LineChart className="h-4 w-4" />
            {lang === "ar" ? "رسم الدوال" : "Grapheur"}
          </Link>

          <Link
            to="/geometry"
            onClick={onClose}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
          >
            <Shapes className="h-4 w-4" />
            {lang === "ar" ? "الهندسة AI" : "Geometry AI"}
          </Link>

          <button onClick={() => setSettingsOpen(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90">
            <SettingsIcon size={16} className="h-4 w-4" />
            {lang === "ar" ? "الإعدادات" : "Paramètres"}
          </button>
        </div>
      {settingsOpen && createPortal((
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-3 py-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-md" onClick={() => setSettingsOpen(false)}>
          <section role="dialog" aria-modal="true" dir={lang === "ar" ? "rtl" : "ltr"} onClick={(event) => event.stopPropagation()} className="flex h-[min(82dvh,900px)] max-h-full w-[min(94vw,900px)] flex-col overflow-hidden rounded-3xl border border-border bg-background text-foreground shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2.5"><SettingsIcon size={20} className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">{lang === "ar" ? "الإعدادات" : "Paramètres"}</h2></div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label={lang === "ar" ? "إغلاق" : "Fermer"}><CloseIcon size={20} className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6 sm:p-8">
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold"><CaptionIcon size={16} className="h-4 w-4 text-primary" />{lang === "ar" ? "حجم خط الإجابة" : "Taille du texte des réponses"}<span className="ms-auto rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{answerFontSize}px</span></div>
                <AnswerFontSlider value={answerFontSize} min={ANSWER_FONT_MIN} max={ANSWER_FONT_MAX} onChange={changeAnswerFontSize} label={lang === "ar" ? "حجم خط الإجابة" : "Taille du texte"} />
                <div dir="ltr" className="flex justify-between px-1 text-xs text-muted-foreground"><span>{lang === "ar" ? `كبير ${ANSWER_FONT_MAX}px` : `Grand ${ANSWER_FONT_MAX}px`}</span><span>{lang === "ar" ? `صغير ${ANSWER_FONT_MIN}px` : `Petit ${ANSWER_FONT_MIN}px`}</span></div>
                <button type="button" onClick={() => changeAnswerFontSize(ANSWER_FONT_DEFAULT)} className="text-xs font-medium text-primary hover:underline">{lang === "ar" ? `إعادة الحجم الافتراضي ${ANSWER_FONT_DEFAULT}px` : `Réinitialiser à ${ANSWER_FONT_DEFAULT}px`}</button>
              </section>
              <div className="h-px bg-border" />
              <UiScaleControl lang={lang} />
              <div className="h-px bg-border" />
              <section className="space-y-2"><p className="text-sm font-semibold">{lang === "ar" ? "المظهر" : "Apparence"}</p>
                <button type="button" onClick={toggleTheme} className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-sm hover:bg-muted"><span className="flex items-center gap-3">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{lang === "ar" ? "السمة" : "Thème"}</span><span className="text-muted-foreground">{isDark ? (lang === "ar" ? "داكن" : "Sombre") : (lang === "ar" ? "فاتح" : "Clair")}</span></button>
              </section>
              <div className="h-px bg-border" />
              <section className="space-y-2"><p className="text-sm font-semibold">{lang === "ar" ? "اللغة" : "Langue"}</p>
                <button type="button" onClick={toggleLang} className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-sm hover:bg-muted"><span className="flex items-center gap-3"><Globe className="h-4 w-4" />{lang === "ar" ? "لغة التطبيق" : "Langue de l'application"}</span><span className="text-muted-foreground">{lang === "ar" ? "العربية" : "Français"}</span></button>
              </section>
              <div className="h-px bg-border" />
              <section className="space-y-2"><p className="text-sm font-semibold">{lang === "ar" ? "السجل" : "Historique"}</p>
                <Link to="/history" onClick={() => { setSettingsOpen(false); onClose(); }} className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-sm hover:bg-muted"><span className="flex items-center gap-3"><HistoryIcon size={16} className="h-4 w-4" />{lang === "ar" ? "عرض سجل المحادثات" : "Voir l'historique"}</span><span className="text-muted-foreground">{history.length}</span></Link>
                <button type="button" onClick={clearHistory} disabled={history.length === 0} className="flex w-full items-center gap-3 rounded-xl border border-destructive/25 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40"><TrashIcon size={16} className="h-4 w-4" />{lang === "ar" ? "حذف سجل المحادثات" : "Effacer l'historique"}</button>
              </section>
            </div>
          </section>
        </div>
      ), document.body)}
      </aside>
    </>
  );
};

export default ChatSidebar;

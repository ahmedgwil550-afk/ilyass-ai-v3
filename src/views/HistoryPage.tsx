import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, Trash2, Sparkles, Clock, FileText, MessageSquare } from "lucide-react";
import { Link } from "@tanstack/react-router";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { useLanguage } from "@/hooks/use-language";

interface HistoryMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  imagePreviews?: string[];
  pdfName?: string;
  pdfPageCount?: number;
}

interface HistoryEntry {
  id: string;
  title?: string;
  question?: string;
  answer?: string;
  subject: string;
  timestamp: number;
  imagePreview?: string;
  messages?: HistoryMessage[];
}

const HistoryPage = () => {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id"));
  const { lang, t } = useLanguage();

  useEffect(() => {
    const data = JSON.parse(localStorage.getItem("ilyass-history") || "[]") as HistoryEntry[];
    const sorted = [...data].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    setHistory(sorted);
  }, []);

  useEffect(() => {
    setSelectedId(searchParams.get("id"));
  }, [searchParams]);

  const getConversationMessages = (entry: HistoryEntry): HistoryMessage[] => {
    if (Array.isArray(entry.messages) && entry.messages.length > 0) return entry.messages;

    const legacyMessages: HistoryMessage[] = [];
    if (entry.question) {
      legacyMessages.push({
        id: `${entry.id}-user`,
        role: "user",
        content: entry.question,
        imagePreview: entry.imagePreview,
      });
    }
    if (entry.answer) {
      legacyMessages.push({
        id: `${entry.id}-assistant`,
        role: "assistant",
        content: entry.answer,
      });
    }
    return legacyMessages;
  };

  const getEntryTitle = (entry: HistoryEntry) => {
    if (entry.title?.trim()) return entry.title;
    if (entry.question?.trim()) return entry.question;
    const firstUser = getConversationMessages(entry).find((m) => m.role === "user")?.content?.trim();
    return firstUser || (lang === "ar" ? "محادثة بدون عنوان" : "Conversation sans titre");
  };

  const filtered = history.filter((h) => {
    const title = getEntryTitle(h).toLowerCase();
    return (
      title.includes(search.toLowerCase()) ||
      (t.subjects[h.subject as keyof typeof t.subjects] || "").includes(search)
    );
  });

  const selected = history.find((h) => h.id === selectedId);
  const selectedMessages = selected ? getConversationMessages(selected) : [];

  const deleteEntry = (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    localStorage.setItem("ilyass-history", JSON.stringify(updated));
    if (selectedId === id) setSelectedId(null);
  };

  const clearAll = () => {
    setHistory([]);
    localStorage.setItem("ilyass-history", "[]");
    setSelectedId(null);
  };

  const handleResumeConversation = (entry: HistoryEntry) => {
    // Store conversation data for Index to pick up
    localStorage.setItem("ilyass-resume-chat", JSON.stringify({
      id: entry.id,
      subject: entry.subject,
      messages: getConversationMessages(entry),
    }));
    navigate("/");
  };

  const labels = {
    ar: {
      title: "السجل",
      saved: "محادثة محفوظة",
      deleteAll: "حذف الكل",
      search: "بحث في السجل...",
      back: "رجوع",
      empty: "لا توجد محادثات محفوظة بعد",
      noResults: "لا توجد نتائج",
      resume: "متابعة المحادثة",
    },
    fr: {
      title: "Historique",
      saved: "conversation(s) enregistrée(s)",
      deleteAll: "Tout supprimer",
      search: "Rechercher...",
      back: "Retour",
      empty: "Aucune conversation enregistrée",
      noResults: "Aucun résultat",
      resume: "Reprendre la conversation",
    },
  };
  const l = labels[lang];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-lg">
        <div className="container mx-auto flex items-center gap-3 px-4 py-3">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: "Poppins, sans-serif" }}>{l.title}</h1>
            <p className="text-xs text-muted-foreground">{history.length} {l.saved}</p>
          </div>
          {history.length > 0 && (
            <Button variant="ghost" size="sm" className="mr-auto text-destructive" onClick={clearAll}>
              {l.deleteAll}
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-4 space-y-4">
        {history.length > 0 && (
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder={l.search} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
        )}

        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                {l.back}
              </Button>
              <Button
                size="sm"
                onClick={() => handleResumeConversation(selected)}
                className="gap-1.5"
              >
                <MessageSquare className="h-4 w-4" />
                {l.resume}
              </Button>
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t.subjects[selected.subject as keyof typeof t.subjects] || selected.subject}
                  </span>
                  <span>{new Date(selected.timestamp).toLocaleDateString(lang === "ar" ? "ar-MA" : "fr-FR")}</span>
                </div>

                <div className="space-y-3">
                  {selectedMessages.map((msg, idx) => (
                    <div key={msg.id || `${selected.id}-${idx}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${msg.role === "user" ? "bg-muted text-foreground" : "bg-card border border-border"}`}>
                        {msg.imagePreviews && msg.imagePreviews.length > 0 && (
                          <div className={`mb-2 grid gap-2 ${msg.imagePreviews.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                            {msg.imagePreviews.map((img, imgIndex) => (
                              <img key={imgIndex} src={img} alt={`uploaded ${imgIndex + 1}`} className="max-h-48 rounded-lg object-cover" />
                            ))}
                          </div>
                        )}

                        {!msg.imagePreviews && msg.imagePreview && (
                          <img src={msg.imagePreview} alt="uploaded" className="mb-2 max-h-48 rounded-lg object-cover" />
                        )}

                        {msg.pdfName && (
                          <div className="mb-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
                            <FileText className="h-5 w-5 text-primary" />
                            <div>
                              <p className="text-sm font-medium">{msg.pdfName}</p>
                              {msg.pdfPageCount && (
                                <p className="text-xs text-muted-foreground">{msg.pdfPageCount} {lang === "ar" ? "صفحات" : "pages"}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {msg.role === "assistant" ? (
                          <MarkdownRenderer content={msg.content} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {history.length === 0 ? l.empty : l.noResults}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry) => (
              <Card key={entry.id} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => setSelectedId(entry.id)}>
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{getEntryTitle(entry)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{t.subjects[entry.subject as keyof typeof t.subjects] || entry.subject}</span>
                      <span>•</span>
                      <span>{new Date(entry.timestamp).toLocaleDateString(lang === "ar" ? "ar-MA" : "fr-FR")}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id); }}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default HistoryPage;

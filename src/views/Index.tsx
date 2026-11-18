import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import ChatTextarea, { type ChatTextareaHandle } from "@/components/chat/ChatTextarea";
import { Button } from "@/components/ui/button";
import { MetalPromptBar } from "@/components/ui/metal-prompt-bar";
import { accountClient as supabase } from "@/lib/account-client";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, Zap, Brain, Copy, Check, FileText, Square, ClipboardCopy, User, Send, Plus, Camera, Upload, Sparkles } from "lucide-react";
import { MenuIcon, MessageIcon } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import RichAnswerRenderer from "@/components/answer/RichAnswerRenderer";
import AnswerBox from "@/components/answer/AnswerBox";
import AnswerFeedback from "@/components/AnswerFeedback";
import { useAnswerFontSize } from "@/hooks/use-answer-font";
import { stabilizeStreaming } from "@/lib/stabilizeStreaming";
import { prepareImageVariants } from "@/lib/imagePrep";
import PageBoundaryEditor from "@/components/chat/PageBoundaryEditor";
import LivePageCamera from "@/components/chat/LivePageCamera";
import QuestionMapPanel from "@/components/chat/QuestionMapPanel";
import type { PageBoundaryDetection } from "@/lib/opencvPageDetection";
import { splitThinking, detectLang, fallbackLangForSubject } from "@/lib/thinking";
import ThinkingPanel from "@/components/ThinkingPanel";
import VerificationBadge from "@/components/VerificationBadge";
import { spreadSteps } from "@/lib/spreadSteps";
import { withKnownDiagram } from "@/lib/knownDiagrams";
import AnswerImage from "@/components/chat/AnswerImage";
import PdfViewer from "@/components/PdfViewer";
import ChatSidebar from "@/components/ChatSidebar";
import { streamChat, type Msg, type ModelMode, type ResponseLength } from "@/lib/streamChat";
import { needsImageReview } from "@/lib/imageReview";
import { buildCacheKey, getCachedAnswer, setCachedAnswer, replayCachedAnswer } from "@/lib/answerCache";
import { ocrImages, answerIndicatesUnreadable } from "@/lib/ocrFallback";
import { verifyUnlockCode } from "@/lib/unlock";
import { streamPdfAnalysis } from "@/lib/streamPdf";
import { estimatePanacheUsage, getLovableCreditBlockRemaining } from "@/lib/panachePreflight";
import { pdfToImages, dataUrlToBase64 } from "@/lib/pdfToImages";
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@/lib/nav";
import { useTheme } from "@/hooks/use-theme";
import { useLanguage } from "@/hooks/use-language";
import { motion, AnimatePresence } from "framer-motion";
import { useWebMCP } from "use-webmcp-tool";
import { runWebMCPTool } from "@/lib/webmcp-telemetry";
import { oauthReturnPath } from "@/lib/oauth-return-path";
const SUBJECT_KEYS = ["math", "physics", "chemistry", "biology", "french", "arabic", "english", "philosophy", "history", "islamic", "other"] as const;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  imageBase64?: string;
  imagePreviews?: string[];
  imageBase64s?: string[];
  pdfName?: string;
  pdfPageCount?: number;
}

interface HistoryConversation {
  id: string;
  title: string;
  subject: string;
  timestamp: number;
  messages: ChatMessage[];
}

const Index = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<SupaUser | null>(null);
  const consumedOauthReturn = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<ChatTextareaHandle>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const updateComposerHeight = useCallback((textareaHeight: number) => {
    if (composerBoxRef.current) {
      const maxBoxHeight = Math.floor(window.innerHeight * 0.35);
      const idleHeight = 38;
      const focusedHeight = 46;
      const minimumHeight = composerFocused ? focusedHeight : idleHeight;
      const nextBoxHeight = Math.max(minimumHeight, Math.min(textareaHeight + 16, maxBoxHeight));
      composerBoxRef.current.style.height = `${nextBoxHeight}px`;
    }
  }, [composerFocused]);
  const handleComposerFocusChange = useCallback((focused: boolean) => {
    setComposerFocused(focused);
    if (composerBoxRef.current) {
      const maxBoxHeight = Math.floor(window.innerHeight * 0.35);
      composerBoxRef.current.style.height = `${Math.min(focused ? 46 : 38, maxBoxHeight)}px`;
    }
  }, []);
  const [draftEmpty, setDraftEmpty] = useState(true);
  const [subject, setSubject] = useState("math");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const hasAssistantReplied = useMemo(() => messages.some((m) => m.role === "assistant"), [messages]);
  const [imageBase64s, setImageBase64s] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [imageGroupSizes, setImageGroupSizes] = useState<number[]>([]);
  const [pageBoundaryDetections, setPageBoundaryDetections] = useState<(PageBoundaryDetection | null)[]>([]);
  const [imageReviewResult, setImageReviewResult] = useState<{ transcript: string; needsReview: boolean; figureMissing: boolean } | null>(null);
  const [imageReviewDraft, setImageReviewDraft] = useState("");
  const [imageReviewOpen, setImageReviewOpen] = useState(false);
  const [isCheckingImage, setIsCheckingImage] = useState(false);
  const [examMode, setExamMode] = useState(false);
  const [modelMode, setModelMode] = useState<ModelMode>(() => {
    const saved = (localStorage.getItem("ilyass-model-mode") as ModelMode) || "fast";
    return (saved === "advanced" || saved === "panache") && localStorage.getItem("ilyass-advanced-unlocked") !== "true" ? "fast" : saved;
  });
  const [advancedUnlocked, setAdvancedUnlocked] = useState(() => {
    return localStorage.getItem("ilyass-advanced-unlocked") === "true";
  });
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [verifyingAdvanced, setVerifyingAdvanced] = useState(false);
  const [chatId, setChatId] = useState(() => Date.now().toString());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cleanCopiedId, setCleanCopiedId] = useState<string | null>(null);
  const [responseLength, setResponseLength] = useState<ResponseLength>("medium");
  const [answerFontSize, setAnswerFontSize] = useAnswerFontSize();
  const abortControllerRef = useRef<AbortController | null>(null);

  const unlockAdvanced = async () => {
    if (!codeInput.trim() || verifyingAdvanced) return;
    setVerifyingAdvanced(true);
    const valid = await verifyUnlockCode(codeInput.trim());
    setVerifyingAdvanced(false);
    if (valid) {
      setAdvancedUnlocked(true);
      localStorage.setItem("ilyass-advanced-unlocked", "true");
      setModelMode("advanced");
      setShowCodeDialog(false);
      setCodeInput("");
      toast({ title: lang === "ar" ? "✅ تم التفعيل" : "✅ Activé", description: lang === "ar" ? "تم تفعيل الوضع المتقدم بنجاح" : "Mode avancé activé avec succès" });
      return;
    }
    toast({ title: lang === "ar" ? "❌ كود خاطئ" : "❌ Code incorrect", description: lang === "ar" ? "الكود الذي أدخلته غير صحيح" : "Le code que vous avez entré est incorrect", variant: "destructive" });
  };

  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [isPdfConverting, setIsPdfConverting] = useState(false);
  const [pdfAnalyzingPage, setPdfAnalyzingPage] = useState<number | undefined>();
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [showLiveCamera, setShowLiveCamera] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleSession = (session: { user: SupaUser } | null) => {
      setCurrentUser(session?.user ?? null);
      if (session?.user && !consumedOauthReturn.current) {
        consumedOauthReturn.current = true;
        const next = oauthReturnPath(window.sessionStorage.getItem("ilyass-oauth-next"));
        window.sessionStorage.removeItem("ilyass-oauth-next");
        if (next !== "/") navigate(next);
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => handleSession(session));
    supabase.auth.getUser().then(({ data: { user } }) => {
      handleSession(user ? { user } : null);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useWebMCP({
    name: "get_current_chat",
    description: "Read the text currently visible in the open ILYASS AI conversation, without sending or changing anything.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => runWebMCPTool("get_current_chat", () => {
      if (messages.length === 0) return "Aucune conversation n’est affichée.";
      return messages.slice(-20).map((message) => {
        const content = splitThinking(message.content).answer.slice(0, 1200);
        return `${message.role === "user" ? "Élève" : "ILYASS AI"} : ${content}`;
      }).join("\n\n");
    }),
  });

  useWebMCP({
    name: "change_subject",
    description: "Change la matière sélectionnée pour les prochains exercices.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", enum: [...SUBJECT_KEYS], description: "La matière à sélectionner parmi les valeurs disponibles." },
      },
      required: ["subject"],
    },
    execute: ({ subject: nextSubject }: { subject: string }) => runWebMCPTool("change_subject", () => {
      if (typeof nextSubject !== "string" || !SUBJECT_KEYS.includes(nextSubject as (typeof SUBJECT_KEYS)[number])) {
        throw new Error("Matière inconnue. Choisissez une matière proposée par l’application.");
      }
      setSubject(nextSubject as (typeof SUBJECT_KEYS)[number]);
      return "Matière mise à jour.";
    }),
  });

  useEffect(() => {
    localStorage.setItem("ilyass-model-mode", modelMode);
  }, [modelMode]);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { isDark, toggle: toggleTheme } = useTheme();
  const { lang, toggle: toggleLang, t } = useLanguage();

  // Resume conversation from history
  useEffect(() => {
    const resumeData = localStorage.getItem("ilyass-resume-chat");
    if (resumeData) {
      try {
        const parsed = JSON.parse(resumeData);
        if (parsed.messages && parsed.id) {
          setChatId(parsed.id);
          setSubject(parsed.subject || "math");
          setMessages(parsed.messages.map((m: any, i: number) => ({
            id: m.id || `${parsed.id}-${i}`,
            role: m.role,
            content: m.content,
            imagePreview: m.imagePreview,
            imagePreviews: m.imagePreviews,
            pdfName: m.pdfName,
            pdfPageCount: m.pdfPageCount,
          })));
        }
      } catch {}
      localStorage.removeItem("ilyass-resume-chat");
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("exam-mode", examMode);
  }, [examMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setAttachMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const scrollContainerRef = useRef<HTMLElement>(null);

  // "Stick to bottom" follows the stream only while the user hasn't scrolled away.
  // The decision is made from the USER's gesture (wheel / touch / scroll event),
  // never from the distance measured after new content has already grown — that
  // was what yanked the view back down whenever the user tried to read upward.
  const stickToBottomRef = useRef(true);
  const touchStartYRef = useRef(0);

  const releaseStick = () => { stickToBottomRef.current = false; };
  const handleChatScroll = () => {
    const c = scrollContainerRef.current;
    if (!c) return;
    const distance = c.scrollHeight - c.scrollTop - c.clientHeight;
    // Re-attach only when the user comes back to the very bottom by themselves.
    if (distance < 24) stickToBottomRef.current = true;
    else if (distance > 80) stickToBottomRef.current = false;
  };
  const handleChatWheel = (e: React.WheelEvent) => { if (e.deltaY < 0) releaseStick(); };
  // Any tap / click on the chat area stops the auto-follow immediately.
  const handleChatTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    releaseStick();
  };
  const handleChatTouchMove = (e: React.TouchEvent) => {
    const y = e.touches[0]?.clientY ?? 0;
    if (y - touchStartYRef.current > 4) releaseStick(); // finger moves down = reading upward
  };

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !stickToBottomRef.current) return;
    // Instant jump (no smooth animation) so it never fights the user's finger.
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  // تجهيز الصورة الأصلية مع قصاصات تفصيلية عند الحاجة (انظر src/lib/imagePrep.ts)

  const addImageFiles = async (files: File[]) => {
    if (files.length === 0 || isCheckingImage) return;
    const newPreviews: string[] = [];
    const newBase64s: string[] = [];
    const newGroupSizes: number[] = [];
    const newPageDetections: (PageBoundaryDetection | null)[] = [];
    const qualityWarnings = new Set<string>();
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: t.errorTitle, description: t.imageTooLarge, variant: "destructive" });
        continue;
      }
      const prepared = await prepareImageVariants(file);
      if (!prepared) {
        toast({ title: t.errorTitle, description: lang === "ar" ? "تعذّر قراءة الصورة، جرّب صورة أخرى" : "Impossible de lire l'image", variant: "destructive" });
        continue;
      }
      prepared.qualityWarnings.forEach((warning) => qualityWarnings.add(warning));
      // Show one preview per uploaded photo; send the full image plus selected detail crops.
      newPreviews.push(prepared.original);
      newBase64s.push(prepared.original.split(",")[1]);
      for (const crop of prepared.detailCrops) {
        newBase64s.push(crop.split(",")[1]);
      }
      newGroupSizes.push(1 + prepared.detailCrops.length);
      newPageDetections.push(prepared.pageBoundaryDetection);
    }
    if (newPreviews.length === 0) return;
    setImagePreviews((prev) => [...prev, ...newPreviews]);
    setImageBase64s((prev) => [...prev, ...newBase64s]);
    setImageGroupSizes((prev) => [...prev, ...newGroupSizes]);
    setPageBoundaryDetections((prev) => [...prev, ...newPageDetections]);
    if (qualityWarnings.size > 0) {
      const warningText = lang === "ar"
        ? "قد تكون الصورة ضعيفة الإضاءة أو التباين أو غير حادة. حاول وضع الورقة في إضاءة متوازنة وتثبيت الهاتف قبل الإرسال."
        : "La photo semble peut-être sombre, peu contrastée ou floue. Utilisez une lumière uniforme et stabilisez le téléphone avant l’envoi.";
      toast({ title: lang === "ar" ? "تنبيه حول جودة الصورة" : "Qualité de la photo", description: warningText });
    }
    setImageReviewResult(null);
    setImageReviewDraft("");
    setImageReviewOpen(false);
  };

  // اكتشاف الأسئلة: نستبدل الصورة بالمنطقة المقصوصة (التمرين بمعطياته) ونكتب المطلوب في خانة الكتابة
  const applyRecognizedCrop = (i: number, cropped: string, hint: string) => {
    const start = imageGroupSizes.slice(0, i).reduce((sum, size) => sum + size, 0);
    const count = imageGroupSizes[i] ?? 1;
    setImagePreviews((previous) => previous.map((value, index) => (index === i ? cropped : value)));
    setImageBase64s((previous) => [...previous.slice(0, start), cropped.split(",")[1], ...previous.slice(start + count)]);
    setImageGroupSizes((previous) => previous.map((size, index) => (index === i ? 1 : size)));
    setPageBoundaryDetections((previous) => previous.map((value, index) => (index === i ? null : value)));
    setImageReviewResult(null);
    setImageReviewDraft("");
    setImageReviewOpen(false);
    textareaRef.current?.setValue(hint);
    textareaRef.current?.focus();
    toast({
      title: lang === "ar" ? "تم تحديد الجزء المطلوب" : "Partie sélectionnée",
      description: lang === "ar" ? "ستُرسل هذه المنطقة فقط، ويمكنك تعديل الطلب قبل الإرسال." : "Seule cette zone sera envoyée ; vous pouvez modifier la demande avant l’envoi.",
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    // Copy the FileList first: resetting input.value empties the live list.
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (files.length === 0) return;
    try {
      await addImageFiles(files);
    } catch (err) {
      console.error("Image upload failed:", err);
    }
  };

  // لصق صورة (Ctrl+V / لصق من الحافظة) في أي مكان بالصفحة
  const addImageFilesRef = useRef(addImageFiles);
  addImageFilesRef.current = addImageFiles;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      void addImageFilesRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({
        title: t.errorTitle,
        description: lang === "ar" ? "حجم الملف كبير جداً. الحد الأقصى 20MB" : "Fichier trop volumineux. Max 20 Mo",
        variant: "destructive",
      });
      return;
    }
    setPdfFile(file);
    setIsPdfConverting(true);
    setPdfCurrentPage(1);
    try {
      const result = await pdfToImages(file, (page, total) => {
        setPdfTotalPages(total);
      });
      setPdfPageImages(result.pageImages);
      setPdfTotalPages(result.totalPages);
    } catch (err) {
      toast({
        title: t.errorTitle,
        description: lang === "ar" ? "فشل في قراءة ملف PDF" : "Échec de lecture du PDF",
        variant: "destructive",
      });
      setPdfFile(null);
    } finally {
      setIsPdfConverting(false);
    }
    if (e.target) e.target.value = "";
  };

  const removePdf = () => {
    setPdfFile(null);
    setPdfPageImages([]);
    setPdfTotalPages(0);
    setPdfCurrentPage(1);
    setPdfAnalyzingPage(undefined);
  };

  const saveConversationToHistory = (conversation: ChatMessage[], subj: string) => {
    const raw = localStorage.getItem("ilyass-history");
    const history: HistoryConversation[] = raw ? JSON.parse(raw) : [];

    const firstUserMessage = conversation.find((m) => m.role === "user")?.content?.trim();
    const title = firstUserMessage?.slice(0, 120) || (lang === "ar" ? "محادثة جديدة" : "Nouvelle conversation");
    const serializedMessages = conversation.map(({ imageBase64, imageBase64s, ...rest }) => rest);

    const nextConversation: HistoryConversation = {
      id: chatId,
      title,
      subject: subj,
      timestamp: Date.now(),
      messages: serializedMessages,
    };

    const filtered = history.filter((entry) => entry.id !== chatId);
    filtered.unshift(nextConversation);

    if (filtered.length > 50) filtered.length = 50;
    localStorage.setItem("ilyass-history", JSON.stringify(filtered));
  };

  const handlePdfSubmit = async () => {
    if (!pdfFile || pdfPageImages.length === 0) return;
    if (modelMode === "panache") {
      const blockedFor = getLovableCreditBlockRemaining();
      if (blockedFor > 0) {
        toast({
          title: lang === "ar" ? "تم إيقاف الإرسال مؤقتاً" : "Envoi temporairement bloqué",
          description: lang === "ar"
            ? "أعاد Lovable خطأ نفاد الرصيد مؤخراً. أعد المحاولة بعد " + Math.ceil(blockedFor / 60000) + " دقيقة. لم يتم إرسال الملف."
            : "Lovable recently returned an insufficient-credit error. Try again in " + Math.ceil(blockedFor / 60000) + " minute(s). The PDF was not sent.",
          variant: "destructive",
        });
        return;
      }
      const estimate = estimatePanacheUsage("PDF exam — " + pdfTotalPages + " pages — " + subject, pdfPageImages.length, pdfPageImages.map((img) => img.length));
      toast({
        title: lang === "ar" ? "تقدير Pananachi قبل الإرسال" : "Pananachi pre-send estimate",
        description: lang === "ar"
          ? "تقدير تقريبي: " + estimate.estimatedTotalTokens.toLocaleString() + " توكن عبر " + estimate.stages.length + " مراحل. هذا تقدير للاستهلاك وليس قراءة لرصيد Lovable."
          : "Rough estimate: " + estimate.estimatedTotalTokens.toLocaleString() + " tokens across " + estimate.stages.length + " stages. This estimates usage; it does not read your Lovable balance.",
      });
    }

    const pdfLabel = lang === "ar"
      ? `📄 تحليل PDF: ${pdfFile.name} (${pdfTotalPages} صفحات)`
      : `📄 Analyse PDF : ${pdfFile.name} (${pdfTotalPages} pages)`;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: pdfLabel,
      pdfName: pdfFile.name,
      pdfPageCount: pdfTotalPages,
    };

    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
    };

    const newMessages = [...messages, userMsg, assistantMsg];
    stickToBottomRef.current = true; // a new question starts following the answer again
    setMessages(newMessages);
    setIsLoading(true);
    setPdfAnalyzingPage(1);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const base64Images = pdfPageImages.map(dataUrlToBase64);
    let fullAnswer = "";

    await streamPdfAnalysis({
      pageImages: base64Images,
      subject,
      modelMode,
      signal: controller.signal,
      onDelta: (chunk) => {
        if (controller.signal.aborted) return;
        fullAnswer += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m))
        );
      },
      onDone: () => {
        const finalMessages = newMessages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m
        );
        setMessages(finalMessages);
        setIsLoading(false);
        setPdfAnalyzingPage(undefined);
        abortControllerRef.current = null;
        if (fullAnswer) saveConversationToHistory(finalMessages, subject);
        removePdf();
      },
      onError: (error) => {
        setIsLoading(false);
        setPdfAnalyzingPage(undefined);
        abortControllerRef.current = null;
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        toast({ title: t.errorTitle, description: error, variant: "destructive" });
      },
    });
  };

  const handleSubmit = async (
    overrideContent?: string,
    options: { reviewedTranscript?: string; skipImageReview?: boolean } = {},
  ) => {
    let reviewedTranscript = options.reviewedTranscript?.trim() || "";
    // Read the sheet once before solving; interrupt only for explicitly uncertain text.
    if (imageBase64s.length > 0 && !options.skipImageReview && !reviewedTranscript) {
      if (imageReviewResult) {
        if (imageReviewResult.needsReview) {
          setImageReviewDraft(imageReviewResult.transcript);
          setImageReviewOpen(true);
          return;
        }
        return handleSubmit(overrideContent, {
          reviewedTranscript: imageReviewResult.transcript,
          skipImageReview: true,
        });
      }

      const reviewController = new AbortController();
      abortControllerRef.current = reviewController;
      setIsLoading(true);
      setIsCheckingImage(true);
      try {
        const response = await fetch("/api/read-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: imageBase64s, modelMode }),
          signal: reviewController.signal,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `Image reading failed (${response.status})`);
        }
        const result = await response.json() as { transcript?: string; needsReview?: boolean; figureMissing?: boolean };
        if (reviewController.signal.aborted) return;
        if (!result.transcript || result.transcript.length < 10) throw new Error("No readable text returned");
        const review = {
          transcript: result.transcript.slice(0, 14_000),
          needsReview: Boolean(result.needsReview) || needsImageReview(result.transcript),
          figureMissing: Boolean(result.figureMissing),
        };
        setImageReviewResult(review);
        setIsLoading(false);
        setIsCheckingImage(false);
        abortControllerRef.current = null;
        if (review.needsReview) {
          setImageReviewDraft(review.transcript);
          setImageReviewOpen(true);
          return;
        }
        return handleSubmit(overrideContent, {
          reviewedTranscript: review.transcript,
          skipImageReview: true,
        });
      } catch (error) {
        if (reviewController.signal.aborted) {
          setIsLoading(false);
          setIsCheckingImage(false);
          abortControllerRef.current = null;
          return;
        }
        console.error("Image preflight failed; continuing with the original image:", error);
        setIsLoading(false);
        setIsCheckingImage(false);
        abortControllerRef.current = null;
        toast({
          title: lang === "ar" ? "تعذرت قراءة الصورة مسبقاً" : "Prélecture impossible",
          description: lang === "ar"
            ? "سأرسل الصورة مباشرة دون إيقاف الحل. إذا كانت القراءة مهمة، أرسل صورة أوضح."
            : "La photo sera envoyée directement sans bloquer la résolution.",
          variant: "destructive",
        });
        return handleSubmit(overrideContent, { skipImageReview: true });
      }
    }

    // If there's a PDF loaded, submit PDF analysis instead
    if (pdfFile && pdfPageImages.length > 0 && !overrideContent) {
      return handlePdfSubmit();
    }

    const content = overrideContent || (textareaRef.current?.getValue() ?? "").trim();
    if (!content && imageBase64s.length === 0) {
      toast({ title: t.alertTitle, description: t.alertDesc, variant: "destructive" });
      return;
    }

    const userContent = content || t.defaultQuestion;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: userContent,
      imagePreviews: imagePreviews.length > 0 ? imagePreviews : undefined,
      imageBase64s: imageBase64s.length > 0 ? imageBase64s : undefined,
      imagePreview: imagePreviews[0],
      imageBase64: imageBase64s[0],
    };

    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
    };

    const newMessages = [...messages, userMsg, assistantMsg];
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoading(true);

    const apiMessages: Msg[] = [...messages, userMsg]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        content: m.content,
        imageBase64: m.imageBase64,
        imageBase64s: m.imageBase64s,
      }));

    let fullAnswer = "";

    // 1) Try local cache first (instant response for repeat questions)
    const cacheKey = await buildCacheKey({
      content: reviewedTranscript ? userContent + "\n\n[Reviewed image transcription]\n" + reviewedTranscript : userContent,
      images: userMsg.imageBase64s || (userMsg.imageBase64 ? [userMsg.imageBase64] : []),
      subject,
      modelMode,
      responseLength,
      examMode,
      lang,
    });
    if (controller.signal.aborted) {
      setIsLoading(false);
      abortControllerRef.current = null;
      return;
    }
    const cached = getCachedAnswer(cacheKey);
    if (cached) {
      stickToBottomRef.current = true;
      setMessages(newMessages);
      textareaRef.current?.clear();
      setDraftEmpty(true);
      setImageBase64s([]);
      setImageGroupSizes([]);
      setImageReviewResult(null);
      setImageReviewDraft("");
      setImageReviewOpen(false);
      setImagePreviews([]);
      setPageBoundaryDetections([]);
      await replayCachedAnswer(cached, (chunk) => {
        if (controller.signal.aborted) return;
        fullAnswer += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m))
        );
      }, 40, 8, controller.signal);
      const finalMessages = newMessages.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m
      );
      setMessages(finalMessages);
      setIsLoading(false);
      abortControllerRef.current = null;
      if (fullAnswer) saveConversationToHistory(finalMessages, subject);
      return;
    }

    if (modelMode === "panache") {
      const blockedFor = getLovableCreditBlockRemaining();
      if (blockedFor > 0) {
        setIsLoading(false);
        abortControllerRef.current = null;
        toast({
          title: lang === "ar" ? "تم إيقاف الإرسال مؤقتاً" : "Envoi temporairement bloqué",
          description: lang === "ar"
            ? "أعاد Lovable خطأ نفاد الرصيد مؤخراً. أعد المحاولة بعد " + Math.ceil(blockedFor / 60000) + " دقيقة. لم يتم إرسال السؤال أو الصور."
            : "Lovable recently returned an insufficient-credit error. Try again in " + Math.ceil(blockedFor / 60000) + " minute(s). Your question and images were not sent.",
          variant: "destructive",
        });
        return;
      }
      const estimate = estimatePanacheUsage(
        [...messages.map((m) => m.content), userContent].join("\n"),
        imageBase64s.length,
        imageBase64s.map((img) => img.length),
      );
      toast({
        title: lang === "ar" ? "تقدير Pananachi قبل الإرسال" : "Pananachi pre-send estimate",
        description: lang === "ar"
          ? "تقدير تقريبي: " + estimate.estimatedTotalTokens.toLocaleString() + " توكن عبر " + estimate.stages.length + " مراحل. لا يستطيع Lovable كشف الرصيد المتبقي عبر API قبل الطلب."
          : "Rough estimate: " + estimate.estimatedTotalTokens.toLocaleString() + " tokens across " + estimate.stages.length + " stages. Lovable does not expose the remaining balance through a pre-request API.",
      });
    }

    stickToBottomRef.current = true;
    setMessages(newMessages);
    textareaRef.current?.clear();
    setDraftEmpty(true);
    setImageBase64s([]);
    setImageGroupSizes([]);
    setImageReviewResult(null);
    setImageReviewDraft("");
    setImageReviewOpen(false);
    setImagePreviews([]);
    setPageBoundaryDetections([]);

    const runStream = async (extraContent?: string) => {
      const msgsForApi: Msg[] = extraContent
        ? apiMessages.map((m, i) =>
            i === apiMessages.length - 1 ? { ...m, content: `${m.content}\n\n${extraContent}` } : m
          )
        : apiMessages;

      await streamChat({
        messages: msgsForApi,
        subject,
        modelMode,
        responseLength,
        examMode,
        imageTranscript: reviewedTranscript || undefined,
        signal: controller.signal,
        onDelta: (chunk) => {
          if (controller.signal.aborted) return;
          fullAnswer += chunk;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m))
          );
        },
        onDone: async () => {
          // Stop means keep exactly the text already received. Do not trigger OCR,
          // restart the stream, clear the answer, or replace it with an empty draft.
          if (controller.signal.aborted) {
            const stoppedMessages = newMessages.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m
            );
            setMessages(stoppedMessages);
            setIsLoading(false);
            abortControllerRef.current = null;
            if (fullAnswer) saveConversationToHistory(stoppedMessages, subject);
            return;
          }
          // 2) OCR fallback: if model couldn't read the image, retry once with OCR text
          const hasImages = (userMsg.imageBase64s?.length || 0) > 0;
          if (!extraContent && hasImages && answerIndicatesUnreadable(fullAnswer)) {
            try {
              toast({ title: lang === "ar" ? "جاري إعادة قراءة الصورة..." : "Re-reading image…" });
              const ocrText = await ocrImages(userMsg.imageBase64s!);
              // If the user stopped while OCR was running, preserve the current
              // partial answer and never clear it or launch a second stream.
              if (controller.signal.aborted) return;
              if (ocrText && ocrText.length > 10) {
                fullAnswer = "";
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: "" } : m))
                );
                const hint = lang === "ar"
                  ? `النص المستخرج من الصورة عبر OCR (استعمله للمساعدة في فهم السؤال):\n${ocrText}`
                  : `Text extracted from the image via OCR (use it to better understand the question):\n${ocrText}`;
                await runStream(hint);
                return;
              }
            } catch (e) {
              console.error("OCR fallback failed:", e);
            }
          }

          const finalMessages = newMessages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: fullAnswer } : m
          );
          setMessages(finalMessages);
          setIsLoading(false);
          abortControllerRef.current = null;
          if (fullAnswer) {
            saveConversationToHistory(finalMessages, subject);
            setCachedAnswer(cacheKey, fullAnswer);
          }
        },
        onError: (error) => {
          setIsLoading(false);
          abortControllerRef.current = null;
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
          toast({ title: t.errorTitle, description: error, variant: "destructive" });
        },
      });
    };

    await runStream();
  };

  const handleStop = () => {
    // Stop = stop following too: never pull the user back to the end of the answer.
    stickToBottomRef.current = false;
    setIsLoading(false);
    setIsCheckingImage(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    textareaRef.current?.clear();
    setDraftEmpty(true);
    setImageBase64s([]);
    setImageGroupSizes([]);
    setImageReviewResult(null);
    setImageReviewDraft("");
    setImageReviewOpen(false);
    setImagePreviews([]);
    setPageBoundaryDetections([]);
    removePdf();
    setChatId(Date.now().toString());
  };

  const hasConversation = messages.length > 0;
  const hasPdf = pdfFile !== null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <ChatSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        examMode={examMode}
        onToggleExam={() => setExamMode(!examMode)}
      />

      {/* Main Content */}
      <div className="flex flex-1 flex-col bg-background">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-lg">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="glass-icon-btn h-10 w-10"
              >
                <MenuIcon size={20} className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-lg font-bold leading-tight" style={{ fontFamily: 'Poppins, sans-serif' }}>ILYASS AI</h1>
                <p className="text-xs text-muted-foreground">{t.subtitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasConversation && (
                <button onClick={handleNewChat} className="glass-btn gap-1.5 inline-flex items-center text-xs">
                  <MessageIcon size={16} className="h-4 w-4" />
                  <span className="hidden sm:inline">{lang === "ar" ? "محادثة جديدة" : "Nouveau chat"}</span>
                </button>
              )}
              {/* Glass user icon */}
              <button
                onClick={() => {
                  if (currentUser) {
                    navigate("/profile");
                  } else {
                    navigate("/auth");
                  }
                }}
                className="relative h-10 w-10 rounded-full bg-muted/40 backdrop-blur-xl border border-border/50 flex items-center justify-center transition-all hover:bg-muted/60 hover:scale-105 active:scale-95"
                style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.1)" }}
              >
                {currentUser?.user_metadata?.avatar_url ? (
                  <img
                    src={currentUser.user_metadata.avatar_url}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <User className="h-5 w-5 text-muted-foreground" />
                )}
                {currentUser && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent border-2 border-card" />
                )}
              </button>
            </div>
          </div>
        </header>

      {/* Chat Area */}
      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto [overflow-anchor:none]"
        onScroll={handleChatScroll}
        onWheel={handleChatWheel}
        onTouchStart={handleChatTouchStart}
        onTouchMove={handleChatTouchMove}
        onPointerDown={releaseStick}
        onClick={releaseStick}
      >
        <div className="mx-auto w-full max-w-[95%] md:max-w-[900px] lg:max-w-[1100px] py-4 space-y-4">
          {/* Subject Selector */}
          {!hasConversation && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t.subjectLabel}</label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECT_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>{t.subjects[key]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{lang === "ar" ? "النموذج" : "Modèle"}</label>
                <div className="flex flex-nowrap items-center gap-1 overflow-x-auto rounded-xl border border-border bg-muted/30 p-1">
                  <button
                    onClick={() => setModelMode("fast")}
                    className={`inline-flex flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-all sm:px-3 ${
                      modelMode === "fast"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {lang === "ar" ? "سريع" : "Rapide"}
                  </button>
                  <button
                    onClick={() => setModelMode("accurate")}
                    className={`inline-flex flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-all sm:px-3 ${
                      modelMode === "accurate"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    {lang === "ar" ? "دقيق" : "Précis"}
                  </button>
                  <button
                    onClick={() => {
                      if (advancedUnlocked) {
                        setModelMode("advanced");
                      } else {
                        setShowCodeDialog(true);
                      }
                    }}
                    className={`inline-flex flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-all sm:px-3 ${
                      modelMode === "advanced"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {lang === "ar" ? "متقدم" : "Avancé"}
                    {!advancedUnlocked && <span className="text-[0.6875rem] ml-0.5">🔒</span>}
                  </button>
                  <button
                    onClick={() => {
                      if (advancedUnlocked) {
                        setModelMode("panache");
                      } else {
                        setShowCodeDialog(true);
                      }
                    }}
                    title={lang === "ar" ? "فريق نماذج: قراءة، حل، صياغة، مراجعة مستقلة" : "Équipe d'IA : lecture, résolution, rédaction, vérification indépendante"}
                    className={`inline-flex flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-all sm:px-3 ${
                      modelMode === "panache"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Pananachi
                    {!advancedUnlocked && <span className="text-[0.6875rem] ml-0.5">🔒</span>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Advanced Code Dialog */}
          {showCodeDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCodeDialog(false)}>
              <div
                className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="mb-2 text-lg font-bold text-foreground">
                  {lang === "ar" ? "🔐 الوضع المتقدم" : "🔐 Mode Avancé"}
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  {lang === "ar" ? "أدخل الكود لتفعيل الوضع المتقدم:" : "Entrez le code pour activer le mode avancé :"}
                </p>
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder={lang === "ar" ? "أدخل الكود..." : "Entrez le code..."}
                  className="mb-3 w-full rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-center text-sm font-mono tracking-widest text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void unlockAdvanced();
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowCodeDialog(false); setCodeInput(""); }}
                    className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    {lang === "ar" ? "إلغاء" : "Annuler"}
                  </button>
                  <button
                    onClick={() => void unlockAdvanced()}
                    disabled={verifyingAdvanced}
                    className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
                  >
                    {verifyingAdvanced ? "..." : (lang === "ar" ? "تأكيد" : "Confirmer")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          <AnimatePresence initial={false}>
          {messages.map((msg, msgIndex) => (
            <motion.div
              key={msg.id}
              initial={msg.role === "user"
                ? { opacity: 0, x: 30, scale: 0.92 }
                : { opacity: 0, y: 16, scale: 0.95 }
              }
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              transition={msg.role === "user"
                ? { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }
              }
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`${
                  msg.role === "user"
                    ? "max-w-[85%] rounded-3xl border border-primary/20 px-4 py-2.5 bg-primary/15 text-foreground"
                    : "w-full"
                }`}
              >
                {/* User images */}
                {msg.role === "user" && msg.imagePreviews && msg.imagePreviews.length > 0 && (
                  <div className={`mb-2 flex flex-wrap gap-2 ${msg.imagePreviews.length === 1 ? '' : 'grid grid-cols-2'}`}>
                    {msg.imagePreviews.map((img, i) => (
                      <img key={i} src={img} alt={`uploaded ${i + 1}`} className="max-h-48 w-auto rounded-lg object-cover" />
                    ))}
                  </div>
                )}
                {msg.role === "user" && !msg.imagePreviews && msg.imagePreview && (
                  <img src={msg.imagePreview} alt="uploaded" className="mb-2 max-h-48 w-auto rounded-lg object-cover" />
                )}

                {/* PDF badge for user message */}
                {msg.role === "user" && msg.pdfName && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{msg.pdfName}</p>
                      <p className="text-xs text-muted-foreground">
                        {msg.pdfPageCount} {lang === "ar" ? "صفحات" : "pages"}
                      </p>
                    </div>
                  </div>
                )}

                {msg.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : msg.content ? (
                  <div className="w-full">
                    {/* Writing Card - Professional AI Response */}
                    <AnswerBox
                      lang={lang}
                      fontSize={answerFontSize}
                      onFontSizeChange={setAnswerFontSize}
                      actions={
                          !examMode ? (
                            <>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(splitThinking(msg.content).answer);
                                  setCopiedId(msg.id);
                                  setTimeout(() => setCopiedId(null), 2000);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                                title={lang === "ar" ? "نسخ" : "Copier"}
                              >
                                {copiedId === msg.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                onClick={() => {
                                  const clean = splitThinking(msg.content).answer
                                    .replace(/[#*_~`>]/g, "")
                                    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
                                    .replace(/```[\s\S]*?```/g, "")
                                    .replace(/\n{3,}/g, "\n\n")
                                    .replace(/[😀-🙏🌀-🗿🚀-🛿🤀-🧿✅❌⚠️💡📌🔑🎯📝🔥⭐️🎓📊🔬🧪🔢📐✏️📖🏆💯🎉👍👎👏🤔💭🗣️📢]/gu, "")
                                    .trim();
                                  navigator.clipboard.writeText(clean);
                                  setCleanCopiedId(msg.id);
                                  setTimeout(() => setCleanCopiedId(null), 2000);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                                title={lang === "ar" ? "نسخ نظيف" : "Copie nette"}
                              >
                                {cleanCopiedId === msg.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                              </button>
                            </>
                          ) : undefined
                      }
                      footer={
                        !(isLoading && msg.id === messages[messages.length - 1]?.id) ? (
                          <AnswerImage content={splitThinking(msg.content).answer} lang={lang} id={String(msg.id)} sheetImage={messages[msgIndex - 1]?.imageBase64s?.[0] ?? messages[msgIndex - 1]?.imageBase64} />
                        ) : undefined
                      }
                    >
                        {(() => {
                          const parts = splitThinking(msg.content);
                          const isLast = isLoading && msg.id === messages[messages.length - 1]?.id;
                          return (
                            <>
                              <ThinkingPanel
                                thinking={parts.thinking}
                                answerStarted={parts.answer.length > 0}
                                streaming={isLast}
                                lang={detectLang(messages[msgIndex - 1]?.content || "", fallbackLangForSubject(subject))}
                                hasImage={!!(messages[msgIndex - 1]?.imageBase64 || messages[msgIndex - 1]?.imageBase64s?.length)}
                                examMode={examMode}
                              />
                              {parts.answer && (
                                <RichAnswerRenderer content={spreadSteps(withKnownDiagram(isLast ? stabilizeStreaming(parts.answer) : parts.answer, messages[msgIndex - 1]?.content || ""))} fontSize={answerFontSize} />
                              )}
                              <VerificationBadge
                                verdict={parts.verification}
                                streaming={isLast}
                                lang={detectLang(messages[msgIndex - 1]?.content || "", fallbackLangForSubject(subject))}
                              />
                            </>
                          );
                        })()}
                    </AnswerBox>
                    {!(isLoading && msg.id === messages[messages.length - 1]?.id) && (
                      <AnswerFeedback answerId={String(msg.id)} subject={subject || "other"} lang={lang} />
                    )}
                    </div>
                ) : (
                  <div className="flex items-center gap-2 py-3">
                      <span className="text-sm italic text-muted-foreground">
                        {lang === "ar" ? "ILYASS AI يفكر..." : "ILYASS AI réfléchit..."}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    </div>
                )}
              </div>
            </motion.div>
          ))}
          </AnimatePresence>

          <div ref={chatEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <div className="sticky bottom-0 bg-gradient-to-t from-background via-background/90 to-transparent pb-2 pt-4">
        <div className="mx-auto w-full max-w-[98%] md:max-w-[960px] lg:max-w-[1180px] space-y-2">
          {/* PDF Preview */}
          {hasPdf && (
            <PdfViewer
              file={pdfFile!}
              pageImages={pdfPageImages}
              currentPage={pdfCurrentPage}
              totalPages={pdfTotalPages}
              isConverting={isPdfConverting}
              analyzingPage={pdfAnalyzingPage}
              onPageChange={setPdfCurrentPage}
              onRemove={removePdf}
            />
          )}

          {selectedImagePreview && (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label={lang === "ar" ? "معاينة الصورة" : "Aperçu de l’image"}
              onClick={() => setSelectedImagePreview(null)}
              onKeyDown={(event) => { if (event.key === "Escape") setSelectedImagePreview(null); }}
            >
              <button
                type="button"
                onClick={() => setSelectedImagePreview(null)}
                aria-label={lang === "ar" ? "إغلاق معاينة الصورة" : "Fermer l’aperçu"}
                className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl text-white backdrop-blur-md"
              >×</button>
              <img
                src={selectedImagePreview}
                alt={lang === "ar" ? "الصورة المرفقة بالحجم الكامل" : "Image jointe en taille réelle"}
                onClick={(event) => event.stopPropagation()}
                className="max-h-[88dvh] max-w-full select-none object-contain"
              />
            </div>
          )}

          {/* Image Previews */}
          {imagePreviews.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2">
              {imagePreviews.map((img, i) => (
                <div key={i} className="relative flex w-full max-w-[520px] flex-col items-start gap-2">
                  <button
  type="button"
  onClick={() => setSelectedImagePreview(img)}
  aria-label={lang === "ar" ? "عرض الصورة بالحجم الكامل" : "Afficher l’image en grand"}
  className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
>
  <img src={img} alt={`uploaded ${i + 1}`} className="h-16 w-auto rounded-lg border border-border object-cover" />
</button>
                  {pageBoundaryDetections[i]?.candidates[0] && (
                    <PageBoundaryEditor
                      image={img}
                      candidate={pageBoundaryDetections[i]!.candidates[0]}
                      lang={lang}
                      onApply={(correctedImage) => {
                        const start = imageGroupSizes.slice(0, i).reduce((sum, size) => sum + size, 0);
                        const count = imageGroupSizes[i] ?? 1;
                        setImagePreviews((previous) => previous.map((value, index) => index === i ? correctedImage : value));
                        setImageBase64s((previous) => [
                          ...previous.slice(0, start),
                          correctedImage.split(",")[1],
                          ...previous.slice(start + count),
                        ]);
                        setImageGroupSizes((previous) => previous.map((size, index) => index === i ? 1 : size));
                        setPageBoundaryDetections((previous) => previous.map((value, index) => index === i ? null : value));
                        setImageReviewResult(null);
                        setImageReviewDraft("");
                        setImageReviewOpen(false);
                        toast({
                          title: lang === "ar" ? "تم تصحيح منظور الصورة" : "Perspective corrigée",
                          description: lang === "ar" ? "ستُرسل الصورة المصححة إلى ILYASS AI." : "L’image corrigée sera envoyée à ILYASS AI.",
                        });
                      }}
                    />
                  )}
                  <QuestionMapPanel
                    image={img}
                    lang={lang}
                    subject={subject}
                    onApply={(cropped, hint) => applyRecognizedCrop(i, cropped, hint)}
                  />
                  <button
                    disabled={isCheckingImage}
                    onClick={() => {
                      const start = imageGroupSizes.slice(0, i).reduce((sum, size) => sum + size, 0);
                      const count = imageGroupSizes[i] ?? 1;
                      setImagePreviews((prev) => prev.filter((_, idx) => idx !== i));
                      setImageBase64s((prev) => [...prev.slice(0, start), ...prev.slice(start + count)]);
                      setImageGroupSizes((prev) => prev.filter((_, idx) => idx !== i));
                      setPageBoundaryDetections((prev) => prev.filter((_, idx) => idx !== i));
                      setImageReviewResult(null);
                      setImageReviewDraft("");
                      setImageReviewOpen(false);
                    }}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {isCheckingImage && (
            <div className="mx-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
              {lang === "ar" ? "جاري قراءة الصورة والتحقق من وضوح الأرقام والرموز قبل الحل..." : "Lecture de la photo et vérification des symboles avant résolution…"}
            </div>
          )}

          {imageReviewOpen && (
            <section className="mx-2 space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {lang === "ar" ? "تأكد من القيم غير الواضحة" : "Vérifiez les éléments peu lisibles"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {lang === "ar"
                    ? imageReviewResult?.figureMissing
                      ? "الورقة تشير إلى شكل أو منحنى غير ظاهر في الصور. أضف صورته من زر الإرفاق إن كان متوفراً، وصحّح أي رقم أو رمز يحمل [?] قبل المتابعة."
                      : "وجدت القراءة رقماً أو رمزاً غير واضح. صحّح فقط ما تراه خطأً، واترك [?] إذا لم تستطع تحديده. لن يبدأ الحل قبل المتابعة."
                    : imageReviewResult?.figureMissing
                      ? "The question refers to a missing figure or graph. Attach it if available, and correct any uncertain values before continuing."
                      : "A number or symbol seems unclear. Correct only what is wrong, then continue."}
                </p>
              </div>
              <textarea
                value={imageReviewDraft}
                onChange={(event) => setImageReviewDraft(event.target.value)}
                rows={7}
                className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={lang === "ar" ? "النص المقروء من الصورة" : "Transcription de la photo"}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => setImageReviewOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
                  {lang === "ar" ? "إلغاء" : "Annuler"}
                </button>
                <button
                  type="button"
                  disabled={!imageReviewDraft.trim() || isLoading}
                  onClick={() => {
                    setImageReviewOpen(false);
                    void handleSubmit(undefined, { reviewedTranscript: imageReviewDraft, skipImageReview: true });
                  }}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {lang === "ar" ? "تأكيد القراءة وابدأ الحل" : "Confirmer et résoudre"}
                </button>
              </div>
            </section>
          )}

          {showLiveCamera && (
            <LivePageCamera
              lang={lang}
              onClose={() => setShowLiveCamera(false)}
              onCapture={(file) => {
                setShowLiveCamera(false);
                void addImageFiles([file]);
              }}
            />
          )}

          {/* Hidden file inputs */}
          <input ref={galleryInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif" multiple className="hidden" onChange={handleImageUpload} />
          <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdfUpload} />

          {/* Smart Input Bar - ChatGPT Style */}
          <div ref={composerBoxRef} className={`smart-input-bar glass-input-bar chatgpt-composer flex items-end gap-2 rounded-full px-3 py-2 ${composerFocused ? "composer-is-focused" : ""}`}>
            {/* Attachment button — ChatGPT-style plus */}
            <div className="relative self-end" ref={attachMenuRef}>
              <button
                type="button"
                disabled={isCheckingImage}
                aria-label={lang === "ar" ? "إضافة مرفق" : "Ajouter une pièce jointe"}
                onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                className="chatgpt-composer-plus flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-90"
              >
                <Plus className="h-10 w-10" strokeWidth={1.7} />
              </button>
              <AnimatePresence>
                {attachMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className={`absolute bottom-12 ${lang === "ar" ? "right-0" : "left-0"} z-50 w-44 rounded-2xl bg-popover border border-border p-1.5 shadow-xl`}
                  >
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 }}
                      onClick={() => { setShowLiveCamera(true); setAttachMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Camera className="h-4 w-4" />
                      {lang === "ar" ? "كاميرا" : "Caméra"}
                    </motion.button>
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 }}
                      onClick={() => { galleryInputRef.current?.click(); setAttachMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Upload className="h-4 w-4" />
                      {lang === "ar" ? "صورة" : "Photo"}
                    </motion.button>
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 }}
                      onClick={() => { pdfInputRef.current?.click(); setAttachMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <FileText className="h-4 w-4" />
                      PDF
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Text input — isolated local-state component to prevent input lag */}
            <ChatTextarea
              ref={textareaRef}
              placeholder={hasPdf
                ? (lang === "ar" ? "اضغط إرسال لتحليل الـPDF..." : "Appuyez sur Envoyer pour analyser le PDF...")
                : "Ask ILYASS AI..."}
              onEmptyChange={setDraftEmpty}
              onHeightChange={updateComposerHeight}
              onFocusChange={handleComposerFocusChange}
              onSubmitEnter={() => handleSubmit()}
              className="chatgpt-composer-textarea min-h-[42px] max-h-[150px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[18px] leading-[26px] text-white placeholder:text-white/45 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 transition-[font-size] duration-150"
            />

            {/* Direct send button */}
            {isLoading ? (
              <button
                type="button"
                aria-label={lang === "ar" ? "إيقاف" : "Arrêter"}
                onClick={handleStop}
                className="chatgpt-composer-action flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-all hover:bg-destructive/90 active:scale-90"
              >
                <Square className="h-5 w-5 fill-current" />
              </button>
            ) : (
              <MetalPromptBar preset="chromatic" strength={0.88}>
                <button
                  type="button"
                  aria-label={lang === "ar" ? "إرسال" : "Envoyer"}
                  onClick={() => handleSubmit()}
                  disabled={draftEmpty && imageBase64s.length === 0 && !hasPdf}
                  className="chatgpt-composer-action flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-all hover:bg-primary/90 active:scale-90 disabled:opacity-45 disabled:pointer-events-none"
                >
                  <Send className="h-5 w-5" strokeWidth={2.3} />
                </button>
              </MetalPromptBar>
            )}
          </div>
        </div>
        {/* Developed by ILYASS badge */}
        <div className="pb-1 pt-1 text-center">
          <span className="text-xs text-muted-foreground/40 font-medium tracking-wide">
            Developed by <span className="text-primary/60 font-semibold">ILYASS</span>
          </span>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Index;

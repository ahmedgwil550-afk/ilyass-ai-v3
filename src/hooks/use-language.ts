import { useState, useEffect } from "react";

export type Lang = "ar" | "fr";

const translations = {
  ar: {
    subtitle: "مساعد الواجبات الذكي",
    subjectLabel: "المادة الدراسية",
    placeholder: "اكتب سؤالك هنا... مثلاً: حل المعادلة 2x² + 3x - 5 = 0",
    photo: "صورة",
    file: "ملف",
    solve: "حل",
    solution: "الحل",
    analyzing: "جاري التحليل والحل...",
    welcome: "مرحباً بك في ILYASS AI",
    welcomeSub: "اكتب سؤالك أو صوّر التمرين وسأساعدك في حله خطوة بخطوة",
    alertTitle: "تنبيه",
    alertDesc: "اكتب سؤالاً أو أرفق صورة",
    errorTitle: "خطأ",
    imageTooLarge: "حجم الصورة كبير جداً. الحد الأقصى 10MB",
    defaultQuestion: "حل السؤال الموجود في الصورة",
    tags: ["حل معادلة", "تمرين فيزياء", "مسألة كيمياء", "تحليل نص"],
    subjects: {
      math: "الرياضيات", physics: "الفيزياء", chemistry: "الكيمياء",
      biology: "علوم الحياة والأرض", french: "الفرنسية", arabic: "العربية",
      english: "الإنجليزية", philosophy: "الفلسفة", history: "التاريخ والجغرافيا",
      islamic: "التربية الإسلامية", other: "أخرى",
    },
  },
  fr: {
    subtitle: "Assistant intelligent pour les devoirs",
    subjectLabel: "Matière",
    placeholder: "Écris ta question ici... Ex : Résoudre 2x² + 3x - 5 = 0",
    photo: "Photo",
    file: "Fichier",
    solve: "Résoudre",
    solution: "Solution",
    analyzing: "Analyse en cours...",
    welcome: "Bienvenue sur ILYASS AI",
    welcomeSub: "Écris ta question ou prends une photo et je t'aide étape par étape",
    alertTitle: "Attention",
    alertDesc: "Écris une question ou ajoute une image",
    errorTitle: "Erreur",
    imageTooLarge: "Image trop grande. Max 10 Mo",
    defaultQuestion: "Résous la question dans l'image",
    tags: ["Résoudre une équation", "Exercice de physique", "Problème de chimie", "Analyse de texte"],
    subjects: {
      math: "Mathématiques", physics: "Physique", chemistry: "Chimie",
      biology: "SVT", french: "Français", arabic: "Arabe",
      english: "Anglais", philosophy: "Philosophie", history: "Histoire-Géo",
      islamic: "Éducation islamique", other: "Autre",
    },
  },
} as const;

export function useLanguage() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "fr";
    return (localStorage.getItem("ilyass-lang") as Lang) || "fr";
  });

  useEffect(() => {
    localStorage.setItem("ilyass-lang", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  const toggle = () => setLang((v) => (v === "ar" ? "fr" : "ar"));
  const t = translations[lang];

  return { lang, toggle, t };
}

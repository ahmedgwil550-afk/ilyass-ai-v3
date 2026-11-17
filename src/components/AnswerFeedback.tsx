import { useState } from "react";
import { accountClient } from "@/lib/account-client";

type IssueType = "image_reading" | "calculation" | "scientific_fact" | "method" | "formatting" | "incomplete" | "other";

export default function AnswerFeedback({ answerId, subject, lang }: { answerId: string; subject: string; lang: string }) {
  const [rating, setRating] = useState<"correct" | "incorrect" | null>(null);
  const [issueType, setIssueType] = useState<IssueType>("calculation");
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const ar = lang === "ar";

  const submit = async (nextRating: "correct" | "incorrect") => {
    setRating(nextRating);
    if (nextRating === "incorrect") return;
    await save(nextRating);
  };

  const save = async (nextRating: "correct" | "incorrect" = rating || "incorrect") => {
    setStatus("saving");
    try {
      const { data } = await accountClient.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setStatus("error"); return; }
      const response = await fetch("/api/answer-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          answerId,
          subject,
          rating: nextRating,
          ...(nextRating === "incorrect" ? { issueType, ...(score ? { score: Number(score) } : {}), ...(note.trim() ? { note: note.trim() } : {}) } : {}),
        }),
      });
      if (!response.ok) throw new Error("feedback");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  if (status === "saved") return <p className="mt-2 text-xs text-emerald-600">{ar ? "شكراً، تم تسجيل ملاحظتك." : "Merci, votre retour a été enregistré."}</p>;

  return (
    <section className="mt-3 rounded-xl border border-border/70 bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{ar ? "هل كانت هذه الإجابة مفيدة وصحيحة؟" : "Cette réponse était-elle correcte et utile ?"}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={status === "saving"} onClick={() => void submit("correct")} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">{ar ? "صحيحة" : "Correcte"}</button>
        <button type="button" disabled={status === "saving"} onClick={() => void submit("incorrect")} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">{ar ? "توجد مشكلة" : "Signaler un problème"}</button>
      </div>
      {rating === "incorrect" && (
        <div className="mt-3 space-y-2">
          <select value={issueType} onChange={(event) => setIssueType(event.target.value as IssueType)} className="w-full rounded-lg border bg-background p-2 text-xs">
            <option value="image_reading">{ar ? "خطأ في قراءة الصورة" : "Lecture de l’image"}</option>
            <option value="calculation">{ar ? "خطأ حسابي" : "Erreur de calcul"}</option>
            <option value="scientific_fact">{ar ? "خطأ علمي" : "Erreur scientifique"}</option>
            <option value="method">{ar ? "منهجية غير مناسبة" : "Méthode inadaptée"}</option>
            <option value="formatting">{ar ? "تنسيق أو جدول" : "Présentation ou tableau"}</option>
            <option value="incomplete">{ar ? "إجابة ناقصة" : "Réponse incomplète"}</option>
            <option value="other">{ar ? "أخرى" : "Autre"}</option>
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">{ar ? "النقطة /20 (اختياري)" : "Note /20 (facultatif)"}</label>
            <input type="number" min="0" max="20" step="0.5" value={score} onChange={(event) => setScore(event.target.value)} className="w-20 rounded-lg border bg-background p-2 text-xs" />
          </div>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} placeholder={ar ? "ملاحظة إضافية (اختياري)" : "Précision (facultatif)"} className="w-full rounded-lg border bg-background p-2 text-xs" />
          <button type="button" disabled={status === "saving"} onClick={() => void save("incorrect")} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{status === "saving" ? (ar ? "جارٍ الإرسال..." : "Envoi…") : (ar ? "إرسال الملاحظة" : "Envoyer")}</button>
        </div>
      )}
      {status === "error" && <p className="mt-2 text-xs text-destructive">{ar ? "تعذر حفظ الملاحظة. سجّل الدخول وحاول مجدداً." : "Impossible d’enregistrer. Connectez-vous et réessayez."}</p>}
    </section>
  );
}

import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { stripThinking } from "@/lib/thinking";
import { handle } from "@/server-ai/solve";

const subjects = ["math", "physics", "chemistry", "biology", "french", "arabic", "english", "philosophy", "history", "islamic", "other"] as const;

export default defineTool({
  name: "solve_exercise",
  title: "Résoudre un exercice",
  description: "Résout un exercice textuel pour un utilisateur connecté, dans la matière choisie.",
  inputSchema: {
    question: z.string().min(1).max(4000).describe("Énoncé de l’exercice, sans image."),
    subject: z.enum(subjects).describe("Matière de l’exercice."),
  },
  annotations: { openWorldHint: true },
  handler: async ({ question, subject }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Connectez-vous pour utiliser cet outil." }], isError: true };
    }
    const userId = ctx.getUserId();
    if (!userId) {
      return { content: [{ type: "text", text: "Votre session ne permet pas cette demande." }], isError: true };
    }

    const response = await handle(new Request("https://ilyassaiv2.local/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: question }],
        subject,
        modelMode: "fast",
        responseLength: "medium",
        examMode: false,
        deviceId: userId,
      }),
    }));

    if (!response.ok || !response.body) {
      const failure = await response.text();
      let message = "Impossible de résoudre l’exercice pour le moment.";
      try {
        const parsed: unknown = JSON.parse(failure);
        if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") message = parsed.message;
      } catch {
        // Keep upstream details private from the caller.
      }
      return { content: [{ type: "text", text: message }], isError: true };
    }

    const raw = await response.text();
    const answer: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === "[DONE]") continue;
      try {
        const payload: unknown = JSON.parse(chunk);
        if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) continue;
        const delta = payload.choices[0]?.delta;
        if (delta && typeof delta === "object" && "content" in delta) {
          if (typeof delta.content === "string") answer.push(delta.content);
          else if (Array.isArray(delta.content)) {
            for (const part of delta.content) {
              if (part && typeof part === "object" && "text" in part && typeof part.text === "string") answer.push(part.text);
            }
          }
        }
      } catch {
        // Ignore non-JSON SSE frames.
      }
    }
    const cleaned = stripThinking(answer.join("")).trim();
    if (!cleaned) {
      return { content: [{ type: "text", text: "La réponse n’a pas pu être générée. Réessayez." }], isError: true };
    }
    return { content: [{ type: "text", text: cleaned }] };
  },
});
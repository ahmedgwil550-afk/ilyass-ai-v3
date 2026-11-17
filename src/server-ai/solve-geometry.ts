import { isValidUnlockCode } from "./unlock";
import { getAiConfig, tierOf } from "./ai-provider";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Tu es ILYASS AI — un expert en GÉOMÉTRIE pour lycéens, comparable à GPAI.
Tu travailles en deux temps comme un humain rigoureux :

ÉTAPE 1 — LECTURE (obligatoire si une image est fournie) :
- Lis l'énoncé EXACTEMENT tel qu'il est écrit (texte + figure).
- Identifie chaque point nommé, chaque longueur donnée, chaque angle, chaque transformation.
- N'invente JAMAIS de coordonnées qui contredisent l'image. Si l'image impose des positions, déduis-les avec soin.

ÉTAPE 2 — RÉSOLUTION :
- Donne une solution claire, étape par étape, en français (sauf si l'énoncé est en arabe — alors réponds en arabe).
- Utilise LaTeX : $...$ inline, $$...$$ pour les équations centrées.
- Mets en évidence le résultat final : **Réponse finale : ...**.
- Sois pédagogique mais concis (style GPAI : net, propre, sans bavardage).

ÉTAPE 3 — FIGURE (OBLIGATOIRE, à la toute fin) :
Émets un bloc structuré pour permettre l'affichage interactif :

\`\`\`geometry
{
  "type": "geometry",
  "restated": "Énoncé reformulé en 1-3 phrases (ce que tu as compris).",
  "points": [
    {"name": "A", "x": 0, "y": 0},
    {"name": "B", "x": 4, "y": 0},
    {"name": "C", "x": 0, "y": 3}
  ],
  "segments": [["A","B"],["B","C"],["C","A"]],
  "polygons": [{"vertices": ["A","B","C"], "label": "ABC"}],
  "circles": [{"center": "O", "radius": 2, "label": "C(O,2)"}],
  "angles": [{"at":"A","from":"B","to":"C","right":true}, {"at":"B","from":"A","to":"C","label":"60°"}],
  "ticks": [{"segment":["A","B"],"count":1},{"segment":["A","C"],"count":1}],
  "parallels": [{"segment":["A","B"],"group":1},{"segment":["C","D"],"group":1}],
  "vectors": [{"from":"A","to":"B","label":"\\\\vec{AB}"}],
  "transformations": [
    {"type":"rotation","center":"A","angle":90,"point":"B","result":"B'"}
  ]
}
\`\`\`

RÈGLES STRICTES POUR LE BLOC :
- Coordonnées NUMÉRIQUES (calcule arrondi au centième si besoin : sin/cos, racines, etc.).
- Si l'énoncé ne donne pas de coordonnées, choisis-en de cohérentes avec les contraintes (longueurs, angles, perpendicularités).
- "angle" toujours en DEGRÉS.
- Types de transformations supportés : rotation (center,angle,point,result), reflection (axis = "x" | "y" | {p1,p2}), translation (vector:{x,y}), homothety (center,ratio).
- "angles[].right=true" pour marquer un angle droit ; sinon donne "label" ("60°", "α"…).
- "ticks" pour indiquer des longueurs égales (1, 2 ou 3 traits).
- "parallels" pour les côtés parallèles (mêmes "group" = même nombre de chevrons).
- N'OMETS JAMAIS le bloc geometry, même pour une figure simple.
- Le bloc doit être un JSON STRICTEMENT VALIDE (pas de virgules en trop, pas de commentaires).

FORMAT GLOBAL DE TA RÉPONSE :
## 📘 Énoncé compris
(reformulation courte)

## 🧠 Résolution
(étapes numérotées avec LaTeX)

## ✅ Réponse finale
**...**

\`\`\`geometry
{...}
\`\`\`

## Tableaux (obligatoire)
Si l'énoncé contient ou nécessite un tableau (signes, variations, proportionnalité, données, à compléter…), utilise UNIQUEMENT du HTML dans un bloc \`\`\`html en suivant exactement ce modèle :

\`\`\`html
<div style="margin-top:12px; border:1px solid #555; border-radius:8px; overflow:hidden;">
  <table style="width:100%; border-collapse:collapse; text-align:center; background:#ffffff;">
    <thead><tr><th style="border:1px solid #555; padding:10px; background:#f5f5f5; font-weight:bold;">Header</th></tr></thead>
    <tbody><tr><td style="border:1px solid #555; padding:10px;">valeur</td></tr></tbody>
  </table>
</div>
\`\`\`

Règles : conserver le nombre exact de colonnes/lignes ; cellules vides à remplir = "...................................." ; ajouter dir="rtl" sur <table> si le contenu est en arabe ; bordures 1px solid #555 + border-collapse:collapse ; fond blanc ; padding 10px ; texte centré ; largeur 100% ; en-têtes en gras avec fond #f5f5f5 ; supporter colspan/rowspan ; jamais de tableaux Markdown ; pour les tableaux de signes uniquement, colorer + en vert, − en rouge, 0 en bleu dans la cellule.`;

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, imageBase64s, modelMode, deviceId, unlockCode } = await req.json();
    const ai = getAiConfig(modelMode === "advanced" ? "advanced" : tierOf(modelMode));
    if (!ai) throw new Error("AI provider is not configured (set AI_API_KEY)");

    // Daily limit (shared with main solve, 3/day per device) — bypassed by unlock code
    const SUPABASE_URL = process.env["SUPABASE_URL"];
    const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    const DAILY_LIMIT = 3;
    const isUnlimited = isValidUnlockCode(unlockCode);
    if (!isUnlimited && deviceId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const today = new Date().toISOString().split("T")[0];
      const checkResp = await fetch(
        `${SUPABASE_URL}/rest/v1/daily_usage?device_id=eq.${encodeURIComponent(deviceId)}&request_date=eq.${today}&select=request_count,id`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY } }
      );
      const rows = await checkResp.json();
      if (rows.length > 0 && rows[0].request_count >= DAILY_LIMIT) {
        return new Response(
          JSON.stringify({
            error: "daily_limit_reached",
            message: "⚠️ لقد استهلكت جميع محاولاتك اليوم (3/3).\nيرجى العودة غدًا.",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (rows.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/daily_usage?id=eq.${rows[0].id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ request_count: rows[0].request_count + 1 }),
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/daily_usage`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ device_id: deviceId, request_date: today, request_count: 1 }),
        });
      }
    }

    // Model: prefer GPT-5 (best vision OCR for math), fast = gemini pro
    const selectedModel = ai.model(modelMode === "advanced" ? "advanced" : modelMode === "fast" ? "fast" : "accurate");

    const aiMessages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

    const inputMessages: any[] = Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: "user", content: "Résous l'exercice de géométrie de l'image.", imageBase64s: imageBase64s || [] }];

    for (const msg of inputMessages) {
      const imgs: string[] = msg.imageBase64s || (msg.imageBase64 ? [msg.imageBase64] : []);
      if (msg.role === "user" && imgs.length > 0) {
        const content: any[] = imgs.map((img: string) => ({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${img}` },
        }));
        content.push({
          type: "text",
          text:
            (msg.content || "Lis attentivement l'exercice de géométrie sur l'image, puis résous-le.") +
            "\n\nRappel: termine impérativement par un bloc ```geometry valide JSON.",
        });
        aiMessages.push({ role: "user", content });
      } else {
        aiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const response = await fetch(ai.chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel, messages: aiMessages, stream: true }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("solve-geometry error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

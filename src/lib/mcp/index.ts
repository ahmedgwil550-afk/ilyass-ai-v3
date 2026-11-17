import { auth, defineMcp } from "@lovable.dev/mcp-js";
import solveExercise from "./tools/solve-exercise";

// Comes from this project's own Lovable Cloud backend (.env); never hardcode another project's id here.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"];

export default defineMcp({
  name: "ilyassaiv2",
  title: "ILYASSAIV2",
  version: "0.1.0",
  instructions: "Outils pédagogiques ILYASSAIV2 pour les exercices scolaires. Les outils liés au compte nécessitent une connexion OAuth.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [solveExercise],
});
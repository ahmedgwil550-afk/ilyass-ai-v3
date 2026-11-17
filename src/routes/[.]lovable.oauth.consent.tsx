import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { accountClient as supabase } from "@/lib/account-client";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id: typeof search["authorization_id"] === "string" ? search["authorization_id"] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Demande d’autorisation manquante ou invalide.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ href: `/auth?next=${encodeURIComponent(next)}` });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id") ?? "";
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    if ("redirect_url" in data) throw redirect({ href: data.redirect_url });
    return data;
  },
  head: () => ({
    meta: [
      { title: "Autoriser un assistant — ILYASSAIV2" },
      { name: "description", content: "Vérifiez les accès demandés pour connecter un assistant à ILYASSAIV2." },
      { property: "og:title", content: "Autoriser un assistant — ILYASSAIV2" },
      { property: "og:description", content: "Vérifiez les accès demandés pour connecter un assistant à ILYASSAIV2." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConsentPage,
  errorComponent: ConsentError,
});

function ConsentError({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <section className="w-full max-w-lg space-y-3 border-l-2 border-destructive pl-5">
        <h1 className="text-xl font-semibold">Impossible de charger cette autorisation</h1>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "La demande est invalide ou a expiré."}</p>
      </section>
    </main>
  );
}

function ConsentPage() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details.client?.name || "Cet assistant";
  const redirectUri = details.redirect_uri;
  const scopes = details.scope.split(" ").filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = approve
        ? await supabase.auth.oauth.approveAuthorization(authorization_id)
        : await supabase.auth.oauth.denyAuthorization(authorization_id);
      if (result.error) {
        setBusy(false);
        setError(result.error.message || "La décision n’a pas pu être enregistrée.");
        return;
      }
      window.location.assign(result.data.redirect_url);
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error ? failure.message : "La décision n’a pas pu être enregistrée.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="w-full max-w-lg space-y-6 border-l-2 border-primary pl-5">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">ILYASSAIV2</p>
          <h1 className="text-2xl font-semibold">Connecter {clientName} à ILYASSAIV2</h1>
          <p className="text-sm text-muted-foreground">Cet assistant pourra utiliser les outils autorisés de l’application avec votre compte.</p>
        </div>
        <div className="space-y-3 text-sm">
          <p>Cette connexion permet à {clientName} d’utiliser l’application en votre nom.</p>
          <p>Compte connecté : {details.user.email}</p>
          {redirectUri ? <p className="break-all text-muted-foreground">Application : {redirectUri}</p> : null}
          {scopes.length > 0 ? (
            <ul className="space-y-1">
              {scopes.map((scope) => (
                <li key={scope} className="text-muted-foreground">
                  {scope === "openid" ? "Identification de votre compte" : scope === "email" ? "Accès à votre adresse e-mail" : scope === "profile" ? "Accès aux informations de profil de base" : `Accès demandé : ${scope}`}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground">Les permissions de l’application déterminent toujours les données accessibles.</p>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => void decide(true)}>{busy ? "En cours…" : "Autoriser"}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Refuser</Button>
        </div>
      </section>
    </main>
  );
}
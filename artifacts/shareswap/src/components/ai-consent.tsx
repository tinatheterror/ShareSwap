import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type AiFeature = {
  key: string;
  title: string;
  purpose: string;
  shared: string;
  notShared: string;
  withoutConsent: string;
  fallback: "unavailable" | "no-ai";
};
type AiFeatureList = { provider: string; version: string; features: AiFeature[] };

type Options = {
  /** For features that start by themselves (as you type): after a "Not now", do not ask again until the page is reloaded. */
  askOnce?: boolean;
};
type AiConsentContextType = {
  /** Resolves true when this person has agreed to send content to OpenAI for the feature (asking first if they have not). */
  ensureAiConsent: (feature: string, options?: Options) => Promise<boolean>;
};

const AiConsentContext = createContext<AiConsentContextType | null>(null);

export function useAiConsent(): AiConsentContextType {
  const context = useContext(AiConsentContext);
  if (!context) throw new Error("useAiConsent must be used inside <AiConsentProvider>");
  return context;
}

/**
 * The prompt before the first use of each AI feature. The wording comes from the server (/api/ai-consent/features), the same
 * list the Privacy Policy describes, and agreement is stored per person and per feature. The server refuses to call OpenAI
 * without it, so this only asks.
 */
export function AiConsentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<{ feature: string; resolve: (agreed: boolean) => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const declined = useRef(new Set<string>());
  const { data: list } = useQuery<AiFeatureList>({ queryKey: ["/api/ai-consent/features"], enabled: !!user });

  const agreedTo = (user as { aiConsents?: string[] } | null)?.aiConsents ?? [];

  const ensureAiConsent = useCallback(
    (feature: string, options?: Options) => {
      if (agreedTo.includes(feature)) return Promise.resolve(true);
      if (options?.askOnce && declined.current.has(feature)) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => setPending({ feature, resolve }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agreedTo.join(",")],
  );

  const settle = (agreed: boolean) => {
    if (!pending) return;
    if (!agreed) declined.current.add(pending.feature);
    pending.resolve(agreed);
    setPending(null);
  };

  const allow = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/ai-consent", { feature: pending.feature });
      if (!res.ok) throw new Error("Could not save your choice");
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      settle(true);
    } catch (e) {
      toast({ title: "Couldn't save your choice", description: (e as Error).message, variant: "destructive" });
      settle(false);
    } finally {
      setSaving(false);
    }
  };

  const definition = pending ? list?.features.find((feature) => feature.key === pending.feature) : undefined;
  const provider = list?.provider ?? "OpenAI";

  return (
    <AiConsentContext.Provider value={{ ensureAiConsent }}>
      {children}
      <Dialog open={!!pending && !!definition} onOpenChange={(open) => { if (!open) settle(false); }}>
        <DialogContent className="sm:max-w-md" data-testid="ai-consent-dialog">
          {definition && (
            <>
              <DialogHeader>
                <DialogTitle>{definition.title} uses {provider}</DialogTitle>
                <DialogDescription>{definition.purpose}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm text-gray-700">
                <p><strong>Shared with {provider}:</strong> {definition.shared}</p>
                <p>{definition.notShared}</p>
                <p><strong>If you say no:</strong> {definition.withoutConsent}</p>
                <p>
                  You can change your mind at any time in Settings under AI features. See our{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="text-teal-600 underline">Privacy Policy</a>.
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => settle(false)} disabled={saving} data-testid="ai-consent-decline">Not now</Button>
                <Button onClick={allow} disabled={saving} data-testid="ai-consent-allow">{saving ? "Saving…" : `Allow and continue`}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AiConsentContext.Provider>
  );
}

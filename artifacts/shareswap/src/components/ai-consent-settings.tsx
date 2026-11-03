import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AiFeature } from "@/components/ai-consent";

/**
 * Settings > AI features: one switch per feature that sends content to OpenAI. Switching on is the same recorded consent as the
 * prompt before first use; switching off withdraws it, and the feature goes back to unavailable or to working without OpenAI.
 * The wording comes from the server, the same list the prompt and the Privacy Policy use.
 */
export function AiConsentSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery<{ provider: string; features: AiFeature[] }>({ queryKey: ["/api/ai-consent/features"], enabled: !!user });
  const agreedTo = (user as { aiConsents?: string[] } | null)?.aiConsents ?? [];
  const provider = data?.provider ?? "OpenAI";

  const change = async (feature: AiFeature, on: boolean) => {
    setBusy(feature.key);
    try {
      const res = on
        ? await apiRequest("POST", "/api/ai-consent", { feature: feature.key })
        : await apiRequest("DELETE", `/api/ai-consent/${feature.key}`);
      if (!res.ok) throw new Error("The server did not accept the change");
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    } catch (e) {
      toast({ title: "Couldn't save your choice", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;
  return (
    <Card className="mb-4" data-testid="ai-consent-settings">
      <CardHeader className="py-3 pb-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#0BB88C]" />
          <CardTitle className="text-base">AI features</CardTitle>
        </div>
        <p className="text-xs text-gray-500">
          These features send content to {provider} to work. Nothing is sent unless the switch is on, and you can turn it off at any time. See our{" "}
          <a href="/privacy" className="text-teal-600 underline">Privacy Policy</a>.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 py-2">
        {data.features.map((feature, index) => (
          <div key={feature.key}>
            {index > 0 && <Separator className="mb-2" />}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">{feature.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{feature.purpose}</p>
                <p className="text-xs text-gray-500 mt-0.5"><span className="font-medium">Sent to {provider}:</span> {feature.shared}</p>
                <p className="text-xs text-gray-500 mt-0.5"><span className="font-medium">When off:</span> {feature.withoutConsent}</p>
              </div>
              <Switch
                checked={agreedTo.includes(feature.key)}
                disabled={busy !== null}
                onCheckedChange={(on) => change(feature, on)}
                aria-label={`${feature.title} (sends content to ${provider})`}
                data-testid={`ai-consent-switch-${feature.key}`}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

/** Pages that must stay readable while the screen is up: it links to them. */
const READABLE = ["/terms", "/privacy", "/community-guidelines", "/delete-account"];

/**
 * A screen nobody can dismiss until they accept the current Terms and Community Guidelines: accounts from before they
 * existed, new Google sign-ins, and everyone again whenever the version changes (see legal-config.ts on the server).
 */
export function TermsGate() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const [agreed, setAgreed] = useState(false);
  const required = !!user && (user as { termsAcceptanceRequired?: boolean }).termsAcceptanceRequired === true;
  const version = (user as { currentTermsVersion?: string } | null)?.currentTermsVersion;

  const accept = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/accept-terms", { version });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not save your agreement");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
    onError: (e: Error) => toast({ title: "Couldn't continue", description: e.message, variant: "destructive" }),
  });

  if (!required || !version || READABLE.some((path) => location === path || location.startsWith(`${path}/`))) return null;

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md [&>button]:hidden" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} data-testid="terms-gate">
        <DialogHeader>
          <DialogTitle>Our Terms and Community Guidelines</DialogTitle>
          <DialogDescription>
            ShareSwap has no tolerance for objectionable content or abusive people. Please read our{" "}
            <a href="/terms" target="_blank" rel="noreferrer" className="text-teal-600 underline">Terms of Service</a> and{" "}
            <a href="/community-guidelines" target="_blank" rel="noreferrer" className="text-teal-600 underline">Community Guidelines</a>{" "}
            and agree to them to keep using ShareSwap.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm" htmlFor="terms-gate-agree">
          <input id="terms-gate-agree" type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="terms-gate-checkbox" />
          <span>I have read and agree to the Terms of Service and Community Guidelines.</span>
        </label>
        <DialogFooter>
          <Button disabled={!agreed || accept.isPending} onClick={() => accept.mutate()} data-testid="terms-gate-accept">
            {accept.isPending ? "Saving…" : "Agree and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

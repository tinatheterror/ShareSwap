import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgeFields, ageComplete, emptyAge, type AgeValue } from "@/components/age-fields";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

/** Pages that must stay readable while the screen is up: it links to them. */
const READABLE = ["/terms", "/privacy", "/community-guidelines", "/delete-account"];

/**
 * A screen nobody can dismiss until they accept the current Terms and Community Guidelines and have confirmed their age:
 * accounts from before they existed, new Google sign-ins, and everyone again whenever the Terms version changes (see
 * legal-config.ts and age-of-majority.ts on the server). It asks only for what is still missing.
 */
export function TermsGate() {
  const { user, logoutMutation } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [agreed, setAgreed] = useState(false);
  const [age, setAge] = useState<AgeValue>(emptyAge);
  const [ageError, setAgeError] = useState<string | null>(null);
  const termsRequired = !!user && (user as { termsAcceptanceRequired?: boolean }).termsAcceptanceRequired === true;
  const ageRequired = !!user && (user as { ageConfirmationRequired?: boolean }).ageConfirmationRequired === true;
  const required = termsRequired || ageRequired;
  const version = (user as { currentTermsVersion?: string } | null)?.currentTermsVersion;

  const accept = useMutation({
    mutationFn: async () => {
      setAgeError(null);
      if (ageRequired) {
        const ageRes = await apiRequest("POST", "/api/account/confirm-age", age).catch((e: Error & { code?: string }) => { throw Object.assign(e, { fromAge: true }); });
        if (!ageRes.ok) throw Object.assign(new Error((await ageRes.json().catch(() => ({}))).message || "Could not check your age"), { fromAge: true });
      }
      if (!termsRequired) return {};
      const res = await apiRequest("POST", "/api/account/accept-terms", { version });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not save your agreement");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
    onError: (e: Error & { fromAge?: boolean }) => {
      if (e.fromAge) setAgeError(e.message);
      else toast({ title: "Couldn't continue", description: e.message, variant: "destructive" });
    },
  });

  if (!required || (termsRequired && !version) || READABLE.some((path) => location === path || location.startsWith(`${path}/`))) return null;

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md [&>button]:hidden" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} data-testid="terms-gate">
        <DialogHeader>
          <DialogTitle>{termsRequired ? "Our Terms and Community Guidelines" : "Confirm your age"}</DialogTitle>
          <DialogDescription>
            {termsRequired ? (
              <>
                ShareSwap has no tolerance for objectionable content or abusive people. Please read our{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="text-teal-600 underline">Terms of Service</a> and{" "}
                <a href="/community-guidelines" target="_blank" rel="noreferrer" className="text-teal-600 underline">Community Guidelines</a>{" "}
                {ageRequired ? "and confirm your age, then agree " : "and agree "}to keep using ShareSwap.
              </>
            ) : (
              "Renting and lending are contracts, so you need to have reached the age of majority where you live. Tell us where that is and your date of birth to keep using ShareSwap."
            )}
          </DialogDescription>
        </DialogHeader>
        {ageRequired && <AgeFields value={age} onChange={(v) => { setAge(v); setAgeError(null); }} idPrefix="gate-age" />}
        {ageError && <p className="text-sm text-red-600" role="alert" data-testid="age-error">{ageError}</p>}
        {termsRequired && (
          <label className="flex items-start gap-2 text-sm" htmlFor="terms-gate-agree">
            <input id="terms-gate-agree" type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="terms-gate-checkbox" />
            <span>I have read and agree to the Terms of Service and Community Guidelines.</span>
          </label>
        )}
        <DialogFooter className="sm:flex-col sm:space-x-0 gap-2">
          <Button disabled={(termsRequired && !agreed) || (ageRequired && !ageComplete(age)) || accept.isPending} onClick={() => accept.mutate()} data-testid="terms-gate-accept">
            {accept.isPending ? "Saving…" : termsRequired ? "Agree and continue" : "Continue"}
          </Button>
          {/* A way out for someone who cannot or will not continue. The deletion pages are on READABLE, and the server exempts /api/account/*. */}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => logoutMutation?.mutate()} disabled={logoutMutation?.isPending} data-testid="terms-gate-sign-out">
              Sign out
            </Button>
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => navigate("/delete-account")} data-testid="terms-gate-delete-account">
              Delete my account
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

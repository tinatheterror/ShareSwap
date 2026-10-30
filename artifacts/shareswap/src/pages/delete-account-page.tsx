import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  GRACE_DAYS,
  DELETED_HEADING,
  DELETION_INTRO,
  WHAT_IS_DELETED,
  WHAT_IS_KEPT,
  blockerAction,
  blockingRequestHref,
  blockingRequestLabel,
  canRequestDeletion,
  deletionDateLabel,
  isDeletionPending,
  pendingBannerText,
  walletCopy,
  type AccountStatus,
  type DeletionEligibility,
} from "@/lib/account-deletion";

// The deletion page that works without the app: it is the deletion URL for the Google Play listing. Signed out, it
// explains what deleting does and asks the person to sign in; signed in, it uses the same request, cancel and
// confirm endpoints as the mobile app.

const SIGN_IN_HREF = `/auth?returnTo=${encodeURIComponent("/delete-account")}`;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <Link href="/" className="font-bold text-teal-700">ShareSwap</Link>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">{children}</main>
    </div>
  );
}

function WhatHappens({ extra }: { extra?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-1.5 text-sm text-red-900">
      <p className="font-semibold">What happens</p>
      <p>{DELETION_INTRO}</p>
      <p className="pt-1 font-medium">{DELETED_HEADING}</p>
      <ul className="list-disc pl-5 space-y-1">
        {WHAT_IS_DELETED.map((item) => <li key={item}>{item}</li>)}
        {extra}
      </ul>
      <p className="pt-2">{WHAT_IS_KEPT}</p>
    </div>
  );
}

export default function DeleteAccountPage() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"review" | "confirm">("review");
  const [forfeitAcknowledged, setForfeitAcknowledged] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [deleteNowOpen, setDeleteNowOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<AccountStatus>({ queryKey: ["/api/account/status"], enabled: !!user && !deleted, staleTime: 0 });
  const { data: eligibility, isLoading: eligibilityLoading, isError: eligibilityError, refetch } = useQuery<DeletionEligibility>({
    queryKey: ["/api/account/deletion-eligibility"],
    enabled: !!user && !deleted && !statusLoading,
    staleTime: 0,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/account/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/account/deletion-eligibility"] });
  };

  const request = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/account/deletion/request", { acknowledgeForfeit: forfeitAcknowledged })).json(),
    onSuccess: () => {
      refresh();
      toast({ title: "Deletion requested", description: `Your account will be deleted in ${GRACE_DAYS} days. We've emailed you the date.` });
    },
    onError: (error: Error) => {
      setStep("review");
      refresh();
      toast({ title: "Couldn't request deletion", description: error.message, variant: "destructive" });
    },
  });

  const cancel = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/account/deletion/cancel", {})).json(),
    onSuccess: () => {
      refresh();
      setStep("review");
      setUnderstood(false);
      toast({ title: "Deletion cancelled", description: "Your account stays open and your listings are visible again." });
    },
    onError: (error: Error) => toast({ title: "Couldn't cancel", description: error.message, variant: "destructive" }),
  });

  const deleteNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/account/deletion/confirm", { confirmDeletion: true })).json(),
    onSuccess: () => {
      setDeleteNowOpen(false);
      setDeleted(true);
      queryClient.setQueryData(["/api/user"], null);
      queryClient.clear();
    },
    onError: (error: Error) => {
      setDeleteNowOpen(false);
      toast({ title: "Couldn't delete the account", description: error.message, variant: "destructive" });
    },
  });

  if (deleted) {
    return (
      <Shell>
        <Card data-testid="account-deleted">
          <CardHeader>
            <CardTitle>Your account has been deleted</CardTitle>
            <CardDescription>You're signed out. Thank you for being part of ShareSwap.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  if (isLoading) {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-border" /></div></Shell>;
  }

  if (!user) {
    return (
      <Shell>
        <Card data-testid="delete-account-signed-out">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-red-600" /> Delete your ShareSwap account</CardTitle>
            <CardDescription>Sign in to the account you want to delete. Google sign-in works too.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <WhatHappens />
            <Button asChild className="w-full" data-testid="delete-account-sign-in">
              <a href={SIGN_IN_HREF}>Sign in to continue</a>
            </Button>
            <p className="text-xs text-gray-500">Prefer the app? Open Settings and choose Delete Account.</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (statusLoading || eligibilityLoading) {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-border" /></div></Shell>;
  }

  if (eligibilityError || !eligibility) {
    return (
      <Shell>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p>We couldn't check your account. Try again.</p>
            <Button variant="outline" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const wallet = walletCopy(eligibility.wallet);
  const blockers = eligibility.blockers;

  if (isDeletionPending(status)) {
    const canWithdraw = eligibility.wallet.tier === "offer_withdrawal" && eligibility.wallet.withdrawalOffer;
    return (
      <Shell>
        <Card data-testid="delete-account-pending">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-red-600" /> Deletion scheduled</CardTitle>
            <CardDescription>{pendingBannerText(status.deletionScheduledFor)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-700">
              Until {deletionDateLabel(status.deletionScheduledFor)} you can change your mind. Your listings are hidden in the meantime.
            </p>
            {canWithdraw ? (
              <p className="text-sm">
                You have ${eligibility.wallet.available} in your balance. <Link href="/my-balance" className="text-teal-700 underline" data-testid="delete-account-withdraw">Withdraw it</Link> before it is forfeited; the $10 minimum is waived.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="delete-account-cancel">
                {cancel.isPending ? "Cancelling..." : "Cancel deletion"}
              </Button>
              <Button variant="outline" className="text-red-700 border-red-300" onClick={() => setDeleteNowOpen(true)} data-testid="delete-account-delete-now">
                Delete now
              </Button>
            </div>
          </CardContent>
        </Card>

        <Dialog open={deleteNowOpen} onOpenChange={setDeleteNowOpen}>
          <DialogContent data-testid="delete-account-delete-now-dialog">
            <DialogHeader>
              <DialogTitle>Delete your account now?</DialogTitle>
              <DialogDescription>
                This can't be undone. Your account is deleted straight away instead of on {deletionDateLabel(status.deletionScheduledFor)}.
              </DialogDescription>
            </DialogHeader>
            {blockers.map((b) => {
              const action = blockerAction(b.code);
              return (
                <div key={b.code} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>{b.message}</p>
                  {action ? <Link href={action.href} className="underline">{action.label}</Link> : null}
                </div>
              );
            })}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteNowOpen(false)}>Keep waiting</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => deleteNow.mutate()}
                disabled={deleteNow.isPending || blockers.length > 0}
                data-testid="delete-account-delete-now-confirm"
              >
                {deleteNow.isPending ? "Deleting..." : "Delete my account now"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card data-testid="delete-account-review">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-red-600" /> Delete your account</CardTitle>
          <CardDescription>Review what happens, then confirm.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "review" ? (
            <>
              <WhatHappens
                extra={
                  <>
                    {eligibility.willEnd.subscription ? <li>Your subscription ends.</li> : null}
                    {eligibility.autoResolve.requests > 0 ? (
                      <li>{eligibility.autoResolve.requests} open {eligibility.autoResolve.requests === 1 ? "request" : "requests"} with nothing paid are cancelled.</li>
                    ) : null}
                  </>
                }
              />

              {blockers.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm text-amber-900" data-testid="delete-account-blockers">
                  <p className="font-semibold">Before you can delete your account</p>
                  <ul className="space-y-1.5">
                    {blockers.map((b) => {
                      const action = blockerAction(b.code);
                      return (
                        <li key={b.code}>
                          {b.message}{b.amount ? ` ($${b.amount})` : ""}{" "}
                          {action ? <Link href={action.href} className="underline">{action.label}</Link> : null}
                          {b.requests?.length ? (
                            <ul className="mt-1 ml-4 list-disc space-y-0.5" data-testid="delete-account-blocking-requests">
                              {b.requests.map((r) => (
                                <li key={r.id}>
                                  <Link href={blockingRequestHref(r)} className="underline">{blockingRequestLabel(r)}</Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {wallet.lines.length > 0 ? (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 space-y-1 text-sm text-teal-900" data-testid={`delete-account-wallet-${eligibility.wallet.tier}`}>
                  <p className="font-semibold">Your balance</p>
                  {wallet.lines.map((line) => <p key={line}>{line}</p>)}
                </div>
              ) : null}
              {wallet.acknowledgement ? (
                <label className="flex items-start gap-3 text-sm cursor-pointer">
                  <Checkbox checked={forfeitAcknowledged} onCheckedChange={(v) => setForfeitAcknowledged(v === true)} data-testid="delete-account-forfeit-check" />
                  <span>{wallet.acknowledgement}</span>
                </label>
              ) : null}

              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                disabled={!canRequestDeletion(eligibility, forfeitAcknowledged)}
                onClick={() => setStep("confirm")}
                data-testid="delete-account-continue"
              >
                Continue
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                Last step. In {GRACE_DAYS} days your account and the data listed on the previous step will be permanently deleted. You'll get an email with the exact date, and a Cancel button on every page until then.
              </p>
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} data-testid="delete-account-final-check" />
                <span>I understand my account will be permanently deleted.</span>
              </label>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("review")}>Back</Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  disabled={!understood || request.isPending}
                  onClick={() => request.mutate()}
                  data-testid="delete-account-final-confirm"
                >
                  {request.isPending ? "Requesting..." : "Delete my account"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

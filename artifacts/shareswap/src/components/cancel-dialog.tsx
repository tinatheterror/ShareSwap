import type { CancelDialogSpec } from "@workspace/api-client-react/cancel-flow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The one cancel dialog on web. It draws whatever CancelDialogSpec it is given: the BORROW/RENT penalty
// modal ("Proceed to cancel" / "Keep booking", the second one being the default), and the
// old confirmations SWAP and GIFT still use. Two real buttons with their own labels, which
// window.confirm cannot give.
export function CancelDialog({
  spec,
  pending,
  onConfirm,
  onKeep,
}: {
  spec: CancelDialogSpec | null;
  pending: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const keepIsPrimary = spec?.primary === "keep";
  return (
    <Dialog open={!!spec} onOpenChange={(open) => { if (!open && !pending) onKeep(); }}>
      <DialogContent className="sm:max-w-sm" data-testid="cancel-dialog">
        <DialogHeader>
          <DialogTitle>{spec?.title}</DialogTitle>
          <DialogDescription>{spec?.message}</DialogDescription>
          {spec?.hint ? <p className="text-xs text-muted-foreground" data-testid="cancel-dialog-hint">{spec.hint}</p> : null}
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {/* Keep first in the DOM: it is the default focus, and the safe answer. */}
          <Button
            variant={keepIsPrimary ? "default" : "outline"}
            onClick={onKeep}
            disabled={pending}
            data-testid="cancel-dialog-keep"
          >
            {spec?.keepLabel}
          </Button>
          <Button
            variant={keepIsPrimary ? "outline" : "destructive"}
            className={keepIsPrimary ? "text-red-600 hover:text-red-700" : undefined}
            onClick={onConfirm}
            disabled={pending}
            data-testid="cancel-dialog-confirm"
          >
            {pending ? "Cancelling…" : spec?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

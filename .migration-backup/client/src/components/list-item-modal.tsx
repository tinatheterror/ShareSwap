import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ModalErrorBoundary } from "@/components/error-boundary";
import LendPage from "@/pages/lend-page";

interface ListItemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ListItemModal({ isOpen, onClose }: ListItemModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-none w-full h-full sm:w-[95vw] sm:h-[92vh] p-0 overflow-y-auto rounded-xl">
        <VisuallyHidden>
          <DialogTitle>List Your Item</DialogTitle>
        </VisuallyHidden>
        <ModalErrorBoundary>
          <LendPage isModal onClose={onClose} />
        </ModalErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

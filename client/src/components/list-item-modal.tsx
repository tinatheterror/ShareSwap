import { Dialog, DialogContent } from "@/components/ui/dialog";
import LendPage from "@/pages/lend-page";

interface ListItemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ListItemModal({ isOpen, onClose }: ListItemModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-none w-full h-full sm:w-[95vw] sm:h-[92vh] p-0 overflow-y-auto rounded-xl">
        <LendPage isModal onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

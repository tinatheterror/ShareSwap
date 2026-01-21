import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, UserCheck } from "lucide-react";
import { useLocation } from "wouter";

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VerificationModal({ isOpen, onClose }: VerificationModalProps) {
  const [, navigate] = useLocation();

  const handleVerifyNow = () => {
    onClose();
    navigate("/profile#verification-status");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-[#0BB88C]/10 rounded-lg">
              <Shield className="h-6 w-6 text-[#0BB88C]" />
            </div>
            <DialogTitle className="text-xl">
              Verify your profile to continue
            </DialogTitle>
          </div>
          <DialogDescription className="text-gray-600 pt-2">
            Verification helps keep the community safe and lowers trust-deposit requirements.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-start gap-3">
            <UserCheck className="h-5 w-5 text-[#0BB88C] mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Why verify?</p>
              <ul className="mt-2 text-sm text-gray-600 space-y-1">
                <li>• Lower security deposits on borrows</li>
                <li>• Faster request approvals</li>
                <li>• Build trust with neighbors</li>
                <li>• Priority in matching</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            Not now
          </Button>
          <Button
            onClick={handleVerifyNow}
            className="flex-1 bg-[#0BB88C] hover:bg-[#0BB88C]/90"
          >
            Verify now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { VerificationModal } from "@/components/shared/verification-modal";
import {
  isLocked,
  lockedPrompt,
  readCapabilities,
  type CapabilityFlag,
} from "@/lib/verification-capabilities";

export function useVerification() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);

  /** Runs the action if the server allows it, otherwise shows the prompt for what is missing. */
  const requireCapability = useCallback(
    (flag: CapabilityFlag, action: () => void) => {
      if (!user) {
        return;
      }

      if (!isLocked(user, flag)) {
        action();
        return;
      }

      if (lockedPrompt(user) === "email") {
        toast({
          title: "Verify your email first",
          description: "Please verify your email address to swap, claim gifts or list items.",
          variant: "destructive",
        });
      } else {
        setShowModal(true);
      }
    },
    [user, toast]
  );

  const missing = readCapabilities(user)?.missing ?? [];

  const VerificationModalComponent = useCallback(
    () => (
      <VerificationModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        missing={missing}
      />
    ),
    [showModal, missing.join(",")]
  );

  return {
    capabilities: readCapabilities(user),
    requireCapability,
    showVerificationModal: () => setShowModal(true),
    VerificationModal: VerificationModalComponent,
  };
}

import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { VerificationModal } from "@/components/shared/verification-modal";

export function useVerification() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const checkVerification = useCallback(
    (onVerified: () => void): boolean => {
      if (!user) {
        return false;
      }

      if (user.isVerified) {
        onVerified();
        return true;
      }

      setShowModal(true);
      return false;
    },
    [user]
  );

  const requireVerification = useCallback(
    (action: () => void) => {
      if (!user) {
        return;
      }

      if (user.isVerified) {
        action();
      } else {
        setShowModal(true);
      }
    },
    [user]
  );

  const VerificationModalComponent = useCallback(
    () => (
      <VerificationModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    ),
    [showModal]
  );

  return {
    isVerified: user?.isVerified ?? false,
    checkVerification,
    requireVerification,
    showVerificationModal: () => setShowModal(true),
    VerificationModal: VerificationModalComponent,
  };
}

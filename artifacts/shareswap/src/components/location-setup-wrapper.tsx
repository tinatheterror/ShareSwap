import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { LocationSetupModal } from "./location-setup-modal";

export function LocationSetupWrapper() {
  const { user, isLoading } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    if (!isLoading && user && !user.hasCompletedLocationSetup && location !== "/auth") {
      setShowModal(true);
    }
  }, [user, isLoading, location]);

  const handleComplete = () => {
    setShowModal(false);
    window.dispatchEvent(new Event("location-setup-complete"));
  };

  if (isLoading || !user) {
    return null;
  }

  return (
    <LocationSetupModal 
      open={showModal} 
      onComplete={handleComplete}
    />
  );
}

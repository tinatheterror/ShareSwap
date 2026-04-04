import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coins, ChevronRight, X } from "lucide-react";
import { useLocation } from "wouter";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  required: number;
  context?: "borrow" | "swap";
};

export function InsufficientShareCoinsModal({
  isOpen,
  onClose,
  currentBalance,
  required,
  context = "borrow",
}: Props) {
  const [, navigate] = useLocation();
  const shortfall = Math.max(0, required - currentBalance);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden gap-0">
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-400 to-orange-400 p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center justify-center w-14 h-14 bg-white/20 rounded-full mx-auto mb-3">
            <Coins className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-center">Not enough ShareCoins</h2>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 bg-white">
          {/* Shortfall message */}
          <p className="text-center text-gray-700 font-medium">
            You need{" "}
            <span className="text-orange-500 font-bold">{shortfall} more ShareCoin{shortfall !== 1 ? "s" : ""}</span>{" "}
            to {context === "borrow" ? "borrow this" : "complete this swap"}.
          </p>

          {/* Balance breakdown */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Your balance</span>
              <span className="font-semibold text-gray-800 flex items-center gap-1">
                <Coins className="h-3.5 w-3.5 text-teal-500" />
                {currentBalance} SC
              </span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Required</span>
              <span className="font-semibold text-gray-800 flex items-center gap-1">
                <Coins className="h-3.5 w-3.5 text-orange-400" />
                {required} SC
              </span>
            </div>
            <div className="border-t pt-2 flex justify-between">
              <span className="font-medium text-gray-700">Shortfall</span>
              <span className="font-bold text-orange-500 flex items-center gap-1">
                <Coins className="h-3.5 w-3.5" />
                {shortfall} SC
              </span>
            </div>
          </div>

          {/* CTA */}
          <Button
            className="w-full bg-teal-500 hover:bg-teal-600 text-white font-semibold"
            onClick={() => {
              onClose();
              navigate("/sharecoins-info");
            }}
          >
            Earn ShareCoins
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>

          <button
            onClick={onClose}
            className="w-full text-sm text-muted-foreground hover:text-gray-700 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

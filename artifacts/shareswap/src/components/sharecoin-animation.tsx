import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

interface CoinDrop {
  id: number;
  amount: number;
}

export function ShareCoinAnimation() {
  const { user } = useAuth();
  const prevCoins = useRef<number | null>(null);
  const [drops, setDrops] = useState<CoinDrop[]>([]);
  const dropIdRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    const current = Number(user.shareCoins ?? 0);
    if (prevCoins.current === null) {
      prevCoins.current = current;
      return;
    }
    const diff = current - prevCoins.current;
    if (diff > 0) {
      const id = ++dropIdRef.current;
      const amount = Math.round(diff * 100) / 100;
      setDrops((prev) => [...prev, { id, amount }]);
      setTimeout(() => {
        setDrops((prev) => prev.filter((d) => d.id !== id));
      }, 2000);
    }
    prevCoins.current = current;
  }, [user?.shareCoins]);

  if (drops.length === 0) return null;

  return (
    <>
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="fixed inset-0 flex items-start justify-center pointer-events-none z-[9999]"
          style={{ top: 0 }}
        >
          <div
            style={{
              animation: "coinDrop 1.8s cubic-bezier(0.22, 1, 0.36, 1) forwards",
            }}
            className="flex flex-col items-center mt-16"
          >
            <span style={{ fontSize: "72px", lineHeight: 1, filter: "drop-shadow(0 4px 12px rgba(234,179,8,0.6))" }}>
              🪙
            </span>
            <span
              className="mt-1 font-bold text-yellow-500 text-lg"
              style={{ textShadow: "0 1px 4px rgba(0,0,0,0.25)" }}
            >
              +{drop.amount}
            </span>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes coinDrop {
          0%   { opacity: 0; transform: translateY(-80px) scale(0.5) rotate(-15deg); }
          15%  { opacity: 1; transform: translateY(0px) scale(1.15) rotate(5deg); }
          30%  { transform: translateY(-20px) scale(1) rotate(-3deg); }
          45%  { transform: translateY(10px) scale(1.05) rotate(2deg); }
          60%  { transform: translateY(-8px) scale(1) rotate(0deg); }
          75%  { transform: translateY(4px) scale(1) rotate(0deg); }
          85%  { opacity: 1; transform: translateY(0px) scale(1) rotate(0deg); }
          100% { opacity: 0; transform: translateY(20px) scale(0.8) rotate(0deg); }
        }
      `}</style>
    </>
  );
}

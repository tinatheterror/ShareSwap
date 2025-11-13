import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface MarketplaceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
}

export function MarketplaceCard({
  title,
  description,
  icon,
  onClick,
  className,
}: MarketplaceCardProps) {
  return (
    <motion.button
      onClick={onClick}
      className={cn(
        "w-full h-full flex flex-col items-center text-center p-8 rounded-xl border-0",
        "bg-primary/60",
        "cursor-pointer relative overflow-hidden",
        "transition-all duration-75",
        className
      )}
      whileHover={{
        scale: 1.05,
        backgroundColor: "hsl(var(--primary) / 0.7)",
        boxShadow: "0 10px 40px -10px hsl(var(--primary) / 0.5)",
      }}
      whileTap={{
        scale: 0.98,
        boxShadow: "0 5px 20px -5px hsl(var(--primary) / 0.3)",
      }}
      transition={{
        type: "spring",
        stiffness: 800,
        damping: 15,
      }}
    >
      <motion.div
        className="p-4 bg-primary/50 rounded-full mb-4"
        whileHover={{ rotate: 5, scale: 1.1 }}
        transition={{ type: "spring", stiffness: 700, damping: 12 }}
      >
        {icon}
      </motion.div>
      <h3 className="text-xl font-semibold mb-3 text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </motion.button>
  );
}
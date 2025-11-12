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
        "w-full h-full flex flex-col items-center text-center p-8 rounded-lg border-2",
        "cursor-pointer relative overflow-hidden",
        "transition-all duration-300",
        className
      )}
      style={{
        backgroundColor: "#0D94881A",
        borderColor: "#0D948833",
      }}
      whileHover={{
        scale: 1.05,
        borderColor: "#0D948880",
        backgroundColor: "#0D948826",
        boxShadow: "0 10px 40px -10px #0D94884D",
      }}
      whileTap={{
        scale: 0.98,
        boxShadow: "0 5px 20px -5px #0D948833",
      }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
      }}
    >
      <motion.div
        className="p-3 rounded-full mb-4"
        style={{
          backgroundColor: "#0D948833",
        }}
        whileHover={{ rotate: 5, scale: 1.1 }}
        transition={{ type: "spring", stiffness: 300 }}
      >
        {icon}
      </motion.div>
      <h3 className="text-xl font-semibold mb-3">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </motion.button>
  );
}
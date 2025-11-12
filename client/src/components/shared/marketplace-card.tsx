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
        "bg-primary/10 border-primary/20",
        "cursor-pointer relative overflow-hidden",
        "transition-all duration-300",
        className
      )}
      whileHover={{
        scale: 1.05,
        borderColor: "hsl(var(--primary) / 0.5)",
        backgroundColor: "hsl(var(--primary) / 0.15)",
        boxShadow: "0 10px 40px -10px hsl(var(--primary) / 0.3)",
      }}
      whileTap={{
        scale: 0.98,
        boxShadow: "0 5px 20px -5px hsl(var(--primary) / 0.2)",
      }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
      }}
    >
      <motion.div
        className="p-3 bg-primary/20 rounded-full mb-4"
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
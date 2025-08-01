import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

interface RollingCounterProps {
  target: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  formatter?: (value: number) => string;
}

export function RollingCounter({
  target,
  duration = 2,
  className = "",
  prefix = "",
  suffix = "",
  formatter
}: RollingCounterProps) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => {
    if (formatter) {
      return formatter(Math.round(latest));
    }
    return Math.round(latest).toLocaleString();
  });

  useEffect(() => {
    const controls = animate(count, target, {
      duration,
      ease: "easeOut",
    });

    return controls.stop;
  }, [count, target, duration]);

  return (
    <motion.span className={className}>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </motion.span>
  );
}

interface CounterStatsProps {
  stats: Array<{
    label: string;
    value: number;
    prefix?: string;
    suffix?: string;
    formatter?: (value: number) => string;
  }>;
  className?: string;
}

export function CounterStats({ stats, className = "" }: CounterStatsProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger animation after component mounts
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${className}`}>
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1, duration: 0.5 }}
        >
          <div className="text-3xl md:text-4xl font-bold text-primary mb-2">
            {isVisible ? (
              <RollingCounter
                target={stat.value}
                prefix={stat.prefix}
                suffix={stat.suffix}
                formatter={stat.formatter}
                duration={2 + index * 0.3}
              />
            ) : (
              "0"
            )}
          </div>
          <div className="text-sm text-muted-foreground font-medium">
            {stat.label}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
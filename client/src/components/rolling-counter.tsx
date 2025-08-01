import { useEffect, useState } from "react";

interface RollingCounterProps {
  target: number;
  duration?: number;
  className?: string;
}

export function RollingCounter({ target, duration = 2000, className = "" }: RollingCounterProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (target === 0) return;

    const startTime = Date.now();
    const startValue = 0;
    
    const updateCount = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = Math.floor(startValue + (target - startValue) * easeOutQuart);
      
      setCount(currentValue);
      
      if (progress < 1) {
        requestAnimationFrame(updateCount);
      }
    };

    requestAnimationFrame(updateCount);
  }, [target, duration]);

  return (
    <span className={className}>
      {count.toLocaleString()}
    </span>
  );
}
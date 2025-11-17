import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface TutorialTooltipProps {
  isOpen: boolean;
  onClose: () => void;
  targetSelector: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Position = 'top' | 'bottom' | 'left' | 'right';

export function TutorialTooltip({
  isOpen,
  onClose,
  targetSelector,
  title,
  description,
  actionLabel,
  onAction
}: TutorialTooltipProps) {
  const [position, setPosition] = useState<Position>('bottom');
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const targetElement = document.querySelector(targetSelector);
      if (!targetElement || !tooltipRef.current) return;

      const targetRect = targetElement.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const padding = 12;
      const arrowSize = 8;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let bestPosition: Position = 'bottom';
      let top = 0;
      let left = 0;

      const spaceAbove = targetRect.top;
      const spaceBelow = viewportHeight - targetRect.bottom;
      const spaceLeft = targetRect.left;
      const spaceRight = viewportWidth - targetRect.right;

      if (spaceBelow >= tooltipRect.height + padding + arrowSize) {
        bestPosition = 'bottom';
        top = targetRect.bottom + padding + arrowSize;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
      } else if (spaceAbove >= tooltipRect.height + padding + arrowSize) {
        bestPosition = 'top';
        top = targetRect.top - tooltipRect.height - padding - arrowSize;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
      } else if (spaceRight >= tooltipRect.width + padding + arrowSize) {
        bestPosition = 'right';
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        left = targetRect.right + padding + arrowSize;
      } else if (spaceLeft >= tooltipRect.width + padding + arrowSize) {
        bestPosition = 'left';
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        left = targetRect.left - tooltipRect.width - padding - arrowSize;
      }

      left = Math.max(padding, Math.min(left, viewportWidth - tooltipRect.width - padding));
      top = Math.max(padding, Math.min(top, viewportHeight - tooltipRect.height - padding));

      setPosition(bestPosition);
      setCoords({ top, left });
    };

    const timer = setTimeout(updatePosition, 50);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
    };
  }, [isOpen, targetSelector]);

  if (!isOpen) return null;

  const arrowStyles = {
    top: 'bottom-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white',
    bottom: 'top-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-white',
    left: 'right-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-l-8 border-t-transparent border-b-transparent border-l-white',
    right: 'left-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-white'
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[9998]" onClick={onClose} />
      
      <AnimatePresence>
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed z-[9999] bg-white rounded-lg shadow-2xl border-2 border-teal-500 p-4 max-w-sm"
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`,
          }}
        >
          <div className={`absolute w-0 h-0 ${arrowStyles[position]} drop-shadow-sm`} />
          
          <button
            onClick={onClose}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="pr-6">
            <h3 className="font-semibold text-sm text-slate-800 mb-1">{title}</h3>
            <p className="text-xs text-slate-600 mb-3 leading-relaxed">{description}</p>
            
            <div className="flex gap-2">
              <Button
                onClick={onClose}
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
              >
                Got It
              </Button>
              {actionLabel && onAction && (
                <Button
                  onClick={() => {
                    onAction();
                    onClose();
                  }}
                  size="sm"
                  className="flex-1 h-8 text-xs bg-teal-600 hover:bg-teal-700"
                >
                  {actionLabel}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}

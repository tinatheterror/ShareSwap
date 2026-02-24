import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X, Sparkles } from 'lucide-react';

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

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

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
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [hasTarget, setHasTarget] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const hasScrolledRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const calculatePositions = useCallback(() => {
    const targetElement = document.querySelector(targetSelector) as HTMLElement;
    if (!targetElement) {
      setTargetRect(null);
      setHasTarget(false);
      setIsReady(true);
      return;
    }

    setHasTarget(true);

    if (!hasScrolledRef.current) {
      hasScrolledRef.current = true;
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    setTimeout(() => {
      const rect = targetElement.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right,
      });

      if (!tooltipRef.current) {
        setIsReady(true);
        return;
      }

      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const padding = 12;
      const arrowSize = 8;
      const safeArea = 20;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let bestPosition: Position = 'bottom';
      let top = 0;
      let left = 0;

      const spaceAbove = rect.top - safeArea;
      const spaceBelow = viewportHeight - rect.bottom - safeArea;
      const spaceLeft = rect.left - safeArea;
      const spaceRight = viewportWidth - rect.right - safeArea;

      const tooltipHeight = tooltipRect.height || 150;
      const tooltipWidth = tooltipRect.width || 280;

      if (spaceBelow >= tooltipHeight + padding + arrowSize) {
        bestPosition = 'bottom';
        top = rect.bottom + padding + arrowSize;
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
      } else if (spaceAbove >= tooltipHeight + padding + arrowSize) {
        bestPosition = 'top';
        top = rect.top - tooltipHeight - padding - arrowSize;
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
      } else if (spaceRight >= tooltipWidth + padding + arrowSize) {
        bestPosition = 'right';
        top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
        left = rect.right + padding + arrowSize;
      } else if (spaceLeft >= tooltipWidth + padding + arrowSize) {
        bestPosition = 'left';
        top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
        left = rect.left - tooltipWidth - padding - arrowSize;
      } else {
        bestPosition = 'bottom';
        top = Math.min(rect.bottom + padding, viewportHeight - tooltipHeight - padding);
        left = Math.max(padding, (viewportWidth - tooltipWidth) / 2);
      }

      left = Math.max(padding, Math.min(left, viewportWidth - tooltipWidth - padding));
      top = Math.max(safeArea, Math.min(top, viewportHeight - tooltipHeight - padding));

      setPosition(bestPosition);
      setCoords({ top, left });
      setIsReady(true);
    }, 100);
  }, [targetSelector]);

  useEffect(() => {
    if (!isOpen) {
      setIsReady(false);
      setTargetRect(null);
      setHasTarget(false);
      hasScrolledRef.current = false;
      return;
    }

    calculatePositions();

    const retryTimer = setTimeout(calculatePositions, 300);

    return () => clearTimeout(retryTimer);
  }, [isOpen, targetSelector, calculatePositions]);

  useEffect(() => {
    if (!isOpen || !targetRect) return;

    let lastUpdate = 0;
    const throttleMs = 250;

    const handleUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate < throttleMs) return;
      lastUpdate = now;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(calculatePositions);
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('orientationchange', handleUpdate);

    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('orientationchange', handleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, targetRect, calculatePositions]);

  if (!isOpen) return null;

  if (isMobile || !hasTarget) {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-[9998]" onClick={onClose} />
        <AnimatePresence>
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[9999] bg-white rounded-t-2xl shadow-2xl p-5 pb-8"
            style={{ maxHeight: '60vh' }}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#0DCEA1' }}
              >
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base text-slate-800 mb-1">{title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <Button
                onClick={onClose}
                variant="outline"
                size="lg"
                className="flex-1 h-11 text-sm font-medium"
              >
                Got It
              </Button>
              {actionLabel && onAction && (
                <Button
                  onClick={() => {
                    onAction();
                    onClose();
                  }}
                  size="lg"
                  className="flex-1 h-11 text-sm font-medium text-white"
                  style={{ backgroundColor: '#0DCEA1' }}
                >
                  {actionLabel}
                </Button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </>
    );
  }

  const arrowStyles = {
    top: 'bottom-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white',
    bottom: 'top-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-white',
    left: 'right-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-l-8 border-t-transparent border-b-transparent border-l-white',
    right: 'left-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-white'
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={onClose} />
      
      {targetRect && (
        <>
          <svg
            className="fixed inset-0 z-[9998] pointer-events-none"
            style={{ width: '100vw', height: '100vh' }}
          >
            <defs>
              <mask id="tooltip-spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect
                  x={targetRect.left - 8}
                  y={targetRect.top - 8}
                  width={targetRect.width + 16}
                  height={targetRect.height + 16}
                  rx="8"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.5)"
              mask="url(#tooltip-spotlight-mask)"
            />
          </svg>

          <div
            className="fixed z-[9998] pointer-events-none"
            style={{
              top: targetRect.top - 8,
              left: targetRect.left - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
              border: '3px solid #0d9488',
              borderRadius: '12px',
              boxShadow: '0 0 0 4px rgba(13, 148, 136, 0.3)',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            }}
          />
        </>
      )}
      
      <AnimatePresence>
        {isReady && (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed z-[9999] bg-white rounded-lg shadow-2xl border-2 border-teal-500 p-4 w-[calc(100vw-32px)] max-w-sm"
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
                    className="flex-1 h-8 text-xs " style={{ backgroundColor: "#0DCEA1" }}
                  >
                    {actionLabel}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

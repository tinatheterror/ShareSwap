import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Heart, Star, Sparkles } from 'lucide-react';

interface CelebrationAnimationProps {
  isVisible: boolean;
  onComplete: () => void;
  message?: string;
}

export function CelebrationAnimation({ isVisible, onComplete, message = "Great match!" }: CelebrationAnimationProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setShowConfetti(true);
      
      // Play success sound (you can replace this with an actual audio file)
      const playSuccessSound = () => {
        try {
          // Create a simple success tone using Web Audio API
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContext) return;
          
          const audioContext = new AudioContext();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
          oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
          oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
          
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
          console.log('Audio playback not available');
        }
      };

      playSuccessSound();

      // Complete animation after delay
      const timer = setTimeout(() => {
        setShowConfetti(false);
        setTimeout(onComplete, 300);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isVisible, onComplete]);

  const confettiElements = Array.from({ length: 20 }, (_, i) => (
    <motion.div
      key={i}
      className="absolute"
      initial={{
        x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 800),
        y: -10,
        rotate: 0,
        scale: 0
      }}
      animate={{
        y: (typeof window !== 'undefined' ? window.innerHeight : 600) + 10,
        rotate: Math.random() * 360,
        scale: 1
      }}
      transition={{
        duration: 2 + Math.random(),
        delay: Math.random() * 0.5,
        ease: "easeOut"
      }}
    >
      <div
        className={`w-3 h-3 ${
          i % 4 === 0 ? 'bg-teal-400' :
          i % 4 === 1 ? 'bg-teal-400' :
          i % 4 === 2 ? 'bg-teal-400' : 'bg-teal-400'
        } rounded-full`}
      />
    </motion.div>
  ));

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Confetti */}
          {showConfetti && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {confettiElements}
            </div>
          )}

          {/* Main celebration content */}
          <motion.div
            className="bg-white rounded-2xl p-8 shadow-2xl text-center max-w-sm mx-4"
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 10 }}
            transition={{ 
              type: "spring", 
              damping: 15, 
              stiffness: 300,
              duration: 0.6 
            }}
          >
            {/* Success icon with pulse animation */}
            <motion.div
              className="relative mx-auto w-20 h-20 mb-4"
              animate={{ 
                scale: [1, 1.1, 1],
                rotate: [0, 5, -5, 0] 
              }}
              transition={{ 
                duration: 0.8, 
                repeat: Infinity,
                repeatDelay: 1
              }}
            >
              <div className="absolute inset-0 bg-teal-100 rounded-full"></div>
              <CheckCircle className="w-20 h-20 text-teal-500" />
              
              {/* Sparkle effects around the icon */}
              <motion.div
                className="absolute -top-2 -right-2"
                animate={{ 
                  scale: [0, 1, 0],
                  rotate: [0, 180, 360] 
                }}
                transition={{ 
                  duration: 1.5, 
                  repeat: Infinity,
                  delay: 0.3
                }}
              >
                <Sparkles className="w-6 h-6 text-teal-400" />
              </motion.div>
              
              <motion.div
                className="absolute -bottom-1 -left-2"
                animate={{ 
                  scale: [0, 1, 0],
                  rotate: [360, 180, 0] 
                }}
                transition={{ 
                  duration: 1.5, 
                  repeat: Infinity,
                  delay: 0.8
                }}
              >
                <Star className="w-5 h-5 text-teal-400" />
              </motion.div>

              <motion.div
                className="absolute top-1 -left-3"
                animate={{ 
                  scale: [0, 1, 0],
                  y: [0, -10, 0]
                }}
                transition={{ 
                  duration: 1.2, 
                  repeat: Infinity,
                  delay: 1.1
                }}
              >
                <Heart className="w-4 h-4 text-teal-400" />
              </motion.div>
            </motion.div>

            {/* Success message */}
            <motion.h2
              className="text-2xl font-bold text-gray-800 mb-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              Perfect Match! 🎉
            </motion.h2>
            
            <motion.p
              className="text-gray-600 mb-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              {message}
            </motion.p>

            {/* Animated button */}
            <motion.div
              className="bg-gradient-to-r from-teal-400 to-teal-500 text-white px-6 py-2 rounded-full text-sm font-semibold"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.7 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Let's schedule pickup! 📅
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
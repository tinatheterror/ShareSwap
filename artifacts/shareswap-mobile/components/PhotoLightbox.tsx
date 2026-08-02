import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { photoUrl } from "@/lib/api";

interface Props {
  photos: string[];
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
}

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };
const MAX_SCALE = 5;
const MIN_SCALE = 1;

function ZoomablePhoto({
  uri,
  width,
  height,
  onSwipeDown,
}: {
  uri: string | undefined;
  width: number;
  height: number;
  onSwipeDown: () => void;
}) {
  // Zoom / pan shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset on mount / photo change
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [uri]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, savedScale.value * e.scale)
      );
    })
    .onEnd(() => {
      if (scale.value < MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
      }
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Panning while zoomed
        const maxX = (width * (scale.value - 1)) / 2;
        const maxY = (height * (scale.value - 1)) / 2;
        translateX.value = Math.max(
          -maxX,
          Math.min(maxX, savedTranslateX.value + e.translationX)
        );
        translateY.value = Math.max(
          -maxY,
          Math.min(maxY, savedTranslateY.value + e.translationY)
        );
      } else {
        // Swipe-down to dismiss when not zoomed
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value <= 1) {
        // If swiped down fast or far enough, dismiss
        if (e.translationY > 100 || e.velocityY > 800) {
          runOnJS(onSwipeDown)();
        } else {
          translateY.value = withSpring(0, SPRING_CONFIG);
        }
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1, SPRING_CONFIG);
        savedScale.value = 1;
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2.5, SPRING_CONFIG);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(
    pinchGesture,
    Gesture.Race(doubleTapGesture, panGesture)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[{ width, height }, animatedStyle]}>
        <Image
          source={{ uri }}
          style={{ width, height }}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
}

export function PhotoLightbox({
  photos,
  initialIndex = 0,
  visible,
  onClose,
}: Props) {
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);

  useEffect(() => {
    if (visible) setCurrentIndex(initialIndex);
  }, [visible, initialIndex]);

  function goNext() {
    setCurrentIndex((i) => Math.min(i + 1, photos.length - 1));
  }

  function goPrev() {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }

  if (!visible || photos.length === 0) return null;

  const uri = photoUrl(photos[currentIndex] ?? "");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: "#000" }]}>
        {/* Close button */}
        <Pressable
          style={[styles.closeBtn, { top: Platform.OS === "android" ? 40 : 56 }]}
          onPress={onClose}
          hitSlop={16}
        >
          <Feather name="x" size={24} color="#fff" />
        </Pressable>

        {/* Photo counter */}
        {photos.length > 1 && (
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {currentIndex + 1} / {photos.length}
            </Text>
          </View>
        )}

        {/* Zoomable image */}
        <ZoomablePhoto
          uri={uri}
          width={width}
          height={height}
          onSwipeDown={onClose}
        />

        {/* Prev / Next arrows */}
        {photos.length > 1 && (
          <>
            {currentIndex > 0 && (
              <Pressable
                style={[styles.navBtn, styles.navLeft]}
                onPress={goPrev}
                hitSlop={16}
              >
                <Feather name="chevron-left" size={28} color="#fff" />
              </Pressable>
            )}
            {currentIndex < photos.length - 1 && (
              <Pressable
                style={[styles.navBtn, styles.navRight]}
                onPress={goNext}
                hitSlop={16}
              >
                <Feather name="chevron-right" size={28} color="#fff" />
              </Pressable>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute",
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    padding: 8,
  },
  counter: {
    position: "absolute",
    top: Platform.OS === "android" ? 44 : 60,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  counterText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  navBtn: {
    position: "absolute",
    top: "50%",
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 24,
    padding: 10,
    marginTop: -24,
  },
  navLeft: {
    left: 16,
  },
  navRight: {
    right: 16,
  },
});

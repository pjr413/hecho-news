import { Image } from 'expo-image';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import type { Action, Photo } from './types';

/** Screen measurements the card needs to know where the album tiles are. */
export type Geometry = {
  width: number;
  height: number;
  /** Bottom edge of the top album row. */
  topEdge: number;
  topCenterY: number;
  /** Top edge of the bottom album row. */
  bottomEdge: number;
  bottomCenterY: number;
  cardCenterY: number;
};

export type PhotoCardHandle = { send: (action: Action) => void };

type Props = {
  photo: Photo;
  active: boolean;
  favorite: boolean;
  geometry: SharedValue<Geometry>;
  hoverSlot: SharedValue<number>;
  onDecide: (action: Action) => void;
  onFavorite: () => void;
};

const FLICK_SPEED = 800;
const OUT = { duration: 210 };

export const PhotoCard = forwardRef<PhotoCardHandle, Props>(function PhotoCard(
  { photo, active, favorite, geometry, hoverSlot, onDecide, onFavorite },
  ref,
) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const shrink = useSharedValue(1);
  const leaving = useSharedValue(false);
  const front = useSharedValue(active ? 1 : 0);
  const heart = useSharedValue(0);
  // Speed from the last move event: the release event doesn't reliably carry one.
  const speedX = useSharedValue(0);
  const speedY = useSharedValue(0);
  const movedAt = useSharedValue(0);

  useEffect(() => {
    front.value = withTiming(active ? 1 : 0, { duration: 180 });
  }, [active, front]);

  const slotAt = (x: number, y: number) => {
    'worklet';
    const g = geometry.value;
    const column = Math.min(3, Math.max(0, Math.floor(x / (g.width / 4))));
    if (y < g.topEdge) return column;
    if (y > g.bottomEdge) return 4 + column;
    return -1;
  };

  const leave = (action: Action) => {
    'worklet';
    if (leaving.value) return;
    leaving.value = true;
    hoverSlot.value = -1;
    const g = geometry.value;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDecide, action);
    };
    if (action.type === 'trash') {
      ty.value = withTiming(-g.height, OUT, done);
    } else if (action.type === 'keep') {
      const dir = tx.value < 0 ? -1 : 1;
      tx.value = withTiming(dir * g.width * 1.3, OUT, done);
    } else {
      const column = action.slot % 4;
      const targetY = action.slot < 4 ? g.topCenterY : g.bottomCenterY;
      tx.value = withTiming((column + 0.5) * (g.width / 4) - g.width / 2, OUT);
      ty.value = withTiming(targetY - g.cardCenterY, OUT);
      shrink.value = withTiming(0.12, OUT, done);
    }
  };

  useImperativeHandle(ref, () => ({
    send: (action: Action) => scheduleOnUI(leave, action),
  }));

  const pan = usePanGesture({
    enabled: active,
    minDistance: 6,
    onUpdate: (e) => {
      'worklet';
      if (leaving.value) return;
      tx.value = e.translationX;
      ty.value = e.translationY;
      speedX.value = e.velocityX;
      speedY.value = e.velocityY;
      movedAt.value = Date.now();
      hoverSlot.value = slotAt(e.absoluteX, e.absoluteY);
    },
    onDeactivate: (e) => {
      'worklet';
      if (leaving.value) return;
      const slot = e.canceled ? -1 : slotAt(e.absoluteX, e.absoluteY);
      hoverSlot.value = -1;
      // A finger that paused before letting go is a drop, not a flick.
      const moving = Date.now() - movedAt.value < 90;
      const rawX = Math.abs(e.velocityX) > Math.abs(speedX.value) ? e.velocityX : speedX.value;
      const rawY = Math.abs(e.velocityY) > Math.abs(speedY.value) ? e.velocityY : speedY.value;
      const vx = moving ? rawX : 0;
      const vy = moving ? rawY : 0;
      const upward = Math.abs(vy) > Math.abs(vx) * 1.2;
      const flickedUp = !e.canceled && vy < -FLICK_SPEED && e.translationY < -30 && upward;
      const sideways =
        !e.canceled &&
        Math.abs(e.translationX) > Math.abs(e.translationY) &&
        (Math.abs(e.translationX) > 110 || Math.abs(vx) > 900);

      if (flickedUp) leave({ type: 'trash' });
      else if (slot >= 0) leave({ type: 'album', slot });
      else if (sideways) leave({ type: 'keep' });
      else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    },
  });

  const doubleTap = useTapGesture({
    enabled: active,
    numberOfTaps: 2,
    onActivate: () => {
      'worklet';
      heart.value = withSequence(
        withTiming(1, { duration: 160 }),
        withTiming(1, { duration: 260 }),
        withTiming(0, { duration: 220 }),
      );
      scheduleOnRN(onFavorite);
    },
  });

  const gesture = useSimultaneousGestures(pan, doubleTap);

  const cardStyle = useAnimatedStyle(() => {
    const drag = interpolate(Math.abs(ty.value), [0, 240], [1, 0.42], Extrapolation.CLAMP);
    // Go see-through over an album so the tile underneath stays readable.
    const over = hoverSlot.value >= 0 && !leaving.value ? 0.55 : 1;
    const rest = interpolate(front.value, [0, 1], [0.93, 1]);
    return {
      opacity: interpolate(front.value, [0, 1], [0.45, 1]) * over,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { rotate: `${tx.value / 22}deg` },
        { scale: drag * rest * shrink.value },
      ],
    };
  });

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heart.value,
    transform: [{ scale: interpolate(heart.value, [0, 1], [0.4, 1]) }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.card, cardStyle]}
        pointerEvents={active ? 'auto' : 'none'}
        testID={active ? 'photo-card' : undefined}
      >
        <Image
          source={{ uri: photo.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
          pointerEvents="none"
        />
        {favorite && (
          <View style={styles.badge} testID="favorite-badge">
            <Text style={styles.badgeText}>♥</Text>
          </View>
        )}
        <Animated.View style={[styles.heartWrap, heartStyle]} pointerEvents="none">
          <Text style={[styles.heart, !favorite && styles.heartOff]}>♥</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  card: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#17191F',
  },
  badge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  badgeText: { color: '#FF5A7A', fontSize: 18 },
  heartWrap: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    fontSize: 120,
    color: '#FF5A7A',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 12,
  },
  heartOff: { color: 'rgba(255,255,255,0.75)' },
});

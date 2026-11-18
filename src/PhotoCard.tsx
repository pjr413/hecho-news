import { Image } from 'expo-image';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
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

import { ROW_SIZE, type Action, type Photo } from './types';

/** Screen measurements the card needs to know where the album tiles are. */
export type Geometry = {
  width: number;
  height: number;
  /** Bit i is set when spot i has an album; empty spots can't be dropped on. */
  filled: number;
  /**
   * For each album row (top to bottom as numbered): where a finger counts as over it
   * (min <= y < max) and where its middle is. Equal bounds mean there is no such row.
   */
  rowMin: number[];
  rowMax: number[];
  rowCenter: number[];
  cardCenterY: number;
};

export type PhotoCardHandle = { send: (action: Action) => void };

/**
 * Where a photo sits on the timeline relative to the one being shown.
 * `prev` waits off-screen to the left, `next` waits underneath.
 */
export type Role = 'prev' | 'current' | 'next';
const ROLE_CODE = { prev: 0, current: 1, next: 2 } as const;

type Props = {
  photo: Photo;
  role: Role;
  favorite: boolean;
  canBack: boolean;
  canForward: boolean;
  geometry: SharedValue<Geometry>;
  hoverSlot: SharedValue<number>;
  onDecide: (action: Action) => void;
  onFavorite: () => void;
  /** Videos get a play button when this install can play them. */
  canPlay: boolean;
  onPlay: () => void;
};

const FLICK_SPEED = 800;

function formatDuration(seconds?: number): string {
  const t = Math.round(seconds ?? 0);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
/** Pinching a photo down to this fraction of its size (or less) sends it to the bin. */
const PINCH_TRASH = 0.7;
const OUT = { duration: 210 };
/** Far enough left that a waiting card is never visible, on any phone. */
const OFFSCREEN = 1200;

export const PhotoCard = forwardRef<PhotoCardHandle, Props>(function PhotoCard(
  { photo, role, favorite, canBack, canForward, geometry, hoverSlot, onDecide, onFavorite, canPlay, onPlay },
  ref,
) {
  const active = role === 'current';
  const tx = useSharedValue(role === 'prev' ? -OFFSCREEN : 0);
  const ty = useSharedValue(0);
  const shrink = useSharedValue(1);
  const leaving = useSharedValue(false);
  const pinch = useSharedValue(1);
  /** 1 while waiting underneath the current photo, 0 otherwise. */
  const depth = useSharedValue(role === 'next' ? 1 : 0);
  const roleCode = useSharedValue<number>(ROLE_CODE[role]);
  const canBackSV = useSharedValue(canBack);
  const canForwardSV = useSharedValue(canForward);
  const heart = useSharedValue(0);
  // Speed from the last move event: the release event doesn't reliably carry one.
  const speedX = useSharedValue(0);
  const speedY = useSharedValue(0);
  const movedAt = useSharedValue(0);

  useEffect(() => {
    canBackSV.value = canBack;
    canForwardSV.value = canForward;
  }, [canBack, canForward, canBackSV, canForwardSV]);

  // Move to the right place when the timeline moves on or back.
  const wasRole = useRef(role);
  useEffect(() => {
    roleCode.value = ROLE_CODE[role];
    const was = wasRole.current;
    wasRole.current = role;
    if (was === role) return;
    if (role === 'current') {
      // Slides in from the left when coming back to it; otherwise it was already in place.
      leaving.value = false;
      shrink.value = 1;
      ty.value = withTiming(0, { duration: 180 });
      tx.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
      depth.value = withTiming(0, { duration: 180 });
    } else if (role === 'next') {
      depth.value = withTiming(1, { duration: 180 });
      if (!leaving.value) {
        tx.value = 0;
        ty.value = 0;
        shrink.value = 1;
      }
    } else {
      depth.value = 0;
      if (!leaving.value) tx.value = -OFFSCREEN;
    }
  }, [role, roleCode, leaving, shrink, tx, ty, depth]);

  const slotAt = (x: number, y: number) => {
    'worklet';
    const g = geometry.value;
    const column = Math.min(ROW_SIZE - 1, Math.max(0, Math.floor(x / (g.width / ROW_SIZE))));
    let slot = -1;
    for (let r = 0; r < g.rowMin.length; r++) {
      if (y >= g.rowMin[r] && y < g.rowMax[r]) {
        slot = r * ROW_SIZE + column;
        break;
      }
    }
    return slot >= 0 && (g.filled & (1 << slot)) !== 0 ? slot : -1;
  };

  const leave = (action: Action) => {
    'worklet';
    if (leaving.value) return;
    if (action.type === 'next' && !canForwardSV.value) return;
    if (action.type === 'prev' && !canBackSV.value) return;
    leaving.value = true;
    hoverSlot.value = -1;
    const g = geometry.value;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDecide, action);
    };
    if (action.type === 'trash') {
      ty.value = withTiming(-g.height, OUT, done);
      pinch.value = withTiming(Math.min(pinch.value, 0.5), OUT);
    } else if (action.type === 'next' || action.type === 'prev') {
      // The timeline moves at once so the other photo can arrive while this one leaves.
      scheduleOnRN(onDecide, action);
      const dir = action.type === 'next' ? -1 : 1;
      tx.value = withTiming(dir * g.width * 1.3, OUT, (finished) => {
        'worklet';
        if (!finished) return;
        leaving.value = false;
        // Park it where its new role expects it.
        if (roleCode.value === 2) {
          tx.value = 0;
          ty.value = 0;
          shrink.value = 1;
        } else if (roleCode.value === 0) {
          tx.value = -OFFSCREEN;
        }
      });
    } else {
      const column = action.slot % ROW_SIZE;
      const targetY = g.rowCenter[Math.floor(action.slot / ROW_SIZE)];
      tx.value = withTiming((column + 0.5) * (g.width / ROW_SIZE) - g.width / 2, OUT);
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
    // Two fingers are a pinch, not a drag.
    maxPointers: 1,
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
      // Swipe left for the next photo, right to go back. At either end it springs back.
      else if (sideways && e.translationX < 0 && canForwardSV.value) leave({ type: 'next' });
      else if (sideways && e.translationX > 0 && canBackSV.value) leave({ type: 'prev' });
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

  // Slide two fingers together to throw the photo in the bin.
  const pinchToTrash = usePinchGesture({
    enabled: active,
    onUpdate: (e) => {
      'worklet';
      if (leaving.value) return;
      pinch.value = Math.min(1.05, Math.max(0.25, e.scale));
    },
    onDeactivate: (e) => {
      'worklet';
      if (leaving.value) return;
      if (!e.canceled && pinch.value <= PINCH_TRASH) leave({ type: 'trash' });
      else pinch.value = withSpring(1);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinchToTrash, doubleTap);

  const cardStyle = useAnimatedStyle(() => {
    const drag = interpolate(Math.abs(ty.value), [0, 240], [1, 0.42], Extrapolation.CLAMP);
    // Go see-through over an album so the tile underneath stays readable.
    const over = roleCode.value === 1 && hoverSlot.value >= 0 && !leaving.value ? 0.55 : 1;
    const rest = interpolate(depth.value, [0, 1], [1, 0.93]);
    return {
      opacity: interpolate(depth.value, [0, 1], [1, 0.45]) * over,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { rotate: `${interpolate(tx.value, [-440, 440], [-20, 20], Extrapolation.CLAMP)}deg` },
        { scale: drag * rest * shrink.value * pinch.value },
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
        style={[styles.card, { zIndex: active ? 3 : 1 }, cardStyle]}
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
        {photo.video && (
          <View style={styles.videoBadge} pointerEvents="none">
            <Text style={styles.badgeLabel}>▶ {formatDuration(photo.duration)}</Text>
          </View>
        )}
        {photo.video && canPlay && role === 'current' && (
          <Pressable
            style={styles.playButton}
            onPress={onPlay}
            accessibilityRole="button"
            accessibilityLabel="Play video"
            testID="play-video"
          >
            <Text style={styles.playGlyph}>▶</Text>
          </Pressable>
        )}
        {photo.time !== undefined && (
          <View style={styles.dateBadge} pointerEvents="none">
            <Text style={styles.badgeLabel} testID="photo-date">
              {formatDate(photo.time)}
            </Text>
          </View>
        )}
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
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
  videoBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dateBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  badgeLabel: { color: '#F2F3F5', fontSize: 13, fontWeight: '700' },
  playButton: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  playGlyph: { color: '#fff', fontSize: 30, marginLeft: 4 },
  heartWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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

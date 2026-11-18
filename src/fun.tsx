import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import type { Stats } from './types';

// ---------------------------------------------------------------- confetti, hearts, fireworks

export type BurstKind = 'confetti' | 'hearts' | 'fireworks';

type Spec = {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  rot: number;
  size: number;
  color: string;
  glyph?: string;
  delay: number;
  duration: number;
  out: boolean;
  fade: boolean;
};

const PALETTE = ['#F2A65A', '#EE6C8A', '#5BC0BE', '#B892FF', '#7BD389', '#F4D35E', '#6FA8FF', '#FF8C61'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function makeSpecs(kind: BurstKind, w: number, h: number): Spec[] {
  if (kind === 'fireworks') {
    const specs: Spec[] = [];
    for (let burst = 0; burst < 4; burst++) {
      const cx = rand(w * 0.2, w * 0.8);
      const cy = rand(h * 0.18, h * 0.42);
      const color = pick(PALETTE);
      for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        const dist = rand(70, 140);
        specs.push({
          x0: cx,
          y0: cy,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist + 30,
          rot: 0,
          size: 7,
          color: i % 3 === 0 ? '#FFFFFF' : color,
          delay: burst * 450,
          duration: 1300,
          out: true,
          fade: true,
        });
      }
    }
    return specs;
  }
  const count = kind === 'hearts' ? 28 : 44;
  return Array.from({ length: count }, () => {
    const size = kind === 'hearts' ? rand(20, 40) : rand(8, 13);
    return {
      x0: rand(0, w - size),
      y0: -50,
      dx: rand(-70, 70),
      dy: h + 100,
      rot: kind === 'hearts' ? rand(-40, 40) : rand(360, 900) * (Math.random() < 0.5 ? -1 : 1),
      size,
      color: kind === 'hearts' ? pick(['#FF5A7A', '#FF8FA3', '#E83A5F', '#FFB3C1']) : pick(PALETTE),
      glyph: kind === 'hearts' ? '♥' : undefined,
      delay: rand(0, 900),
      duration: rand(2300, 3600),
      out: false,
      fade: false,
    };
  });
}

function Particle({ spec }: { spec: Spec }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      spec.delay,
      withTiming(1, {
        duration: spec.duration,
        easing: spec.out ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
      }),
    );
  }, [spec, t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : spec.fade ? 1 - t.value * t.value : 1,
    transform: [
      { translateX: spec.x0 + spec.dx * t.value },
      { translateY: spec.y0 + spec.dy * t.value },
      { rotate: `${spec.rot * t.value}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.particle, style]}>
      {spec.glyph ? (
        <Text style={{ color: spec.color, fontSize: spec.size }}>{spec.glyph}</Text>
      ) : (
        <View
          style={{
            width: spec.size,
            height: spec.fade ? spec.size : spec.size * 0.6,
            borderRadius: spec.fade ? spec.size : 2,
            backgroundColor: spec.color,
          }}
        />
      )}
    </Animated.View>
  );
}

/** Showers the screen with confetti, hearts or fireworks each time `burst` goes up. */
export function Confetti({ burst, kind = 'confetti' }: { burst: number; kind?: BurstKind }) {
  const { width, height } = useWindowDimensions();
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (burst <= 0) return;
    setRun(burst);
    const done = setTimeout(() => setRun(0), 5200);
    return () => clearTimeout(done);
  }, [burst]);
  const specs = useMemo(() => (run > 0 ? makeSpecs(kind, width, height) : []), [run, kind, width, height]);
  if (run === 0) return null;
  return (
    <View style={styles.overlay} pointerEvents="none" testID={`burst-${kind}`}>
      {specs.map((spec, i) => (
        <Particle key={`${run}-${i}`} spec={spec} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- the bin, peeked at

/** A cartoon of the trash bin with its lid open, filling up with photos. */
export function BinPeek({
  visible,
  count,
  onClose,
}: {
  visible: boolean;
  count: number;
  onClose: () => void;
}) {
  const lid = useSharedValue(0);
  const fill = useSharedValue(0);
  const FULL = 50;
  const share = Math.min(1, count / FULL);
  useEffect(() => {
    if (!visible) {
      lid.value = 0;
      fill.value = 0;
      return;
    }
    lid.value = withDelay(150, withTiming(1, { duration: 500, easing: Easing.out(Easing.back(2)) }));
    fill.value = withDelay(500, withTiming(share, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [visible, share, lid, fill]);
  const lidStyle = useAnimatedStyle(() => ({
    // Hinged at its left end, so it swings up like a real lid.
    transform: [{ translateX: -56 }, { rotate: `${-lid.value * 38}deg` }, { translateX: 56 }],
  }));
  const fillStyle = useAnimatedStyle(() => ({ height: `${fill.value * 100}%` }));

  const percent = Math.round(share * 100);
  const line =
    count === 0
      ? 'Empty. Squeaky clean.'
      : percent < 25
        ? 'Plenty of room.'
        : percent < 60
          ? 'Filling up nicely.'
          : percent < 100
            ? 'Getting full.'
            : 'Overflowing! Time to empty it.';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="bin-peek">
        <View style={styles.peekCard}>
          <Text style={styles.peekTitle}>The bin</Text>
          <View style={styles.can}>
            <Animated.View style={[styles.lid, lidStyle]} testID="bin-lid" />
            <View style={styles.canBody}>
              <Animated.View style={[styles.canFill, fillStyle]} />
              <Text style={styles.canCount}>{count}</Text>
            </View>
          </View>
          <Text style={styles.peekLine} testID="bin-peek-text">
            {count === 0 ? line : `${count} ${count === 1 ? 'photo' : 'photos'} · ${percent}% full. ${line}`}
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------- stats

export function StatsSheet({
  visible,
  stats,
  onClose,
}: {
  visible: boolean;
  stats: Stats;
  onClose: () => void;
}) {
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (visible) setBurst((b) => b + 1);
  }, [visible]);
  const rows: [string, string][] = [
    ['Photos sorted', String(stats.sorted)],
    ['Moved to the bin', String(stats.trashed)],
    ['Filed into albums', String(stats.filed)],
    ['Favorited', String(stats.favorited)],
    ['Longest streak', `${stats.bestStreak} in a row`],
    ['Sorting since', new Date(stats.since).toLocaleDateString()],
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdropBottom}>
        <View style={styles.statsCard}>
          <Text style={styles.peekTitle}>Your sorting stats</Text>
          <Text style={styles.statsSub}>You found the secret page.</Text>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.statRow}>
              <Text style={styles.statKey}>{k}</Text>
              <Text style={styles.statValue} testID={`stat-${k}`}>
                {v}
              </Text>
            </View>
          ))}
          <Pressable style={styles.doneButton} onPress={onClose} testID="stats-done">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <Confetti burst={burst} kind="confetti" />
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- album names

const EMOJI: [RegExp, string][] = [
  [/pizza/i, '🍕'],
  [/cat|kitten|kitty/i, '🐱'],
  [/dog|puppy/i, '🐶'],
  [/pet/i, '🐾'],
  [/beach|sea|ocean/i, '🏖️'],
  [/baby|newborn/i, '👶'],
  [/kid|child/i, '🧒'],
  [/family/i, '👨‍👩‍👧'],
  [/friend/i, '🫶'],
  [/travel|trip|vacation|holiday/i, '✈️'],
  [/food|dinner|lunch|recipe|cook/i, '🍽️'],
  [/funny|meme|lol/i, '😂'],
  [/keeper|best|favou?rite/i, '⭐'],
  [/birthday|party/i, '🎂'],
  [/wedding/i, '💍'],
  [/christmas|xmas/i, '🎄'],
  [/halloween/i, '🎃'],
  [/snow|winter/i, '❄️'],
  [/music|concert|band/i, '🎵'],
  [/garden|plant|flower/i, '🌱'],
  [/school|class/i, '🎒'],
  [/car|drive/i, '🚗'],
  [/sunset|sunrise/i, '🌅'],
  [/love|date|heart/i, '❤️'],
  [/mountain|hike|camp/i, '⛰️'],
  [/work|office/i, '💼'],
  [/screenshot/i, '📱'],
];

/** A little emoji for album names it recognizes, or null. */
export function emojiFor(name: string): string | null {
  for (const [pattern, emoji] of EMOJI) if (pattern.test(name)) return emoji;
  return null;
}

/** Between midnight and 4am: time for the "go to sleep" message. */
export function isNight(date = new Date()): boolean {
  return date.getHours() < 4;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 },
  particle: { position: 'absolute', top: 0, left: 0 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdropBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  peekCard: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    gap: 14,
    padding: 22,
    borderRadius: 24,
    backgroundColor: '#1B1D24',
  },
  peekTitle: { color: '#F2F3F5', fontSize: 20, fontWeight: '700' },
  peekLine: { color: '#A9AEB8', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  can: { width: 120, height: 215, alignItems: 'center', justifyContent: 'flex-end' },
  canBody: {
    width: 104,
    height: 130,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 4,
    borderColor: '#5B6170',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#14161B',
  },
  canFill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#B3303C' },
  canCount: { color: '#fff', fontSize: 30, fontWeight: '800', marginBottom: 46 },
  lid: {
    position: 'absolute',
    top: 70,
    left: 4,
    width: 112,
    height: 14,
    borderRadius: 6,
    backgroundColor: '#5B6170',
  },
  statsCard: { gap: 10, padding: 22, borderRadius: 24, backgroundColor: '#1B1D24' },
  statsSub: { color: '#A9AEB8', fontSize: 14, marginBottom: 6 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  statKey: { color: '#C5C9D2', fontSize: 16 },
  statValue: { color: '#F2F3F5', fontSize: 16, fontWeight: '700' },
  doneButton: {
    marginTop: 8,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },
  doneText: { color: '#101114', fontSize: 16, fontWeight: '700' },
});

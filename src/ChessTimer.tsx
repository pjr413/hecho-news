import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { allowSleep, keepAwake } from './keepAwake';

type Mode = 'match' | 'turn';
type Phase = 'idle' | 'running' | 'paused' | 'over';
type Player = 0 | 1; // 0 is the bottom side, 1 is the top side (upside down)
type Settings = { mode: Mode; matchMin: number; turnSec: number };

const KEY = 'photo-sorter/chess-timer/v1';
const DEFAULTS: Settings = { mode: 'match', matchMin: 10, turnSec: 30 };
/** The clock starts blinking red when this much (or less) is left. */
const WARN_MS = 10_000;
const MATCH_CHOICES = [1, 3, 5, 10, 15, 30, 60];
const TURN_CHOICES = [10, 15, 30, 45, 60, 90, 120];

const RED = '#E53935';
const LIGHT = '#F2F3F5';
const DARK = '#1B1D24';

function stepFor(mode: Mode, v: number): number {
  return mode === 'match' ? (v < 10 ? 1 : 5) : v < 60 ? 5 : 15;
}

function clampValue(mode: Mode, v: number): number {
  return mode === 'match' ? Math.min(180, Math.max(1, v)) : Math.min(600, Math.max(5, v));
}

function initialMs(s: Settings): number {
  return s.mode === 'match' ? s.matchMin * 60_000 : s.turnSec * 1000;
}

/** 12:34, 1:02:03, or 9.8 in the last ten seconds. */
function format(ms: number): string {
  if (ms < WARN_MS) return (Math.ceil(ms / 100) / 10).toFixed(1);
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

function describe(s: Settings): string {
  return s.mode === 'match'
    ? `Match time · ${s.matchMin} min each`
    : `Per turn · ${s.turnSec} seconds each`;
}

export function ChessTimer({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [active, setActive] = useState<Player>(0);
  const [first, setFirst] = useState<Player>(0);
  const [ms, setMs] = useState<[number, number]>([initialMs(DEFAULTS), initialMs(DEFAULTS)]);
  const [loser, setLoser] = useState<Player | null>(null);
  const [panel, setPanel] = useState<null | 'options' | 'confirm'>(null);
  /** True when we paused the clock just to show a panel, so closing it should resume. */
  const resumeAfter = useRef(false);
  const lastTick = useRef(0);
  const init = initialMs(settings);

  // Settings are remembered between launches.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<Settings>;
        setSettings({
          mode: saved.mode === 'turn' ? 'turn' : 'match',
          matchMin: clampValue('match', Number(saved.matchMin) || DEFAULTS.matchMin),
          turnSec: clampValue('turn', Number(saved.turnSec) || DEFAULTS.turnSec),
        });
      })
      .catch(() => {});
  }, []);
  const saveSettings = (next: Settings) => {
    setSettings(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };

  // Hold the screen awake while a game might be going.
  useEffect(() => {
    keepAwake('chess-timer');
    return () => allowSleep('chess-timer');
  }, []);

  // Before a game starts, the clocks always show the chosen time.
  useEffect(() => {
    if (phase === 'idle') setMs([init, init]);
  }, [phase, init]);

  // The running clock. It measures real elapsed time rather than counting ticks, so it
  // doesn't drift if the phone is busy.
  useEffect(() => {
    if (phase !== 'running') return;
    lastTick.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = now - lastTick.current;
      lastTick.current = now;
      setMs((prev) => {
        const next: [number, number] = [prev[0], prev[1]];
        next[active] = Math.max(0, prev[active] - dt);
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [phase, active]);

  // Someone ran out of time.
  useEffect(() => {
    if (phase === 'running' && ms[active] <= 0) {
      setPhase('over');
      setLoser(active);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [ms, phase, active]);

  const press = (player: Player) => {
    if (phase === 'idle') {
      // Before the start, tapping a side chooses who goes first.
      setFirst(player);
      setActive(player);
      return;
    }
    if (phase !== 'running' || player !== active) return;
    const other: Player = player === 0 ? 1 : 0;
    setActive(other);
    if (settings.mode === 'turn') {
      setMs((prev) => {
        const next: [number, number] = [prev[0], prev[1]];
        next[other] = init;
        return next;
      });
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const start = () => {
    if (phase !== 'idle') return;
    setMs([init, init]);
    setActive(first);
    setLoser(null);
    setPhase('running');
  };

  const togglePause = () => setPhase((p) => (p === 'running' ? 'paused' : p === 'paused' ? 'running' : p));

  /** Stop the clock while a panel is up, and remember to restart it afterwards. */
  const hold = () => {
    resumeAfter.current = phase === 'running';
    if (phase === 'running') setPhase('paused');
  };
  const release = () => {
    if (resumeAfter.current) setPhase((p) => (p === 'paused' ? 'running' : p));
    resumeAfter.current = false;
  };

  const openPanel = (which: 'options' | 'confirm') => {
    hold();
    setPanel(which);
  };
  const closePanel = () => {
    setPanel(null);
    release();
  };
  const reset = () => {
    resumeAfter.current = false;
    setPanel(null);
    setPhase('idle');
    setLoser(null);
    setActive(first);
    setMs([init, init]);
  };

  const locked = phase !== 'idle';

  const side = (player: Player) => {
    const isActive = (phase === 'running' || phase === 'paused') && active === player;
    const left = ms[player];
    const low = phase === 'running' && isActive && left <= WARN_MS && left > 0;
    // Flash on and off twice a second, driven by the time left so it's always in step.
    const flashRed = low && Math.floor(left / 500) % 2 === 1;

    let bg = DARK;
    let fg = '#8A90A0';
    let label = '';
    if (phase === 'over') {
      const lost = loser === player;
      bg = lost ? '#C62828' : '#1E6B3C';
      fg = '#FFFFFF';
      label = lost ? 'Time’s up' : 'Wins on time';
    } else if (phase === 'idle') {
      fg = '#E5E7EB';
      label = first === player ? 'Goes first' : 'Tap to go first';
    } else if (isActive) {
      bg = flashRed ? RED : LIGHT;
      fg = flashRed ? '#FFFFFF' : '#101114';
      label = phase === 'paused' ? 'Paused' : 'Tap when you’ve moved';
    } else {
      label = 'Waiting';
    }

    return (
      <Pressable
        onPress={() => press(player)}
        style={[
          styles.side,
          { backgroundColor: bg },
          phase === 'idle' && first === player && styles.sideFirst,
          player === 1 && styles.flipped,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${player === 0 ? 'Bottom' : 'Top'} player. ${format(left)}. ${label}`}
        testID={player === 0 ? 'side-bottom' : 'side-top'}
      >
        <Text style={[styles.time, { color: fg }]} adjustsFontSizeToFit numberOfLines={1}>
          {format(left)}
        </Text>
        <Text style={[styles.sideLabel, { color: fg }]}>{label}</Text>
      </Pressable>
    );
  };

  const button = (
    text: string,
    onPress: () => void,
    opts: { disabled?: boolean; primary?: boolean; testID: string },
  ) => (
    <Pressable
      style={[styles.control, opts.primary && styles.controlPrimary, opts.disabled && styles.dim]}
      disabled={opts.disabled}
      onPress={onPress}
      accessibilityRole="button"
      testID={opts.testID}
    >
      <Text style={[styles.controlText, opts.primary && styles.controlPrimaryText]}>{text}</Text>
    </Pressable>
  );

  const choices = settings.mode === 'match' ? MATCH_CHOICES : TURN_CHOICES;
  const value = settings.mode === 'match' ? settings.matchMin : settings.turnSec;
  const unit = settings.mode === 'match' ? 'min' : 's';
  const setValue = useCallback(
    (v: number) => {
      const clamped = clampValue(settings.mode, v);
      saveSettings(
        settings.mode === 'match'
          ? { ...settings, matchMin: clamped }
          : { ...settings, turnSec: clamped },
      );
    },
    // saveSettings only closes over setSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.half, { paddingTop: insets.top + 10 }]}>{side(1)}</View>

      <View style={styles.center}>
        <Text style={styles.summary} testID="timer-summary">
          {phase === 'over' ? 'Time’s up' : describe(settings)}
        </Text>
        <View style={styles.controls}>
          {button('⚙ Options', () => openPanel('options'), { testID: 'timer-options' })}
          {button('▶ Start', start, { disabled: phase !== 'idle', primary: true, testID: 'timer-start' })}
          {button(phase === 'paused' ? '▶ Resume' : '❚❚ Pause', togglePause, {
            disabled: phase !== 'running' && phase !== 'paused',
            testID: 'timer-pause',
          })}
          {button('■ Reset', () => openPanel('confirm'), { disabled: phase === 'idle', testID: 'timer-reset' })}
        </View>
      </View>

      <View style={[styles.half, { paddingBottom: insets.bottom + 10 }]}>{side(0)}</View>

      {panel === 'confirm' && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Reset the clock?</Text>
            <Text style={styles.cardBody}>
              This stops the game and puts both clocks back to the start.
            </Text>
            <View style={styles.cardButtons}>
              <Pressable style={styles.cardButton} onPress={closePanel} testID="timer-keep">
                <Text style={styles.controlText}>Keep going</Text>
              </Pressable>
              <Pressable
                style={[styles.cardButton, styles.cardDanger]}
                onPress={reset}
                testID="timer-confirm-reset"
              >
                <Text style={styles.controlText}>Reset</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {panel === 'options' && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Chess timer</Text>
            {locked && (
              <Text style={styles.cardBody}>
                A game is in progress. Reset the clock to change these.
              </Text>
            )}
            <View style={styles.segment}>
              {(['match', 'turn'] as const).map((m) => (
                <Pressable
                  key={m}
                  disabled={locked}
                  style={[styles.segmentItem, settings.mode === m && styles.segmentOn, locked && styles.dim]}
                  onPress={() => saveSettings({ ...settings, mode: m })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: settings.mode === m }}
                  testID={`mode-${m}`}
                >
                  <Text style={[styles.segmentText, settings.mode === m && styles.segmentTextOn]}>
                    {m === 'match' ? 'Match time' : 'Per turn'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.cardBody}>
              {settings.mode === 'match'
                ? 'Each player gets this much time for the whole game. Their clock only runs on their turn.'
                : 'Each turn gets this long. It starts over every time play passes to the other player.'}
            </Text>
            <View style={styles.stepper}>
              <Pressable
                disabled={locked}
                style={[styles.step, locked && styles.dim]}
                onPress={() => setValue(value - stepFor(settings.mode, value - 1))}
                accessibilityRole="button"
                accessibilityLabel="Less time"
                testID="val-minus"
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.stepValue} testID="val-text">
                {value} {unit}
              </Text>
              <Pressable
                disabled={locked}
                style={[styles.step, locked && styles.dim]}
                onPress={() => setValue(value + stepFor(settings.mode, value))}
                accessibilityRole="button"
                accessibilityLabel="More time"
                testID="val-plus"
              >
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {choices.map((c) => (
                <Pressable
                  key={c}
                  disabled={locked}
                  style={[styles.chip, c === value && styles.segmentOn, locked && styles.dim]}
                  onPress={() => setValue(c)}
                  accessibilityRole="button"
                  testID={`chip-${c}`}
                >
                  <Text style={[styles.segmentText, c === value && styles.segmentTextOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.cardBody}>The clock flashes red when 10 seconds are left.</Text>
            <View style={styles.cardButtons}>
              <Pressable style={styles.cardButton} onPress={onExit} testID="timer-exit">
                <Text style={styles.controlText}>Back to photos</Text>
              </Pressable>
              <Pressable
                style={[styles.cardButton, styles.cardPrimary]}
                onPress={closePanel}
                testID="timer-options-done"
              >
                <Text style={[styles.controlText, styles.controlPrimaryText]}>Done</Text>
              </Pressable>
            </View>
            {locked && <Text style={styles.cardNote}>Leaving ends the current game.</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0F13' },
  half: { flex: 1, paddingHorizontal: 12 },
  side: {
    flex: 1,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 6,
  },
  // The top player sits across the table, so their side is turned around.
  flipped: { transform: [{ rotate: '180deg' }] },
  sideFirst: { borderWidth: 3, borderColor: '#F2F3F5' },
  time: { fontSize: 88, fontWeight: '800', fontVariant: ['tabular-nums'], maxWidth: '100%' },
  sideLabel: { fontSize: 16, fontWeight: '600', opacity: 0.85 },
  center: { paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  summary: { color: '#A9AEB8', fontSize: 14, textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 8 },
  control: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22252E',
    paddingHorizontal: 4,
  },
  controlPrimary: { backgroundColor: '#F2F3F5' },
  controlText: { color: '#F2F3F5', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  controlPrimaryText: { color: '#101114' },
  dim: { opacity: 0.35 },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 10,
  },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#1B1D24', borderRadius: 22, padding: 20, gap: 14 },
  cardTitle: { color: '#F2F3F5', fontSize: 20, fontWeight: '700' },
  cardBody: { color: '#A9AEB8', fontSize: 14, lineHeight: 20 },
  cardNote: { color: '#7C828E', fontSize: 13, textAlign: 'center' },
  cardButtons: { flexDirection: 'row', gap: 10 },
  cardButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
  cardPrimary: { backgroundColor: '#F2F3F5' },
  cardDanger: { backgroundColor: '#B3303C' },
  segment: { flexDirection: 'row', gap: 8 },
  segmentItem: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
  segmentOn: { backgroundColor: '#F2F3F5' },
  segmentText: { color: '#F2F3F5', fontSize: 15, fontWeight: '600' },
  segmentTextOn: { color: '#101114' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  step: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
  stepText: { color: '#F2F3F5', fontSize: 26, fontWeight: '600' },
  stepValue: { color: '#F2F3F5', fontSize: 26, fontWeight: '800', minWidth: 110, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: {
    minWidth: 48,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
});

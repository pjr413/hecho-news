import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { allowSleep, keepAwake } from './keepAwake';

type Mode = 'match' | 'turn';
type Phase = 'idle' | 'running' | 'paused' | 'over';
type Player = 0 | 1; // 0 is the bottom side, 1 is the top side (upside down)
type Bonus = 'none' | 'increment' | 'delay' | 'bronstein';
type Settings = {
  /** Per-turn mode only: time left at the end of a turn is added to the player's next turn. */
  carryOver: boolean;
  mode: Mode;
  matchMin: number;
  turnSec: number;
  /** Extra time in match mode: none, increment, delay or Bronstein (see BONUS_INFO). */
  bonusType: Bonus;
  bonusSec: number;
};

const KEY = 'photo-sorter/chess-timer/v1';
const DEFAULTS: Settings = {
  carryOver: false,
  mode: 'match',
  matchMin: 10,
  turnSec: 30,
  bonusType: 'none',
  bonusSec: 3,
};
/** The side starts turning red when this much is left, and is fully red at FULL_RED_MS. */
const WARN_MS = 10_000;
const FULL_RED_MS = 5_000;
/** The most unused time that can be carried into the next turn. */
const CARRY_MAX_MS = 15_000;
/** Ready-made game types: minutes each, plus an optional bonus. */
const PRESETS: { id: string; label: string; min: number; type: Bonus; sec: number }[] = [
  { id: 'bullet', label: 'Bullet 1+0', min: 1, type: 'none', sec: 0 },
  { id: 'bullet-inc', label: 'Bullet 1+1', min: 1, type: 'increment', sec: 1 },
  { id: 'blitz3', label: 'Blitz 3+2', min: 3, type: 'increment', sec: 2 },
  { id: 'blitz5', label: 'Blitz 5+3', min: 5, type: 'increment', sec: 3 },
  { id: 'rapid10', label: 'Rapid 10+0', min: 10, type: 'none', sec: 0 },
  { id: 'rapid15', label: 'Rapid 15+10', min: 15, type: 'increment', sec: 10 },
  { id: 'classical', label: 'Classical 90+30', min: 90, type: 'increment', sec: 30 },
  { id: 'delay', label: '5 min, 3 s delay', min: 5, type: 'delay', sec: 3 },
  { id: 'bronstein', label: '5 min, 3 s Bronstein', min: 5, type: 'bronstein', sec: 3 },
];
const BONUS_INFO: Record<Bonus, { label: string; blurb: string }> = {
  none: { label: 'None', blurb: 'No extra time.' },
  increment: {
    label: 'Increment',
    blurb: 'After every move you get this many seconds added to your clock.',
  },
  delay: {
    label: 'Delay',
    blurb: 'Your clock waits this many seconds at the start of each turn before it counts down.',
  },
  bronstein: {
    label: 'Bronstein',
    blurb: 'After every move you get back the time you used, up to this many seconds.',
  },
};
const TURN_CHOICES = [10, 15, 30, 45, 60, 90, 120];

const DARK = '#1B1D24';
type Rgb = [number, number, number];
const LIGHT_RGB: Rgb = [242, 243, 245];
const RED_RGB: Rgb = [229, 57, 53];
const INK_RGB: Rgb = [16, 17, 20];
const WHITE_RGB: Rgb = [255, 255, 255];

/** A color part of the way from a to b (t from 0 to 1). */
function mix(a: Rgb, b: Rgb, t: number): string {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

function stepFor(mode: Mode, v: number): number {
  return mode === 'match' ? (v < 10 ? 1 : 5) : v < 60 ? 5 : 15;
}

function clampValue(mode: Mode, v: number): number {
  return mode === 'match' ? Math.min(180, Math.max(1, v)) : Math.min(600, Math.max(5, v));
}

function clampBonus(v: number): number {
  return Math.min(120, Math.max(1, v));
}

function bonusStep(v: number): number {
  return v < 10 ? 1 : 5;
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
  if (s.mode === 'turn') {
    return `Per turn · ${s.turnSec} seconds each${s.carryOver ? ' · carry over up to 15 s' : ''}`;
  }
  const extra =
    s.bonusType === 'increment'
      ? ` + ${s.bonusSec} s per move`
      : s.bonusType === 'delay'
        ? ` · ${s.bonusSec} s delay`
        : s.bonusType === 'bronstein'
          ? ` · ${s.bonusSec} s Bronstein`
          : '';
  return `Match time · ${s.matchMin} min each${extra}`;
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
  /** Delay still to run off at the start of this turn (ms), and time used this turn (ms). */
  const delayRef = useRef(0);
  const usedRef = useRef(0);
  const [delayLeft, setDelayLeft] = useState(0);
  const init = initialMs(settings);
  // Extra time only applies in match mode.
  const bonusType: Bonus = settings.mode === 'match' ? settings.bonusType : 'none';
  const bonusMs = bonusType === 'none' ? 0 : settings.bonusSec * 1000;
  const freshTurn = () => {
    delayRef.current = bonusType === 'delay' ? bonusMs : 0;
    usedRef.current = 0;
    setDelayLeft(delayRef.current);
  };

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
          carryOver: saved.carryOver === true,
          bonusType: (['increment', 'delay', 'bronstein'] as const).includes(
            saved.bonusType as 'increment',
          )
            ? (saved.bonusType as Bonus)
            : 'none',
          bonusSec: clampBonus(Number(saved.bonusSec) || DEFAULTS.bonusSec),
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
      let dt = now - lastTick.current;
      lastTick.current = now;
      // A delay is run off first, without touching the clock.
      if (delayRef.current > 0) {
        const used = Math.min(dt, delayRef.current);
        delayRef.current -= used;
        dt -= used;
        setDelayLeft(delayRef.current);
      }
      usedRef.current += dt;
      if (dt <= 0) return;
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
    // Extra time earned by the move just made.
    const earned =
      bonusType === 'increment'
        ? bonusMs
        : bonusType === 'bronstein'
          ? Math.min(bonusMs, usedRef.current)
          : 0;
    setActive(other);
    setMs((prev) => {
      const next: [number, number] = [prev[0], prev[1]];
      if (settings.mode === 'turn') {
        // Per turn: your clock goes back to the start of a turn the moment yours ends. With
        // carry-over, up to CARRY_MAX_MS of what you didn't use is added on top.
        next[player] = init + (settings.carryOver ? Math.min(prev[player], CARRY_MAX_MS) : 0);
      } else {
        next[player] += earned;
      }
      return next;
    });
    freshTurn();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const start = () => {
    if (phase !== 'idle') return;
    setMs([init, init]);
    setActive(first);
    setLoser(null);
    freshTurn();
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
    delayRef.current = 0;
    usedRef.current = 0;
    setDelayLeft(0);
  };

  const locked = phase !== 'idle';

  const side = (player: Player) => {
    const isActive = (phase === 'running' || phase === 'paused') && active === player;
    const left = ms[player];
    // Fades from the normal color to red as the time left drops from 10 s to 5 s.
    const redness = Math.min(1, Math.max(0, (WARN_MS - left) / (WARN_MS - FULL_RED_MS)));

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
      bg = mix(LIGHT_RGB, RED_RGB, redness);
      fg = mix(INK_RGB, WHITE_RGB, redness);
      label =
        phase === 'paused'
          ? 'Paused'
          : delayLeft > 0
            ? `Delay ${Math.ceil(delayLeft / 1000)} s`
            : 'Tap when you’ve moved';
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

  const value = settings.mode === 'match' ? settings.matchMin : settings.turnSec;
  const unit = settings.mode === 'match' ? 'min' : 's';
  const isPreset = (p: (typeof PRESETS)[number]) =>
    settings.matchMin === p.min &&
    settings.bonusType === p.type &&
    (p.type === 'none' || settings.bonusSec === p.sec);
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
          <View style={[styles.card, styles.cardTall]}>
            <Text style={styles.cardTitle}>Chess timer</Text>
            <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardScrollBody}>
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

              {settings.mode === 'match' && (
                <>
                  <Text style={styles.sectionLabel}>Game type</Text>
                  <View style={styles.chips}>
                    {PRESETS.map((pr) => (
                      <Pressable
                        key={pr.id}
                        disabled={locked}
                        style={[styles.chip, isPreset(pr) && styles.segmentOn, locked && styles.dim]}
                        onPress={() =>
                          saveSettings({
                            ...settings,
                            matchMin: pr.min,
                            bonusType: pr.type,
                            bonusSec: pr.type === 'none' ? settings.bonusSec : pr.sec,
                          })
                        }
                        accessibilityRole="button"
                        accessibilityState={{ selected: isPreset(pr) }}
                        testID={`preset-${pr.id}`}
                      >
                        <Text style={[styles.segmentText, isPreset(pr) && styles.segmentTextOn]}>
                          {pr.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.sectionLabel}>Time for each player</Text>
                </>
              )}

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

              {settings.mode === 'turn' ? (
                <>
                <View style={styles.chips}>
                  {TURN_CHOICES.map((c) => (
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
                <Text style={styles.sectionLabel}>Carry over unused time</Text>
                <View style={styles.segment}>
                  {[false, true].map((on) => (
                    <Pressable
                      key={String(on)}
                      disabled={locked}
                      style={[
                        styles.segmentItem,
                        settings.carryOver === on && styles.segmentOn,
                        locked && styles.dim,
                      ]}
                      onPress={() => saveSettings({ ...settings, carryOver: on })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: settings.carryOver === on }}
                      testID={on ? 'carry-on' : 'carry-off'}
                    >
                      <Text
                        style={[styles.segmentText, settings.carryOver === on && styles.segmentTextOn]}
                      >
                        {on ? 'On' : 'Off'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.cardBody} testID="carry-blurb">
                  {settings.carryOver
                    ? `Time you don’t use is added to your next turn, up to 15 seconds, so going faster gives you longer turns. Finish a ${value}-second turn with 10 seconds left and your next one is ${value + 10} seconds. With 15 or more left, it’s ${value + 15}.`
                    : 'Every turn starts over at the full time.'}
                </Text>
                </>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Extra time</Text>
                  <View style={styles.chips}>
                    {(Object.keys(BONUS_INFO) as Bonus[]).map((t) => (
                      <Pressable
                        key={t}
                        disabled={locked}
                        style={[styles.chip, settings.bonusType === t && styles.segmentOn, locked && styles.dim]}
                        onPress={() => saveSettings({ ...settings, bonusType: t })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: settings.bonusType === t }}
                        testID={`bonus-${t}`}
                      >
                        <Text style={[styles.segmentText, settings.bonusType === t && styles.segmentTextOn]}>
                          {BONUS_INFO[t].label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.cardBody}>{BONUS_INFO[settings.bonusType].blurb}</Text>
                  {settings.bonusType !== 'none' && (
                    <View style={styles.stepper}>
                      <Pressable
                        disabled={locked}
                        style={[styles.step, locked && styles.dim]}
                        onPress={() =>
                          saveSettings({
                            ...settings,
                            bonusSec: clampBonus(settings.bonusSec - bonusStep(settings.bonusSec - 1)),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Less extra time"
                        testID="bonus-minus"
                      >
                        <Text style={styles.stepText}>−</Text>
                      </Pressable>
                      <Text style={styles.stepValue} testID="bonus-text">
                        {settings.bonusSec} s
                      </Text>
                      <Pressable
                        disabled={locked}
                        style={[styles.step, locked && styles.dim]}
                        onPress={() =>
                          saveSettings({
                            ...settings,
                            bonusSec: clampBonus(settings.bonusSec + bonusStep(settings.bonusSec)),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="More extra time"
                        testID="bonus-plus"
                      >
                        <Text style={styles.stepText}>+</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
              <Text style={styles.cardBody}>The clock slowly turns red from 10 seconds left down to 5.</Text>
              {locked && <Text style={styles.cardNote}>Leaving ends the current game.</Text>}
            </ScrollView>
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
  cardTall: { maxHeight: '100%' },
  cardScroll: { flexShrink: 1 },
  cardScrollBody: { gap: 14 },
  sectionLabel: { color: '#F2F3F5', fontSize: 15, fontWeight: '700', marginTop: 4 },
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

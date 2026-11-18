import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState } from 'react-native';
import type { Color } from 'chess.js';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChessBoard,
  PieceView,
  START_INFO,
  type ChessBoardHandle,
  type Facing,
  type GameInfo,
} from './ChessBoard';
import { PIECE_SETS, type PieceSetId } from './pieceSets';
import { allowSleep, keepAwake } from './keepAwake';

type Mode = 'match' | 'turn';
type Phase = 'idle' | 'running' | 'paused' | 'over';
type Player = 0 | 1; // 0 is the bottom side, 1 is the top side (upside down)
type Bonus = 'none' | 'increment' | 'delay' | 'bronstein';
type Settings = {
  /** Chess game: which set of pieces to draw. */
  pieceSet: PieceSetId;
  /** Chess game: black sits at the bottom of the screen instead of white. */
  blackAtBottom: boolean;
  /** Chess game: show where a picked piece can move. */
  moveHints: boolean;
  /** Chess game: which way the pieces face (see Facing). */
  pieceFacing: Facing;
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
const GAME_KEY = 'photo-sorter/chess-game/v1';
const DEFAULTS: Settings = {
  pieceSet: 'classic',
  blackAtBottom: false,
  moveHints: true,
  pieceFacing: 'each',
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
const FACING_CHOICES: { id: Facing; label: string; blurb: string }[] = [
  {
    id: 'each',
    label: 'Face each player',
    blurb: 'Black’s pieces are turned to face the player across the table.',
  },
  {
    id: 'bottom',
    label: 'All face the bottom',
    blurb: 'Every piece stands upright for the player at the bottom, like a normal board.',
  },
  {
    id: 'top',
    label: 'All face the top',
    blurb: 'Every piece stands upright for the player at the top.',
  },
];

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

/**
 * The two-player clock. With `game` set it also shows a chessboard between the players: moves on
 * the board pass the clock, and a checkmate or draw ends the game.
 */
export function ChessTimer({ onExit, game = false }: { onExit: () => void; game?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [active, setActive] = useState<Player>(0);
  const [first, setFirst] = useState<Player>(0);
  const [ms, setMs] = useState<[number, number]>([initialMs(DEFAULTS), initialMs(DEFAULTS)]);
  const [loser, setLoser] = useState<Player | null>(null);
  const [panel, setPanel] = useState<null | 'options' | 'confirm' | 'resume'>(null);
  const [info, setInfo] = useState<GameInfo>(START_INFO);
  /** Bumped to start a fresh game on the board. */
  const [resetKey, setResetKey] = useState(0);
  const boardRef = useRef<ChessBoardHandle>(null);
  /** How a game ended when it wasn't decided on the board or by the clock. */
  const [ending, setEnding] = useState<null | { kind: 'resign'; loser: Player } | { kind: 'agreed' }>(null);
  /** Who has offered a draw, and who has tapped Resign once and has to confirm. */
  const [drawOffer, setDrawOffer] = useState<Player | null>(null);
  const [resignArm, setResignArm] = useState<Player | null>(null);
  /** A saved game found on entering the game screen. */
  const [saved, setSaved] = useState<null | {
    pgn: string;
    ms: [number, number];
    active: Player;
    blackAtBottom: boolean;
    moves: number;
  }>(null);
  const movesRef = useRef<ComponentRef<typeof ScrollView>>(null);
  /** The game so far as text, refreshed after every change, so it can still be saved on exit. */
  const pgnRef = useRef('');
  /** True when we paused the clock just to show a panel, so closing it should resume. */
  const resumeAfter = useRef(false);
  const lastTick = useRef(0);
  /** Delay still to run off at the start of this turn (ms), and time used this turn (ms). */
  const delayRef = useRef(0);
  const usedRef = useRef(0);
  const [delayLeft, setDelayLeft] = useState(0);
  const init = initialMs(settings);
  /** Which color sits at the bottom (player 0) and which at the top (player 1). */
  const colorOf = (player: Player): Color =>
    (player === 0) !== settings.blackAtBottom ? 'w' : 'b';
  const playerOf = (color: Color): Player => (color === colorOf(0) ? 0 : 1);
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
          moveHints: saved.moveHints !== false,
          blackAtBottom: saved.blackAtBottom === true,
          pieceSet: PIECE_SETS.some((x) => x.id === saved.pieceSet)
            ? (saved.pieceSet as PieceSetId)
            : 'classic',
          pieceFacing: saved.pieceFacing === 'bottom' || saved.pieceFacing === 'top' ? saved.pieceFacing : 'each',
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

  /** The player whose turn it is has finished: pass the clock to the other side. */
  const pass = (player: Player) => {
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
    if (!game) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const press = (player: Player) => {
    if (game) return; // in a game, moves on the board pass the clock
    if (phase === 'idle') {
      // Before the start, tapping a side chooses who goes first.
      setFirst(player);
      setActive(player);
      return;
    }
    if (phase !== 'running' || player !== active) return;
    pass(player);
  };

  /** A legal move was made on the board: it starts the clock, or passes it. */
  const onGameMove = (mover: Color) => {
    const player: Player = playerOf(mover);
    setDrawOffer(null);
    setResignArm(null);
    if (phase === 'idle') {
      // The first move starts the clock, running for the other side.
      const bump = settings.mode === 'match' && bonusType === 'increment' ? bonusMs : 0;
      setMs(player === 0 ? [init + bump, init] : [init, init + bump]);
      setActive(player === 0 ? 1 : 0);
      setLoser(null);
      delayRef.current = bonusType === 'delay' ? bonusMs : 0;
      usedRef.current = 0;
      setDelayLeft(delayRef.current);
      setPhase('running');
      return;
    }
    if (phase === 'running' && active === player) pass(player);
  };

  /** The game changed; a checkmate or draw stops the clock. */
  const onGameInfo = (next: GameInfo) => {
    setInfo(next);
    pgnRef.current = boardRef.current?.pgn() ?? pgnRef.current;
    if (!next.over) return;
    setPhase('over');
    // The side to move has been checkmated.
    setLoser(next.over.kind === 'checkmate' ? playerOf(next.turn) : null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  /** A move was taken back: the player who made it is to move again. */
  const onGameUndo = (mover: Color) => {
    setDrawOffer(null);
    setResignArm(null);
    if (phase === 'over' && info.over) {
      // Taking back the move that ended the game: carry on, with the clock paused.
      setPhase('paused');
      setLoser(null);
    }
    setActive(playerOf(mover));
  };

  const canUndo = game && info.moveCount > 0 && !ending && (phase !== 'over' || !!info.over);

  /** Tap Resign twice (the second tap within three seconds) to give up. */
  const resign = (player: Player) => {
    if (resignArm !== player) {
      setResignArm(player);
      setTimeout(() => setResignArm((cur) => (cur === player ? null : cur)), 3000);
      return;
    }
    setResignArm(null);
    setDrawOffer(null);
    setEnding({ kind: 'resign', loser: player });
    setLoser(player);
    setPhase('over');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  };

  const answerDraw = (accept: boolean) => {
    setDrawOffer(null);
    if (!accept) return;
    setEnding({ kind: 'agreed' });
    setLoser(null);
    setPhase('over');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // Keep a game in progress, so leaving the screen (or the app) doesn't lose it.
  const latest = useRef({ ms, active, info, phase, ending, blackAtBottom: settings.blackAtBottom });
  latest.current = { ms, active, info, phase, ending, blackAtBottom: settings.blackAtBottom };
  const saveGame = useCallback(() => {
    if (!game) return;
    const cur = latest.current;
    const pgn = pgnRef.current;
    // An empty board is never saved (and never wipes a saved game: entering the screen starts empty).
    if (!pgn || cur.info.moveCount === 0) return;
    // A finished game has nothing left to resume.
    if (cur.info.over || cur.ending || cur.phase === 'over') {
      AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return;
    }
    AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({
        pgn,
        ms: cur.ms,
        active: cur.active,
        blackAtBottom: cur.blackAtBottom,
        moves: cur.info.moveCount,
      }),
    ).catch(() => {});
  }, [game]);
  useEffect(() => {
    if (game) saveGame();
  }, [game, saveGame, info.moveCount, phase, ending]);
  useEffect(() => {
    if (!game) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') saveGame();
    });
    return () => {
      sub.remove();
      saveGame();
    };
  }, [game, saveGame]);
  // On entering, offer to carry on a saved game.
  useEffect(() => {
    if (!game) return;
    AsyncStorage.getItem(GAME_KEY)
      .then((raw) => {
        if (!raw) return;
        const g = JSON.parse(raw);
        if (typeof g.pgn === 'string' && g.moves > 0 && Array.isArray(g.ms)) {
          setSaved({
            pgn: g.pgn,
            ms: [Number(g.ms[0]), Number(g.ms[1])],
            active: g.active === 1 ? 1 : 0,
            blackAtBottom: g.blackAtBottom === true,
            moves: g.moves,
          });
          setPanel('resume');
        }
      })
      .catch(() => {});
  }, [game]);
  const resumeSaved = () => {
    if (!saved) return;
    saveSettings({ ...settings, blackAtBottom: saved.blackAtBottom });
    if (boardRef.current?.load(saved.pgn)) {
      setMs(saved.ms);
      setActive(saved.active);
      setLoser(null);
      setPhase('paused'); // press Resume to start the clocks again
    }
    setSaved(null);
    setPanel(null);
  };
  const forgetSaved = () => {
    AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    setSaved(null);
    setPanel(null);
  };

  const start = () => {
    if (phase !== 'idle') return;
    setMs([init, init]);
    // In a game the clock starts for whoever is to move (it might not be white after a time reset).
    setActive(game ? playerOf(info.turn) : first);
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
  /** Game screen: put both clocks back to the start but leave the pieces where they are. */
  const resetTime = () => {
    resumeAfter.current = false;
    setPanel(null);
    setMs([init, init]);
    delayRef.current = 0;
    usedRef.current = 0;
    setDelayLeft(0);
    if (info.over) {
      // A game already decided on the board stays decided; only the clocks go back.
      setPhase('over');
    } else {
      setPhase('idle');
      setLoser(null);
    }
    setActive(playerOf(info.turn));
  };
  const reset = () => {
    resumeAfter.current = false;
    setPanel(null);
    setPhase('idle');
    setLoser(null);
    setActive(first);
    setMs([init, init]);
    setResetKey((k) => k + 1);
    setInfo(START_INFO);
    setEnding(null);
    setDrawOffer(null);
    setResignArm(null);
    AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    delayRef.current = 0;
    usedRef.current = 0;
    setDelayLeft(0);
  };

  const locked = phase !== 'idle';

  /** How a player's side looks right now: colors, the line of text, and the time to show. */
  const look = (player: Player) => {
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
      if (game && ending) {
        if (ending.kind === 'resign') {
          label = ending.loser === player ? 'You resigned' : 'Opponent resigned. You win!';
        } else {
          bg = '#3A3F4B';
          label = 'Draw agreed';
        }
      } else if (game && info.over) {
        if (info.over.kind === 'checkmate') {
          label = lost ? 'Checkmate. You lose.' : 'Checkmate. You win!';
        } else {
          bg = '#3A3F4B';
          label = `Draw: ${info.over.reason}`;
        }
      }
    } else if (phase === 'idle') {
      fg = '#E5E7EB';
      label = game
        ? info.moveCount === 0
          ? colorOf(player) === 'w'
            ? 'White moves first'
            : 'Black'
          : info.turn === colorOf(player)
            ? 'Your move'
            : 'Waiting'
        : first === player
          ? 'Goes first'
          : 'Tap to go first';
    } else if (isActive) {
      bg = mix(LIGHT_RGB, RED_RGB, redness);
      fg = mix(INK_RGB, WHITE_RGB, redness);
      label =
        phase === 'paused'
          ? 'Paused'
          : game && info.check
            ? 'Check!'
            : delayLeft > 0
              ? `Delay ${Math.ceil(delayLeft / 1000)} s`
              : game
                ? 'Your move'
                : 'Tap when you’ve moved';
    } else {
      label = 'Waiting';
    }
    return { bg, fg, label, left };
  };

  /** A big tappable side: the clock-only screen. */
  const side = (player: Player) => {
    const { bg, fg, label, left } = look(player);
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

  /** A compact player panel for the game screen: clock, status, and what they've captured. */
  const playerPanel = (player: Player) => {
    const { bg, fg, label, left } = look(player);
    const mine: Color = colorOf(player);
    const theirs: Color = mine === 'w' ? 'b' : 'w';
    const taken = mine === 'w' ? info.capturedByWhite : info.capturedByBlack;
    const lead = mine === 'w' ? info.lead : -info.lead;
    const seat = player === 0 ? 'bottom' : 'top';
    const inPlay = (phase === 'running' || phase === 'paused') && !info.over && !ending;
    const other: Player = player === 0 ? 1 : 0;
    const chip = [styles.chipSmall, { borderColor: fg }];
    return (
      <View
        style={[styles.panel, { backgroundColor: bg }, player === 1 && styles.flipped]}
        accessible
        accessibilityLabel={`${mine === 'w' ? 'White' : 'Black'}. ${format(left)}. ${label}`}
        testID={player === 0 ? 'side-bottom' : 'side-top'}
      >
        <Text
          style={[styles.panelTime, { color: fg }]}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          numberOfLines={1}
          testID={player === 0 ? 'time-bottom' : 'time-top'}
        >
          {format(left)}
        </Text>
        <View style={styles.panelInfo}>
          <Text style={[styles.panelLabel, { color: fg }]} numberOfLines={2} testID={player === 0 ? 'label-bottom' : 'label-top'}>
            {label}
          </Text>
          <View style={styles.taken}>
            {taken.map((type, i) => (
              <PieceView key={i} type={type} color={theirs} set={settings.pieceSet} size={24} glow={false} />
            ))}
            {lead > 0 && <Text style={[styles.lead, { color: fg }]}>+{lead}</Text>}
          </View>
          {inPlay && (
            <View style={styles.actionRow}>
              {drawOffer === other ? (
                <>
                  <Text style={[styles.offerText, { color: fg }]}>Draw offered</Text>
                  <Pressable style={chip} onPress={() => answerDraw(true)} testID={`draw-accept-${seat}`}>
                    <Text style={[styles.chipSmallText, { color: fg }]}>Accept</Text>
                  </Pressable>
                  <Pressable style={chip} onPress={() => answerDraw(false)} testID={`draw-decline-${seat}`}>
                    <Text style={[styles.chipSmallText, { color: fg }]}>Decline</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    style={[chip, resignArm === player && styles.chipArmed]}
                    onPress={() => resign(player)}
                    accessibilityRole="button"
                    testID={`resign-${seat}`}
                  >
                    <Text style={[styles.chipSmallText, { color: resignArm === player ? '#fff' : fg }]}>
                      {resignArm === player ? 'Tap again to resign' : '⚑ Resign'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[chip, drawOffer === player && styles.dim]}
                    disabled={drawOffer === player}
                    onPress={() => setDrawOffer(player)}
                    accessibilityRole="button"
                    testID={`draw-${seat}`}
                  >
                    <Text style={[styles.chipSmallText, { color: fg }]}>
                      {drawOffer === player ? 'Draw offered' : '½ Draw'}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
        </View>
      </View>
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
      <Text
        style={[
          styles.controlText,
          opts.primary && styles.controlPrimaryText,
          game && { fontSize: 12 },
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
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

  const boardDisabled = phase === 'paused' || phase === 'over' || panel !== null;
  const boardSize = Math.max(160, Math.min(width - 16, height - insets.top - insets.bottom - 112 - 2 * 96 - 24));

  const centerBlock = (
    <View style={styles.center}>
      {game && info.moveCount > 0 && (
        <ScrollView
          ref={movesRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => movesRef.current?.scrollToEnd({ animated: false })}
          style={styles.movesStrip}
          contentContainerStyle={styles.movesBody}
        >
          <Text style={styles.moves} testID="move-list">
            {info.san
              .map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m))
              .join('  ')
              .replace(/  (\d+\.)/g, '   $1')}
          </Text>
        </ScrollView>
      )}
      <Text style={styles.summary} testID="timer-summary">
        {phase === 'over'
          ? game && ending
            ? ending.kind === 'resign'
              ? 'Resigned'
              : 'Draw agreed'
            : game && info.over
              ? info.over.kind === 'checkmate'
                ? 'Checkmate'
                : 'Draw'
              : 'Time’s up'
          : describe(settings)}
      </Text>
      <View style={[styles.controls, game && { gap: 6 }]}>
        {button('⚙ Options', () => openPanel('options'), { testID: 'timer-options' })}
        {button('▶ Start', start, { disabled: phase !== 'idle', primary: true, testID: 'timer-start' })}
        {button(phase === 'paused' ? '▶ Resume' : '❚❚ Pause', togglePause, {
          disabled: phase !== 'running' && phase !== 'paused',
          testID: 'timer-pause',
        })}
        {game &&
          button('↶ Undo', () => boardRef.current?.undo(), { disabled: !canUndo, testID: 'timer-undo' })}
        {button('■ Reset', () => openPanel('confirm'), { disabled: phase === 'idle' && !(game && info.moveCount > 0), testID: 'timer-reset' })}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      {game ? (
        <>
          <View style={[styles.panelWrap, { paddingTop: insets.top + 6 }]}>{playerPanel(1)}</View>
          <View style={styles.boardWrap}>
            <ChessBoard
              ref={boardRef}
              size={boardSize}
              disabled={boardDisabled}
              facing={settings.pieceFacing}
              hints={settings.moveHints}
              set={settings.pieceSet}
              flipped={settings.blackAtBottom}
              resetKey={resetKey}
              onMove={onGameMove}
              onUndo={onGameUndo}
              onInfo={onGameInfo}
            />
            {phase === 'paused' && panel === null && (
              <View
                style={[styles.boardVeil, { width: Math.floor(boardSize / 8) * 8, height: Math.floor(boardSize / 8) * 8 }]}
                pointerEvents="none"
              >
                <Text style={styles.veilText}>Paused</Text>
              </View>
            )}
          </View>
          {centerBlock}
          <View style={[styles.panelWrap, { paddingBottom: insets.bottom + 6 }]}>{playerPanel(0)}</View>
        </>
      ) : (
        <>
          <View style={[styles.half, { paddingTop: insets.top + 10 }]}>{side(1)}</View>
          {centerBlock}
          <View style={[styles.half, { paddingBottom: insets.bottom + 10 }]}>{side(0)}</View>
        </>
      )}

      {panel === 'resume' && saved && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Carry on your game?</Text>
            <Text style={styles.cardBody} testID="resume-text">
              {`You left a game after ${saved.moves} ${saved.moves === 1 ? 'move' : 'moves'}. Carry on from where it was, with the clocks paused, or start a new one.`}
            </Text>
            <View style={styles.cardStack}>
              <Pressable
                style={[styles.stackButton, styles.cardPrimary]}
                onPress={resumeSaved}
                testID="resume-yes"
              >
                <Text style={[styles.controlText, styles.controlPrimaryText]}>Carry on</Text>
              </Pressable>
              <Pressable style={styles.stackButton} onPress={forgetSaved} testID="resume-no">
                <Text style={styles.controlText}>New game</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {panel === 'confirm' && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{game ? 'Reset' : 'Reset the clock?'}</Text>
            <Text style={styles.cardBody}>
              {game
                ? 'Reset the time puts both clocks back to the start and leaves the pieces where they are. Reset the game starts over with every piece in place and fresh clocks.'
                : 'This stops the game and puts both clocks back to the start.'}
            </Text>
            {game ? (
              <View style={styles.cardStack}>
                <Pressable style={styles.stackButton} onPress={resetTime} testID="timer-reset-time">
                  <Text style={styles.controlText}>Reset the time</Text>
                </Pressable>
                <Pressable
                  style={[styles.stackButton, styles.cardDanger]}
                  onPress={reset}
                  testID="timer-confirm-reset"
                >
                  <Text style={styles.controlText}>Reset the game</Text>
                </Pressable>
                <Pressable
                  style={[styles.stackButton, styles.cardPrimary]}
                  onPress={closePanel}
                  testID="timer-keep"
                >
                  <Text style={[styles.controlText, styles.controlPrimaryText]}>Keep going</Text>
                </Pressable>
              </View>
            ) : (
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
            )}
          </View>
        </View>
      )}

      {panel === 'options' && (
        <View style={styles.overlay}>
          <View style={[styles.card, styles.cardTall]}>
            <Text style={styles.cardTitle}>{game ? 'Chess game' : 'Chess timer'}</Text>
            <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardScrollBody}>
              {locked && (
                <Text style={styles.cardBody}>
                  A game is in progress. Reset the clock to change these.
                </Text>
              )}
              {game && (
                <>
                  <Text style={styles.sectionLabel}>Pieces</Text>
                  <View style={styles.chips}>
                    {PIECE_SETS.map((ps) => (
                      <Pressable
                        key={ps.id}
                        style={[styles.chip, settings.pieceSet === ps.id && styles.segmentOn]}
                        onPress={() => saveSettings({ ...settings, pieceSet: ps.id })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: settings.pieceSet === ps.id }}
                        testID={`set-${ps.id}`}
                      >
                        <Text
                          style={[styles.segmentText, settings.pieceSet === ps.id && styles.segmentTextOn]}
                        >
                          {ps.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.preview} testID="set-preview">
                    {(['k', 'q', 'r', 'b', 'n', 'p'] as const).map((t) => (
                      <PieceView key={'w' + t} type={t} color="w" set={settings.pieceSet} size={34} />
                    ))}
                    {(['k', 'q', 'r', 'b', 'n', 'p'] as const).map((t) => (
                      <PieceView key={'b' + t} type={t} color="b" set={settings.pieceSet} size={34} />
                    ))}
                  </View>
                  <Text style={styles.cardBody} testID="set-blurb">
                    {PIECE_SETS.find((x) => x.id === settings.pieceSet)?.blurb}
                  </Text>
                  <Text style={styles.sectionLabel}>Seats</Text>
                  <View style={styles.segment}>
                    {[false, true].map((blackBottom) => {
                      const canSwap = phase === 'idle' && info.moveCount === 0;
                      return (
                        <Pressable
                          key={String(blackBottom)}
                          disabled={!canSwap}
                          style={[
                            styles.segmentItem,
                            settings.blackAtBottom === blackBottom && styles.segmentOn,
                            !canSwap && styles.dim,
                          ]}
                          onPress={() => saveSettings({ ...settings, blackAtBottom: blackBottom })}
                          accessibilityRole="button"
                          accessibilityState={{ selected: settings.blackAtBottom === blackBottom }}
                          testID={blackBottom ? 'seat-black' : 'seat-white'}
                        >
                          <Text
                            style={[
                              styles.segmentText,
                              settings.blackAtBottom === blackBottom && styles.segmentTextOn,
                            ]}
                          >
                            {blackBottom ? 'Black at bottom' : 'White at bottom'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.cardBody}>
                    {phase === 'idle' && info.moveCount === 0
                      ? 'Choose who sits at the bottom. The board and clocks turn around to match.'
                      : 'You can swap seats at the start of a game. Reset the game to change them.'}
                  </Text>
                  <Text style={styles.sectionLabel}>Piece direction</Text>
                  <View style={styles.chips}>
                    {FACING_CHOICES.map((f) => (
                      <Pressable
                        key={f.id}
                        style={[styles.chip, settings.pieceFacing === f.id && styles.segmentOn]}
                        onPress={() => saveSettings({ ...settings, pieceFacing: f.id })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: settings.pieceFacing === f.id }}
                        testID={`facing-${f.id}`}
                      >
                        <Text
                          style={[styles.segmentText, settings.pieceFacing === f.id && styles.segmentTextOn]}
                        >
                          {f.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.cardBody} testID="facing-blurb">
                    {FACING_CHOICES.find((f) => f.id === settings.pieceFacing)?.blurb}
                  </Text>
                  <Text style={styles.sectionLabel}>Move hints</Text>
                  <View style={styles.segment}>
                    {[true, false].map((on) => (
                      <Pressable
                        key={String(on)}
                        style={[styles.segmentItem, settings.moveHints === on && styles.segmentOn]}
                        onPress={() => saveSettings({ ...settings, moveHints: on })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: settings.moveHints === on }}
                        testID={on ? 'hints-on' : 'hints-off'}
                      >
                        <Text
                          style={[styles.segmentText, settings.moveHints === on && styles.segmentTextOn]}
                        >
                          {on ? 'On' : 'Off'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.cardBody} testID="hints-blurb">
                    {settings.moveHints
                      ? 'Picking a piece shows where it can move.'
                      : 'Picking a piece shows nothing. You have to know where it can go; an illegal move simply won’t happen.'}
                  </Text>
                  <Text style={styles.sectionLabel}>Clock</Text>
                </>
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
  panelWrap: { flex: 1, minHeight: 84, paddingHorizontal: 8 },
  panel: {
    flex: 1,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 14,
  },
  panelTime: { width: '46%', fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] },
  panelInfo: { flex: 1, gap: 6 },
  panelLabel: { fontSize: 16, fontWeight: '700' },
  taken: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 24 },
  lead: { fontSize: 15, fontWeight: '800', marginLeft: 6 },
  boardWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  boardVeil: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  veilText: { color: '#fff', fontSize: 28, fontWeight: '800' },
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
  cardStack: { gap: 10 },
  preview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    padding: 6,
    borderRadius: 14,
    backgroundColor: '#8A9A6B',
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chipSmall: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipArmed: { backgroundColor: '#B3303C', borderColor: '#B3303C' },
  chipSmallText: { fontSize: 12, fontWeight: '700' },
  offerText: { fontSize: 12, fontWeight: '700' },
  movesStrip: { maxHeight: 24 },
  movesBody: { alignItems: 'center', paddingHorizontal: 4 },
  moves: { color: '#C5C9D2', fontSize: 14, fontVariant: ['tabular-nums'] },
  stackButton: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
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

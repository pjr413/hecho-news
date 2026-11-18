// Hidden games: a memory-match built from her own photos, and a two-player games table
// (tic-tac-toe, Connect Four, checkers) seated like the chess game: one player on each side.
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Confetti } from './fun';
import * as library from './library';
import type { Photo } from './types';

const BG = '#14161c';
const PANEL = '#232733';
const P_COLORS = ['#EE6C8A', '#F4D35E'];

// ---------------------------------------------------------------- memory match

const PAIRS = 8;

type Card = { key: number; photo: Photo; pair: number };

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function MemoryGame({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [open, setOpen] = useState<number[]>([]);
  const [done, setDone] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [burst, setBurst] = useState(0);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const pool = await library.fetchPage(0, 300, { filter: 'photos' });
        if (pool.length < PAIRS) {
          if (live) setError('Needs at least 8 photos in the library.');
          return;
        }
        const picked = shuffle(pool).slice(0, PAIRS);
        const deck = shuffle(
          picked.flatMap((photo, pair) => [
            { photo, pair },
            { photo, pair },
          ]),
        ).map((c, key) => ({ ...c, key }));
        if (live) setCards(deck);
      } catch {
        if (live) setError('Couldn’t load photos.');
      }
    })();
    return () => {
      live = false;
    };
  }, [round]);

  const flip = (i: number) => {
    if (!cards || open.length >= 2 || open.includes(i) || done.includes(cards[i].pair)) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      const [a, b] = next;
      if (cards[a].pair === cards[b].pair) {
        setTimeout(() => {
          setDone((d) => {
            const nd = [...d, cards[a].pair];
            if (nd.length === PAIRS) setBurst((n) => n + 1);
            return nd;
          });
          setOpen([]);
        }, 450);
      } else {
        setTimeout(() => setOpen([]), 900);
      }
    }
  };

  const gap = 8;
  const size = Math.min(width - 32, height - insets.top - insets.bottom - 220);
  const cell = (size - gap * 3) / 4;
  const won = done.length === PAIRS;

  return (
    <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <View style={s.bar}>
        <Pressable onPress={onExit} style={s.pill} testID="memory-exit">
          <Text style={s.pillText}>‹ Back</Text>
        </Pressable>
        <Text style={s.title}>Memory</Text>
        <Text style={s.pillText} testID="memory-moves">
          Moves {moves}
        </Text>
      </View>
      {error !== '' && <Text style={s.note}>{error}</Text>}
      {cards && (
        <View style={[s.grid, { width: size, gap }]} testID="memory-grid">
          {cards.map((c, i) => {
            const shown = open.includes(i) || done.includes(c.pair);
            return (
              <Pressable
                key={c.key}
                onPress={() => flip(i)}
                style={[
                  s.card,
                  { width: cell, height: cell },
                  done.includes(c.pair) && { opacity: 0.55 },
                ]}
                testID={`card-${i}`}
                accessibilityLabel={shown ? 'Photo' : 'Hidden card'}
              >
                {shown ? (
                  <Image source={{ uri: c.photo.uri }} style={s.fill} contentFit="cover" />
                ) : (
                  <Text style={s.back}>?</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={s.bar}>
        <Text style={s.note} testID="memory-status">
          {won ? `You matched them all in ${moves} moves!` : `Matched ${done.length} of ${PAIRS}`}
        </Text>
        <Pressable onPress={() => {
            setCards(null);
            setOpen([]);
            setDone([]);
            setMoves(0);
            setRound((r) => r + 1);
          }}
          style={s.pill}
          testID="memory-again">
          <Text style={s.pillText}>New deal</Text>
        </Pressable>
      </View>
      <Confetti burst={burst} kind="confetti" />
    </View>
  );
}

// ---------------------------------------------------------------- games table

type Seat = 0 | 1; // 0 sits at the bottom, 1 at the top (upside down)
type GameId = 'ttt' | 'c4' | 'checkers';

const GAMES: { id: GameId; name: string; icon: string }[] = [
  { id: 'ttt', name: 'Tic-tac-toe', icon: '✕○' },
  { id: 'c4', name: 'Connect Four', icon: '●●' },
  { id: 'checkers', name: 'Checkers', icon: '⛀' },
];

/** What a game reports back: whose turn, who has won (or a draw), and a short message. */
type Outcome = { turn: Seat; winner: Seat | 'draw' | null };

export function GamesTable({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [game, setGame] = useState<GameId>('ttt');
  const [round, setRound] = useState(0);
  const [out, setOut] = useState<Outcome>({ turn: 0, winner: null });
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [burst, setBurst] = useState(0);

  const report = useCallback((o: Outcome) => {
    setOut((prev) => {
      if (o.winner !== null && prev.winner === null) {
        if (o.winner !== 'draw') {
          const w = o.winner;
          setScore((sc) => (w === 0 ? [sc[0] + 1, sc[1]] : [sc[0], sc[1] + 1]));
          setBurst((n) => n + 1);
        }
      }
      return o;
    });
  }, []);

  const reset = (g: GameId = game) => {
    setGame(g);
    setOut({ turn: 0, winner: null });
    setRound((r) => r + 1);
  };

  const size = Math.min(width - 24, height - insets.top - insets.bottom - 250);

  const message = (seat: Seat): string => {
    if (out.winner === 'draw') return 'It’s a draw';
    if (out.winner !== null) return out.winner === seat ? 'You win! 🎉' : 'You lost';
    return out.turn === seat ? 'Your turn' : 'Waiting…';
  };

  const bar = (seat: Seat) => (
    <View
      style={[
        s.seat,
        seat === 1 && { transform: [{ rotate: '180deg' }] },
        out.turn === seat && out.winner === null && { borderColor: P_COLORS[seat] },
      ]}
      testID={`seat-bar-${seat}`}
    >
      <View style={[s.dot, { backgroundColor: P_COLORS[seat] }]} />
      <Text style={s.seatText} testID={`message-${seat}`}>
        {message(seat)}
      </Text>
      <Text style={s.seatScore} testID={`score-${seat}`}>
        {score[seat]}
      </Text>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      {bar(1)}
      <View style={{ width: size, height: size }} testID="games-board">
        {game === 'ttt' && <TicTacToe key={round} size={size} onState={report} />}
        {game === 'c4' && <ConnectFour key={round} size={size} onState={report} />}
        {game === 'checkers' && <Checkers key={round} size={size} onState={report} />}
      </View>
      {bar(0)}
      <View style={s.bar}>
        <Pressable onPress={onExit} style={s.pill} testID="games-exit">
          <Text style={s.pillText}>‹ Exit</Text>
        </Pressable>
        {GAMES.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => reset(g.id)}
            style={[s.pill, g.id === game && s.pillOn]}
            testID={`game-${g.id}`}
          >
            <Text style={s.pillText}>{g.name}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => reset()} style={s.pill} testID="games-new">
          <Text style={s.pillText}>New</Text>
        </Pressable>
      </View>
      <Confetti burst={burst} kind="confetti" />
    </View>
  );
}

type GameProps = { size: number; onState: (o: Outcome) => void };

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function TicTacToe({ size, onState }: GameProps) {
  const [cells, setCells] = useState<(Seat | null)[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<Seat>(0);
  const [winner, setWinner] = useState<Seat | 'draw' | null>(null);
  useEffect(() => onState({ turn, winner }), [turn, winner, onState]);

  const tap = (i: number) => {
    if (winner !== null || cells[i] !== null) return;
    const next = [...cells];
    next[i] = turn;
    setCells(next);
    if (LINES.some((l) => l.every((k) => next[k] === turn))) setWinner(turn);
    else if (next.every((c) => c !== null)) setWinner('draw');
    else setTurn(turn === 0 ? 1 : 0);
  };
  const cell = (size - 16) / 3;
  return (
    <View style={[s.wrap, { width: size, height: size, gap: 8 }]}>
      {cells.map((c, i) => (
        <Pressable
          key={i}
          onPress={() => tap(i)}
          style={[s.tttCell, { width: cell, height: cell }]}
          testID={`ttt-${i}`}
        >
          {c !== null && (
            <Text style={[s.mark, { color: P_COLORS[c], fontSize: cell * 0.7 }]}>
              {c === 0 ? '✕' : '○'}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const C4_COLS = 7;
const C4_ROWS = 6;

function fourInARow(b: (Seat | null)[], seat: Seat): boolean {
  const at = (r: number, c: number) => (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS ? b[r * C4_COLS + c] : null);
  for (let r = 0; r < C4_ROWS; r++)
    for (let c = 0; c < C4_COLS; c++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ])
        if ([0, 1, 2, 3].every((k) => at(r + dr * k, c + dc * k) === seat)) return true;
  return false;
}

function ConnectFour({ size, onState }: GameProps) {
  const [board, setBoard] = useState<(Seat | null)[]>(Array(C4_ROWS * C4_COLS).fill(null));
  const [turn, setTurn] = useState<Seat>(0);
  const [winner, setWinner] = useState<Seat | 'draw' | null>(null);
  useEffect(() => onState({ turn, winner }), [turn, winner, onState]);

  const drop = (c: number) => {
    if (winner !== null) return;
    let r = C4_ROWS - 1;
    while (r >= 0 && board[r * C4_COLS + c] !== null) r--;
    if (r < 0) return;
    const next = [...board];
    next[r * C4_COLS + c] = turn;
    setBoard(next);
    if (fourInARow(next, turn)) setWinner(turn);
    else if (next.every((x) => x !== null)) setWinner('draw');
    else setTurn(turn === 0 ? 1 : 0);
  };
  const cw = size / C4_COLS;
  return (
    <View style={[s.c4, { width: size, height: cw * C4_ROWS }]}>
      {Array.from({ length: C4_COLS }, (_, c) => (
        <Pressable key={c} onPress={() => drop(c)} style={{ width: cw }} testID={`c4-col-${c}`}>
          {Array.from({ length: C4_ROWS }, (_, r) => {
            const v = board[r * C4_COLS + c];
            return (
              <View key={r} style={[s.c4Cell, { width: cw, height: cw }]} testID={`c4-${r}-${c}`}>
                <View
                  style={[
                    s.c4Disc,
                    { width: cw - 8, height: cw - 8, borderRadius: cw },
                    { backgroundColor: v === null ? BG : P_COLORS[v] },
                  ]}
                />
              </View>
            );
          })}
        </Pressable>
      ))}
    </View>
  );
}

// ---- checkers

type Piece = { seat: Seat; king: boolean } | null;
type Move = { from: number; to: number; cap?: number };

function startBoard(): Piece[] {
  const b: Piece[] = Array(64).fill(null);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 !== 1) continue;
      if (r < 3) b[r * 8 + c] = { seat: 1, king: false };
      if (r > 4) b[r * 8 + c] = { seat: 0, king: false };
    }
  return b;
}

function movesFrom(b: Piece[], i: number): Move[] {
  const p = b[i];
  if (!p) return [];
  const r = Math.floor(i / 8);
  const c = i % 8;
  const forward = p.seat === 0 ? -1 : 1;
  const out: Move[] = [];
  for (const dr of p.king ? [-1, 1] : [forward])
    for (const dc of [-1, 1]) {
      const r1 = r + dr;
      const c1 = c + dc;
      if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
      const t = b[r1 * 8 + c1];
      if (!t) out.push({ from: i, to: r1 * 8 + c1 });
      else if (t.seat !== p.seat) {
        const r2 = r + dr * 2;
        const c2 = c + dc * 2;
        if (r2 >= 0 && r2 <= 7 && c2 >= 0 && c2 <= 7 && !b[r2 * 8 + c2])
          out.push({ from: i, to: r2 * 8 + c2, cap: r1 * 8 + c1 });
      }
    }
  return out;
}

/** All legal moves for a seat; captures are compulsory, and mid-chain only that piece may move. */
function legalMoves(b: Piece[], seat: Seat, chain: number | null): Move[] {
  const all: Move[] = [];
  b.forEach((p, i) => {
    if (p && p.seat === seat && (chain === null || chain === i)) all.push(...movesFrom(b, i));
  });
  const caps = all.filter((m) => m.cap !== undefined);
  return chain !== null || caps.length ? caps : all;
}

function Checkers({ size, onState }: GameProps) {
  const [board, setBoard] = useState<Piece[]>(startBoard);
  const [turn, setTurn] = useState<Seat>(0);
  const [chain, setChain] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [winner, setWinner] = useState<Seat | 'draw' | null>(null);
  useEffect(() => onState({ turn, winner }), [turn, winner, onState]);

  const legal = useMemo(() => legalMoves(board, turn, chain), [board, turn, chain]);
  const targets = picked === null ? [] : legal.filter((m) => m.from === picked);

  const tap = (i: number) => {
    if (winner !== null) return;
    const move = targets.find((m) => m.to === i);
    if (move) {
      const next = [...board];
      const piece = next[move.from]!;
      next[move.from] = null;
      if (move.cap !== undefined) next[move.cap] = null;
      const lastRow = piece.seat === 0 ? 0 : 7;
      const crowned = !piece.king && Math.floor(move.to / 8) === lastRow;
      next[move.to] = { ...piece, king: piece.king || crowned };
      setBoard(next);
      if (move.cap !== undefined && !crowned && legalMoves(next, turn, move.to).length) {
        setChain(move.to);
        setPicked(move.to);
        return;
      }
      const other: Seat = turn === 0 ? 1 : 0;
      setChain(null);
      setPicked(null);
      if (!legalMoves(next, other, null).length) setWinner(turn);
      else setTurn(other);
      return;
    }
    if (chain === null && legal.some((m) => m.from === i)) setPicked(i);
    else if (chain === null) setPicked(null);
  };

  const cell = size / 8;
  return (
    <View style={[s.wrap, { width: size, height: size }]}>
      {board.map((p, i) => {
        const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
        const target = targets.some((m) => m.to === i);
        return (
          <Pressable
            key={i}
            onPress={() => tap(i)}
            style={[
              { width: cell, height: cell, alignItems: 'center', justifyContent: 'center' },
              { backgroundColor: dark ? '#6b4a32' : '#e8d3b0' },
              picked === i && { backgroundColor: '#8f7a2a' },
            ]}
            testID={`ck-${i}`}
          >
            {target && <View style={s.hint} />}
            {p && (
              <View
                style={[
                  s.checker,
                  { width: cell * 0.78, height: cell * 0.78, borderRadius: cell },
                  { backgroundColor: P_COLORS[p.seat] },
                ]}
                testID={`ckp-${i}`}
              >
                {p.king && <Text style={{ fontSize: cell * 0.45 }}>♛</Text>}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'space-between' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    width: '100%',
    flexWrap: 'wrap',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  pill: { backgroundColor: PANEL, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18 },
  pillOn: { backgroundColor: '#3a4060' },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  note: { color: '#c9cde0', fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: {
    backgroundColor: PANEL,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { width: '100%', height: '100%' },
  back: { color: '#8089b5', fontSize: 30, fontWeight: '700' },
  seat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: PANEL,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 240,
  },
  dot: { width: 16, height: 16, borderRadius: 8 },
  seatText: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  seatScore: { color: '#c9cde0', fontSize: 18, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  tttCell: { backgroundColor: PANEL, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  mark: { fontWeight: '800' },
  c4: { flexDirection: 'row', backgroundColor: '#2c4fa8', borderRadius: 12, alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  c4Cell: { alignItems: 'center', justifyContent: 'center' },
  c4Disc: {},
  checker: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(0,0,0,.35)' },
  hint: { position: 'absolute', width: '36%', height: '36%', borderRadius: 99, backgroundColor: 'rgba(255,255,255,.45)' },
});

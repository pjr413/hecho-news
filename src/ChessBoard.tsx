import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import * as Haptics from 'expo-haptics';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { PIECE_SET_BY_ID, type PieceSetId } from './pieceSets';

/**
 * Which way the pieces stand: facing their own player ('each', so the pieces of whoever sits at
 * the top are turned toward them), all upright for the player at the bottom, or all upright for
 * the top one.
 */
export type Facing = 'each' | 'bottom' | 'top';

/** What the rest of the screen needs to know about the game. */
export type GameInfo = {
  /** Whose move it is. */
  turn: Color;
  check: boolean;
  /** Set once the game is decided: a checkmate, or a draw (with the reason). */
  over: null | { kind: 'checkmate' | 'draw'; reason: string };
  /** Pieces each side has taken, in the order they were taken. */
  capturedByWhite: PieceSymbol[];
  capturedByBlack: PieceSymbol[];
  /** Material white is ahead by (negative when black is ahead). */
  lead: number;
  /** How many moves (half-moves) have been played. */
  moveCount: number;
  /** Every move played, in standard notation. */
  san: string[];
};

export const START_INFO: GameInfo = {
  turn: 'w',
  check: false,
  over: null,
  capturedByWhite: [],
  capturedByBlack: [],
  lead: 0,
  moveCount: 0,
  san: [],
};

const NAME: Record<PieceSymbol, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = 'abcdefgh';

const LIGHT_SQUARE = '#EEEED2';
const DARK_SQUARE = '#769656';

/** The cheat code: swipe up, up, down, down, left, right, left, right. */
const CODE = 'UUDDLRLR';

function glyphStyle(color: Color, size: number) {
  return color === 'w'
    ? {
        color: '#FFFFFF',
        textShadowColor: 'rgba(0,0,0,0.9)',
        textShadowRadius: Math.max(2, size / 18),
        fontSize: size,
      }
    : {
        color: '#15171C',
        textShadowColor: 'rgba(255,255,255,0.45)',
        textShadowRadius: Math.max(1.5, size / 24),
        fontSize: size,
      };
}

/**
 * A soft dark glow that sits just under a piece: a faint dark copy of it, nudged down, whose own
 * shadow spreads into a halo. Drawn beneath the real piece so it only shows around the edges.
 */
function glowStyle(size: number) {
  return {
    color: 'rgba(0,0,0,0.3)',
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowRadius: Math.max(4, size / 7),
    textShadowOffset: { width: 0, height: 0 },
    fontSize: size,
  };
}

/** One piece in the chosen set, drawn to fit a square of this size. */
export function PieceView({
  type,
  color,
  set,
  size,
  glow = true,
}: {
  type: PieceSymbol;
  color: Color;
  set: PieceSetId;
  size: number;
  glow?: boolean;
}) {
  const def = PIECE_SET_BY_ID[set];
  const text = def.glyphs[type];
  if (def.kind === 'disc') {
    const d = size * 0.86;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color === 'w' ? '#F6F2E7' : '#262932',
            borderWidth: Math.max(1.5, size / 22),
            borderColor: color === 'w' ? '#C9C2AE' : '#0C0D10',
            boxShadow: glow ? `0px ${size * 0.06}px ${size * 0.14}px rgba(0,0,0,0.55)` : undefined,
          }}
        >
          <Text allowFontScaling={false} style={[styles.piece, { fontSize: d * 0.56 }]}>
            {text}
          </Text>
        </View>
      </View>
    );
  }
  const fontSize = def.id === 'letters' ? size * 0.6 : size * 0.84;
  const weight = def.id === 'letters' ? ({ fontWeight: '800' } as const) : null;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {glow && (
        <View style={[styles.layer, { transform: [{ translateY: size * 0.05 }] }]}>
          <Text style={[styles.piece, weight, glowStyle(fontSize)]} allowFontScaling={false}>
            {text}
          </Text>
        </View>
      )}
      <View style={styles.layer}>
        <Text style={[styles.piece, weight, glyphStyle(color, fontSize)]} allowFontScaling={false}>
          {text}
        </Text>
      </View>
    </View>
  );
}

function infoOf(chess: Chess): GameInfo {
  const byWhite: PieceSymbol[] = [];
  const byBlack: PieceSymbol[] = [];
  let lead = 0;
  const history = chess.history({ verbose: true });
  for (const m of history) {
    if (!m.captured) continue;
    (m.color === 'w' ? byWhite : byBlack).push(m.captured);
    lead += (m.color === 'w' ? 1 : -1) * VALUE[m.captured];
  }
  let over: GameInfo['over'] = null;
  if (chess.isCheckmate()) over = { kind: 'checkmate', reason: 'Checkmate' };
  else if (chess.isStalemate()) over = { kind: 'draw', reason: 'Stalemate' };
  else if (chess.isInsufficientMaterial()) {
    over = { kind: 'draw', reason: 'Not enough pieces left to win' };
  } else if (chess.isThreefoldRepetition()) {
    over = { kind: 'draw', reason: 'The same position three times' };
  } else if (chess.isDraw()) {
    over = { kind: 'draw', reason: 'Fifty moves without a capture or pawn move' };
  }
  return {
    turn: chess.turn(),
    check: chess.isCheck(),
    over,
    capturedByWhite: byWhite,
    capturedByBlack: byBlack,
    lead,
    moveCount: history.length,
    san: history.map((m) => m.san),
  };
}

export type ChessBoardHandle = {
  /** Take back the last move. Returns false when there's nothing to take back. */
  undo: () => boolean;
  /** The game so far, to save it. */
  pgn: () => string;
  /** Load a saved game. Returns false if it couldn't be read. */
  load: (pgn: string) => boolean;
};

type Props = {
  /** Side length of the board in points. */
  size: number;
  /** Ignore taps (the clock is paused, a panel is open, or the game is over). */
  disabled: boolean;
  /** Which way the pieces face. */
  facing: Facing;
  /** Show where a picked piece can go (dots and rings). */
  hints: boolean;
  /** Which set of pieces to draw. */
  set: PieceSetId;
  /** Black sits at the bottom instead of white. */
  flipped: boolean;
  /** Changing this starts a fresh game. */
  resetKey: number;
  /** A legal move was just made by this color. */
  onMove: (mover: Color) => void;
  /** A move was taken back; this is the color that had played it. */
  onUndo: (mover: Color) => void;
  /** The game's state changed. */
  onInfo: (info: GameInfo) => void;
};

export const ChessBoard = forwardRef<ChessBoardHandle, Props>(function ChessBoard(
  { size, disabled, facing, hints, set, flipped, resetKey, onMove, onUndo, onInfo },
  ref,
) {
  const chess = useRef(new Chess());
  const [, redraw] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [last, setLast] = useState<{ from: Square; to: Square } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square; color: Color } | null>(null);
  const [disco, setDisco] = useState(false);
  const [hue, setHue] = useState(0);
  const callbacks = useRef({ onMove, onUndo, onInfo });
  callbacks.current = { onMove, onUndo, onInfo };

  const lastOf = (c: Chess) => {
    const h = c.history({ verbose: true });
    const m = h[h.length - 1];
    return m ? { from: m.from, to: m.to } : null;
  };
  const clearPicks = () => {
    setSelected(null);
    setMoves([]);
    setPromo(null);
  };

  // A new game.
  useEffect(() => {
    chess.current = new Chess();
    clearPicks();
    setLast(null);
    redraw((n) => n + 1);
    callbacks.current.onInfo(START_INFO);
  }, [resetKey]);

  useImperativeHandle(ref, () => ({
    undo: () => {
      const taken = chess.current.undo();
      if (!taken) return false;
      clearPicks();
      setLast(lastOf(chess.current));
      redraw((n) => n + 1);
      callbacks.current.onUndo(taken.color);
      callbacks.current.onInfo(infoOf(chess.current));
      return true;
    },
    pgn: () => chess.current.pgn(),
    load: (pgn: string) => {
      try {
        const next = new Chess();
        next.loadPgn(pgn);
        chess.current = next;
      } catch {
        return false;
      }
      clearPicks();
      setLast(lastOf(chess.current));
      redraw((n) => n + 1);
      callbacks.current.onInfo(infoOf(chess.current));
      return true;
    },
  }));

  const play = (from: Square, to: Square, promotion?: PieceSymbol) => {
    let made: Move;
    try {
      made = chess.current.move({ from, to, promotion });
    } catch {
      return;
    }
    setLast({ from, to });
    clearPicks();
    redraw((n) => n + 1);
    Haptics.selectionAsync().catch(() => {});
    callbacks.current.onMove(made.color);
    callbacks.current.onInfo(infoOf(chess.current));
  };

  const tap = (square: Square) => {
    if (disabled || promo) return;
    const c = chess.current;
    if (selected) {
      const options = moves.filter((m) => m.to === square);
      if (options.length) {
        if (options.some((m) => m.promotion)) {
          setPromo({ from: selected, to: square, color: c.turn() });
        } else {
          play(selected, square);
        }
        return;
      }
    }
    const piece = c.get(square);
    if (piece && piece.color === c.turn() && square !== selected) {
      setSelected(square);
      setMoves(c.moves({ square, verbose: true }));
    } else {
      setSelected(null);
      setMoves([]);
    }
  };

  // The cheat code: swipes across the board, remembered for a few seconds each.
  const swipes = useRef({ text: '', at: 0 });
  const onSwipe = (dx: number, dy: number) => {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
    const now = Date.now();
    if (now - swipes.current.at > 4000) swipes.current.text = '';
    swipes.current.at = now;
    const dir = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'U' : 'D') : dx < 0 ? 'L' : 'R';
    swipes.current.text = (swipes.current.text + dir).slice(-CODE.length);
    if (swipes.current.text === CODE) {
      swipes.current.text = '';
      setDisco(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  };
  const swipe = usePanGesture({
    minDistance: 30,
    onDeactivate: (e) => {
      'worklet';
      scheduleOnRN(onSwipe, e.translationX, e.translationY);
    },
  });

  // Disco mode: the squares cycle through colors for ten seconds.
  useEffect(() => {
    if (!disco) return;
    const spin = setInterval(() => setHue((h) => (h + 22) % 360), 140);
    const stop = setTimeout(() => setDisco(false), 10000);
    return () => {
      clearInterval(spin);
      clearTimeout(stop);
    };
  }, [disco]);

  /** Is a piece of this color drawn turned around (upside down on screen)? */
  const topColor: Color = flipped ? 'w' : 'b';
  const turned = (color: Color) =>
    facing === 'top' ? true : facing === 'bottom' ? false : color === topColor;
  const cell = Math.floor(size / 8);
  const side = cell * 8;
  const data = chess.current.board(); // rank 8 first
  const kingInCheck = chess.current.isCheck() ? chess.current.turn() : null;
  const targets = new Map(moves.map((m) => [m.to, m] as const));

  return (
    <GestureDetector gesture={swipe}>
      <View style={{ width: side, height: side }} testID="board">
        {Array.from({ length: 8 }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {Array.from({ length: 8 }, (_, c) => {
              // With black at the bottom the whole board is turned around.
              const sr = flipped ? 7 - r : r;
              const sc = flipped ? 7 - c : c;
              const piece = data[sr][sc];
              const square = `${FILES[sc]}${8 - sr}` as Square;
              const light = (sr + sc) % 2 === 0;
              const target = targets.get(square);
              const isLast = last && (last.from === square || last.to === square);
              const checked = piece?.type === 'k' && piece.color === kingInCheck;
              const base = disco
                ? `hsl(${(hue + (r * 8 + c) * 17) % 360}, 75%, ${light ? 72 : 48}%)`
                : light
                  ? LIGHT_SQUARE
                  : DARK_SQUARE;
              return (
                <Pressable
                  key={square}
                  onPress={() => tap(square)}
                  style={{
                    width: cell,
                    height: cell,
                    backgroundColor: base,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    piece
                      ? `${piece.color === 'w' ? 'White' : 'Black'} ${NAME[piece.type]} on ${square}`
                      : `Empty square ${square}`
                  }
                  testID={`sq-${square}`}
                >
                  {isLast && <View style={[styles.fill, styles.lastMove]} />}
                  {selected === square && <View style={[styles.fill, styles.selected]} />}
                  {checked && <View style={[styles.fill, styles.checked]} />}
                  {piece && (
                    <View
                      style={[
                        { width: cell, height: cell },
                        turned(piece.color) && styles.turnedAround,
                      ]}
                      pointerEvents="none"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      testID={`piece-${square}`}
                    >
                      <PieceView type={piece.type} color={piece.color} set={set} size={cell} />
                    </View>
                  )}
                  {hints && target && !target.captured && !target.flags.includes('e') && (
                    <View
                      style={[styles.dot, { width: cell * 0.3, height: cell * 0.3, borderRadius: cell }]}
                      testID={`dot-${square}`}
                    />
                  )}
                  {hints && target && (target.captured || target.flags.includes('e')) && (
                    <View
                      style={[styles.ring, { borderRadius: cell }]}
                      testID={`dot-${square}`}
                      pointerEvents="none"
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}

        {disco && (
          <View style={styles.discoTag} pointerEvents="none">
            <Text style={styles.discoText} testID="disco">
              DISCO!
            </Text>
          </View>
        )}

        {promo && (
          <Pressable
            style={styles.promoBackdrop}
            onPress={() => setPromo(null)}
            accessibilityLabel="Cancel promotion"
          >
            {/* The picker faces the player who is promoting. */}
            <View style={[styles.promoRow, promo.color === topColor && styles.turnedAround]}>
              {(['q', 'r', 'b', 'n'] as const).map((type) => (
                <Pressable
                  key={type}
                  style={[styles.promoChoice, { width: cell * 1.1, height: cell * 1.1 }]}
                  onPress={() => play(promo.from, promo.to, type)}
                  accessibilityRole="button"
                  accessibilityLabel={`Promote to ${NAME[type]}`}
                  testID={`promo-${type}`}
                >
                  {/* Each piece still follows the chosen direction, so it matches the board. */}
                  <View
                    style={
                      turned(promo.color) !== (promo.color === topColor) ? styles.turnedAround : null
                    }
                  >
                    <PieceView type={type} color={promo.color} set={set} size={cell} glow={false} />
                  </View>
                </Pressable>
              ))}
            </View>
          </Pressable>
        )}
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastMove: { backgroundColor: 'rgba(255, 235, 59, 0.38)' },
  selected: { backgroundColor: 'rgba(255, 214, 10, 0.6)' },
  checked: { backgroundColor: 'rgba(229, 57, 53, 0.75)' },
  piece: { textAlign: 'center', includeFontPadding: false },
  turnedAround: { transform: [{ rotate: '180deg' }] },
  dot: { position: 'absolute', backgroundColor: 'rgba(20, 20, 20, 0.35)' },
  ring: {
    position: 'absolute',
    top: 2,
    right: 2,
    bottom: 2,
    left: 2,
    borderWidth: 3,
    borderColor: 'rgba(20, 20, 20, 0.35)',
  },
  discoTag: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  discoText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  promoBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#2A2D37',
  },
  promoChoice: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8A9A6B',
  },
});

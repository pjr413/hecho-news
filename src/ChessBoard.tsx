import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** What the rest of the screen needs to know about the game. */
export type GameInfo = {
  /** Whose move it is. White sits at the bottom, black at the top. */
  turn: Color;
  check: boolean;
  /** Set once the game is decided: a checkmate, or a draw (with the reason). */
  over: null | { kind: 'checkmate' | 'draw'; reason: string };
  /** Pieces each side has taken, in the order they were taken. */
  capturedByWhite: PieceSymbol[];
  capturedByBlack: PieceSymbol[];
  /** Material white is ahead by (negative when black is ahead). */
  lead: number;
};

export const START_INFO: GameInfo = {
  turn: 'w',
  check: false,
  over: null,
  capturedByWhite: [],
  capturedByBlack: [],
  lead: 0,
};

// The solid set of symbols is used for both sides and colored in. The trailing U+FE0E asks the
// phone to draw them as plain text, not as the colored emoji it would otherwise pick for the pawn.
const GLYPH: Record<PieceSymbol, string> = {
  k: '♚︎',
  q: '♛︎',
  r: '♜︎',
  b: '♝︎',
  n: '♞︎',
  p: '♟︎',
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

export function glyph(type: PieceSymbol): string {
  return GLYPH[type];
}

export function pieceStyle(color: Color, size: number) {
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

function infoOf(chess: Chess): GameInfo {
  const byWhite: PieceSymbol[] = [];
  const byBlack: PieceSymbol[] = [];
  let lead = 0;
  for (const m of chess.history({ verbose: true })) {
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
  } else if (chess.isDraw()) over = { kind: 'draw', reason: 'Fifty moves without a capture or pawn move' };
  return {
    turn: chess.turn(),
    check: chess.isCheck(),
    over,
    capturedByWhite: byWhite,
    capturedByBlack: byBlack,
    lead,
  };
}

type Props = {
  /** Side length of the board in points. */
  size: number;
  /** Ignore taps (the clock is paused, a panel is open, or the game is over). */
  disabled: boolean;
  /** Changing this starts a fresh game. */
  resetKey: number;
  /** A legal move was just made by this color. */
  onMove: (mover: Color) => void;
  /** The game's state changed. */
  onInfo: (info: GameInfo) => void;
};

export function ChessBoard({ size, disabled, resetKey, onMove, onInfo }: Props) {
  const chess = useRef(new Chess());
  const [, redraw] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [last, setLast] = useState<{ from: Square; to: Square } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square; color: Color } | null>(null);
  const callbacks = useRef({ onMove, onInfo });
  callbacks.current = { onMove, onInfo };

  // A new game.
  useEffect(() => {
    chess.current = new Chess();
    setSelected(null);
    setMoves([]);
    setLast(null);
    setPromo(null);
    redraw((n) => n + 1);
    callbacks.current.onInfo(START_INFO);
  }, [resetKey]);

  const play = (from: Square, to: Square, promotion?: PieceSymbol) => {
    let made: Move;
    try {
      made = chess.current.move({ from, to, promotion });
    } catch {
      return;
    }
    setLast({ from, to });
    setSelected(null);
    setMoves([]);
    setPromo(null);
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

  const cell = Math.floor(size / 8);
  const side = cell * 8;
  const rows = chess.current.board(); // rank 8 first
  const kingInCheck = chess.current.isCheck() ? chess.current.turn() : null;
  const targets = new Map(moves.map((m) => [m.to, m] as const));

  return (
    <View style={{ width: side, height: side }} testID="board">
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((piece, c) => {
            const square = `${FILES[c]}${8 - r}` as Square;
            const light = (r + c) % 2 === 0;
            const target = targets.get(square);
            const isLast = last && (last.from === square || last.to === square);
            const checked = piece?.type === 'k' && piece.color === kingInCheck;
            return (
              <Pressable
                key={square}
                onPress={() => tap(square)}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: light ? LIGHT_SQUARE : DARK_SQUARE,
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
                  <Text
                    style={[
                      styles.piece,
                      pieceStyle(piece.color, cell * 0.84),
                      // Black sits across the table, so their pieces are turned to face them.
                      piece.color === 'b' && styles.turnedAround,
                    ]}
                    allowFontScaling={false}
                    testID={`piece-${square}`}
                  >
                    {GLYPH[piece.type]}
                  </Text>
                )}
                {target && !target.captured && !target.flags.includes('e') && (
                  <View
                    style={[styles.dot, { width: cell * 0.3, height: cell * 0.3, borderRadius: cell }]}
                    testID={`dot-${square}`}
                  />
                )}
                {target && (target.captured || target.flags.includes('e')) && (
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

      {promo && (
        <Pressable
          style={styles.promoBackdrop}
          onPress={() => setPromo(null)}
          accessibilityLabel="Cancel promotion"
        >
          {/* The picker faces the player who is promoting. */}
          <View style={[styles.promoRow, promo.color === 'b' && styles.turnedAround]}>
            {(['q', 'r', 'b', 'n'] as const).map((type) => (
              <Pressable
                key={type}
                style={[styles.promoChoice, { width: cell * 1.1, height: cell * 1.1 }]}
                onPress={() => play(promo.from, promo.to, type)}
                accessibilityRole="button"
                accessibilityLabel={`Promote to ${NAME[type]}`}
                testID={`promo-${type}`}
              >
                <Text
                  style={[styles.piece, pieceStyle(promo.color, cell * 0.84)]}
                  allowFontScaling={false}
                >
                  {GLYPH[type]}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
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

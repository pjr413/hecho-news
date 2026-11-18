import type { PieceSymbol } from 'chess.js';

export type PieceSetId =
  | 'classic'
  | 'outline'
  | 'letters';

/**
 * 'glyph' sets are drawn as colored text (white or black pieces). 'disc' sets are emoji, which
 * can't be recolored, so each piece sits on a light or dark disc to show whose it is.
 */
export type PieceSet = {
  id: PieceSetId;
  name: string;
  kind: 'glyph' | 'disc';
  glyphs: Record<PieceSymbol, string>;
  blurb: string;
};

// The trailing U+FE0E asks the phone for the plain text look instead of a colored emoji.
const solid = (c: string) => `${c}︎`;

export const PIECE_SETS: PieceSet[] = [
  {
    id: 'classic',
    name: 'Classic',
    kind: 'glyph',
    blurb: 'The usual solid pieces.',
    glyphs: {
      k: solid('♚'),
      q: solid('♛'),
      r: solid('♜'),
      b: solid('♝'),
      n: solid('♞'),
      p: solid('♟'),
    },
  },
  {
    id: 'outline',
    name: 'Outline',
    kind: 'glyph',
    blurb: 'Hollow pieces, drawn in line.',
    glyphs: {
      k: solid('♔'),
      q: solid('♕'),
      r: solid('♖'),
      b: solid('♗'),
      n: solid('♘'),
      p: solid('♙'),
    },
  },
  {
    id: 'letters',
    name: 'Letters',
    kind: 'glyph',
    blurb: 'K, Q, R, B, N and P, as in the notation.',
    glyphs: { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' },
  },
];

export const PIECE_SET_BY_ID: Record<PieceSetId, PieceSet> = Object.fromEntries(
  PIECE_SETS.map((s) => [s.id, s]),
) as Record<PieceSetId, PieceSet>;

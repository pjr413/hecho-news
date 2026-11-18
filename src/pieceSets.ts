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

export type BoardThemeId = 'green' | 'wood' | 'blue' | 'gray' | 'pink' | 'night';

/** Square colors for the board. */
export const BOARD_THEMES: { id: BoardThemeId; name: string; light: string; dark: string }[] = [
  { id: 'green', name: 'Green', light: '#EEEED2', dark: '#769656' },
  { id: 'wood', name: 'Wood', light: '#F0D9B5', dark: '#B58863' },
  { id: 'blue', name: 'Blue', light: '#DEE3E6', dark: '#8CA2AD' },
  { id: 'gray', name: 'Gray', light: '#E4E4E4', dark: '#8A8A8A' },
  { id: 'pink', name: 'Pink', light: '#FBE4EC', dark: '#E08AA8' },
  { id: 'night', name: 'Night', light: '#6B7089', dark: '#3A3E54' },
];

export const BOARD_THEME_BY_ID: Record<BoardThemeId, (typeof BOARD_THEMES)[number]> = Object.fromEntries(
  BOARD_THEMES.map((b) => [b.id, b]),
) as Record<BoardThemeId, (typeof BOARD_THEMES)[number]>;

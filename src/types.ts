export type Photo = {
  id: string;
  uri: string;
  favorite: boolean;
};

/** An album in one of the spots. `id` is the phone's own id once known; a brand-new album has only a name until it's created on Save. */
export type AlbumRef = { name: string; id?: string };

/** An album that already exists on the phone, for the picker. */
export type DeviceAlbum = { id: string; title: string; count?: number };

export type Access = 'all' | 'limited' | 'none';

/** What can be decided about a photo. */
export type Choice = { type: 'trash' } | { type: 'album'; slot: number };

/** Everything a swipe or button can do: decide, or move along the timeline. */
export type Action = Choice | { type: 'next' } | { type: 'prev' };

/**
 * `at` is when the choice was made; the trash bin counts its days from it. A photo dropped on an
 * album is filed straight away: `filed` turns true once that has happened, and `album` records
 * where it went (so Undo can take it back out).
 */
export type Decision = {
  photo: Photo;
  action: Choice;
  at: number;
  filed?: boolean;
  album?: AlbumRef;
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_CHOICES = [3, 7, 14, 30];
export const DEFAULT_RETENTION_DAYS = 7;

/** Albums are added by the user, four along the top then four along the bottom. */
/** Rows of album spots she can show (chosen in Options), four spots in each. */
export const MAX_ROWS = 4;

/** Screen layouts she can switch between in Options. */
export type Design = 1 | 2;
export const DESIGNS: { id: Design; name: string; blurb: string }[] = [
  { id: 1, name: 'Version 1', blurb: 'Album rows along the top and the bottom' },
  { id: 2, name: 'Version 2', blurb: 'All the album rows across the bottom' },
];
export const ROW_SIZE = 4;
export const MAX_ALBUMS = ROW_SIZE * MAX_ROWS;

/** The ready-made album types offered in Options (the colors follow SLOT_COLORS in order). */
export const ALBUM_TYPES = ['Family', 'Friends', 'Travel', 'Keepers', 'Kids', 'Pets', 'Food', 'Funny'];

export const SLOT_COLORS = [
  '#F2A65A',
  '#EE6C8A',
  '#5BC0BE',
  '#B892FF',
  '#7BD389',
  '#F4D35E',
  '#6FA8FF',
  '#FF8C61',
];

/** Album spots repeat their colors after the first eight. */
export const slotColor = (slot: number): string => SLOT_COLORS[slot % SLOT_COLORS.length];

/** How many rows are needed to show every album that's been placed (at least one). */
export function rowsNeeded(slots: (AlbumRef | null)[]): number {
  let rows = 1;
  slots.forEach((a, i) => {
    if (a) rows = Math.max(rows, Math.floor(i / ROW_SIZE) + 1);
  });
  return rows;
}

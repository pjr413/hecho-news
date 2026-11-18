export type Photo = {
  id: string;
  uri: string;
  favorite: boolean;
  /** A video: shows a play badge and its length. */
  video?: boolean;
  /** A Live Photo: holding it plays its little clip. */
  live?: boolean;
  /** Length of a video, in seconds. */
  duration?: number;
  /** When it was taken, in milliseconds. */
  time?: number;
  /** Pixel size, used to spot near-identical shots. */
  w?: number;
  h?: number;
};

/** Which kinds of media the timeline shows. 'bursts' is photos taken in quick succession. */
export type Filter = 'all' | 'photos' | 'videos' | 'screenshots' | 'live' | 'panoramas' | 'big';
export type View = Filter | 'bursts' | 'duplicates';

/** Photos taken within this many milliseconds of each other, the same size, count as a burst. */
export const BURST_GAP_MS = 4000;

/** Are these two neighbouring photos shots of the same moment (a burst)? */
export function isBurstPair(a: Photo, b: Photo): boolean {
  return (
    !a.video &&
    !b.video &&
    a.time !== undefined &&
    b.time !== undefined &&
    Math.abs(a.time - b.time) <= BURST_GAP_MS &&
    a.w === b.w &&
    a.h === b.h
  );
}

/** Are these two the very same shot saved twice (same instant, same size)? */
export function isDuplicatePair(a: Photo, b: Photo): boolean {
  return (
    !a.video &&
    !b.video &&
    a.time !== undefined &&
    b.time !== undefined &&
    Math.abs(a.time - b.time) <= 1 &&
    a.w === b.w &&
    a.h === b.h
  );
}

type Pair = (a: Photo, b: Photo) => boolean;

/** Keeps only photos that have at least one neighbour (newest first or oldest first) passing `same`. */
function groupsOf(list: Photo[], same: Pair): Photo[] {
  const out: Photo[] = [];
  let group: Photo[] = [];
  const flush = () => {
    if (group.length > 1) out.push(...group);
    group = [];
  };
  for (const p of list) {
    const prev = group[group.length - 1];
    if (!(prev && same(prev, p))) flush();
    group.push(p);
  }
  flush();
  return out;
}

/** Photos that look like repeats: neighbours taken within a few seconds at the same size. */
export const findBursts = (list: Photo[]): Photo[] => groupsOf(list, isBurstPair);

/** Exact repeats: the same shot saved more than once. */
export const findDuplicates = (list: Photo[]): Photo[] => groupsOf(list, isDuplicatePair);

/**
 * The photos around position `i` that belong to the same burst or duplicate group (including
 * `i`), or just the photo and the one after it when it isn't part of a group.
 */
export function groupAround(list: Photo[], i: number, view: View): Photo[] {
  const same: Pair | null = view === 'duplicates' ? isDuplicatePair : view === 'bursts' ? isBurstPair : null;
  if (same) {
    let lo = i;
    let hi = i;
    while (lo > 0 && same(list[lo - 1], list[lo])) lo--;
    while (hi + 1 < list.length && same(list[hi], list[hi + 1])) hi++;
    if (hi > lo) return list.slice(lo, hi + 1);
  }
  return list.slice(i, i + 2);
}

/** Running totals for the secret stats page. */
export type Stats = {
  sorted: number;
  trashed: number;
  filed: number;
  favorited: number;
  bestStreak: number;
  /** When she started using the app (ms). */
  since: number;
};

export const EMPTY_STATS = (): Stats => ({
  sorted: 0,
  trashed: 0,
  filed: 0,
  favorited: 0,
  bestStreak: 0,
  since: Date.now(),
});

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

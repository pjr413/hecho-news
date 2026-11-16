export type Photo = {
  id: string;
  uri: string;
  favorite: boolean;
};

export type Access = 'all' | 'limited' | 'none';

/** What can be decided about a photo. */
export type Choice = { type: 'trash' } | { type: 'album'; slot: number };

/** Everything a swipe or button can do: decide, or move along the timeline. */
export type Action = Choice | { type: 'next' } | { type: 'prev' };

/** `at` is when the choice was made; the trash bin counts its days from it. */
export type Decision = { photo: Photo; action: Choice; at: number };

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_CHOICES = [3, 7, 14, 30];
export const DEFAULT_RETENTION_DAYS = 7;

/** Albums are added by the user, four along the top then four along the bottom. */
export const MAX_ALBUMS = 8;
export const ROW_SIZE = 4;

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

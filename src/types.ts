export type Photo = {
  id: string;
  uri: string;
  favorite: boolean;
};

export type Access = 'all' | 'limited' | 'none';

export type Action =
  | { type: 'trash' }
  | { type: 'album'; slot: number }
  | { type: 'keep' };

/** `at` is when the choice was made; the trash bin counts its days from it. */
export type Decision = { photo: Photo; action: Action; at: number };

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_CHOICES = [3, 7, 14, 30];
export const DEFAULT_RETENTION_DAYS = 7;

export const SLOT_COUNT = 8;

export const DEFAULT_SLOTS = [
  'Family',
  'Friends',
  'Travel',
  'Keepers',
  'Kids',
  'Pets',
  'Food',
  'Funny',
];

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

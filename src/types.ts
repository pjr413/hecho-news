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

export type Decision = { photo: Photo; action: Action };

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

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

/** `at` is when the choice was made; the trash bin counts its days from it. */
export type Decision = { photo: Photo; action: Choice; at: number };

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_CHOICES = [3, 7, 14, 30];
export const DEFAULT_RETENTION_DAYS = 7;

/** Albums are added by the user, four along the top then four along the bottom. */
export const MAX_ALBUMS = 8;

/** Screen layouts she can switch between in Options. */
export type Design = 1 | 2;
export const DESIGNS: { id: Design; name: string; blurb: string }[] = [
  { id: 1, name: 'Version 1', blurb: 'Albums along the top, then along the bottom' },
  { id: 2, name: 'Version 2', blurb: 'All albums in two rows across the bottom' },
];
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

// Browser preview: there is no photo library on the web, so this serves
// generated sample pictures and keeps every change in memory.
import { findBursts, type Access, type AlbumRef, type DeviceAlbum, type Filter, type Photo } from './types';

export const isDemo = true;
export const advancedQueries = true;

const HUES = [12, 38, 160, 200, 262, 320, 95, 345];

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** Sample photos: every 7th is a video, every 5th a screenshot, and some come in quick pairs. */
function sample(i: number, time?: number): Photo {
  const h = HUES[i % HUES.length];
  const portrait = i % 3 !== 0;
  const w = portrait ? 600 : 900;
  const ht = portrait ? 800 : 600;
  const video = i % 7 === 6;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h},70%,62%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},65%,34%)"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${w * 0.72}" cy="${ht * 0.26}" r="${w * 0.11}" fill="rgba(255,255,255,.55)"/>` +
    `<path d="M0 ${ht * 0.78} L${w * 0.3} ${ht * 0.5} L${w * 0.55} ${ht * 0.72} L${w * 0.75} ${ht * 0.56} L${w} ${ht * 0.8} V${ht} H0Z" fill="rgba(0,0,0,.28)"/>` +
    `<text x="50%" y="${ht * 0.93}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.06}" fill="rgba(255,255,255,.9)">Sample photo ${i + 1}</text>` +
    `</svg>`;
  return {
    id: `demo-${i}`,
    uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    favorite: false,
    video,
    duration: video ? 14 + i : undefined,
    time: time ?? NOW - i * 5 * DAY,
    w,
    h: ht,
  };
}

/** Screenshots in the demo: every 5th photo that isn't a video. */
const isScreenshot = (p: Photo) => !p.video && Number(p.id.slice(5)) % 5 === 0;

// Photos 11, 21, 31... are taken 1.5 s after the one before and are the same size: bursts.
const make = (i: number): Photo => {
  if (i % 10 === 1 && i > 1) {
    const before = sample(i - 1);
    return { ...sample(i), w: before.w, h: before.h, time: before.time! - 1500 };
  }
  return sample(i);
};

let photos: Photo[] = Array.from({ length: 130 }, (_, i) => make(i));

const matches = (p: Photo, filter: Filter, before?: number) =>
  (before === undefined || (p.time ?? 0) <= before) &&
  (filter === 'all' ||
    (filter === 'photos' && !p.video) ||
    (filter === 'videos' && !!p.video) ||
    (filter === 'screenshots' && isScreenshot(p)));

export async function checkAccess(): Promise<{ access: Access; canAsk: boolean }> {
  return { access: 'none', canAsk: true };
}

export async function requestAccess(): Promise<{ access: Access; canAsk: boolean }> {
  return { access: 'all', canAsk: true };
}

export async function chooseMorePhotos(): Promise<void> {}

export async function fetchPage(
  offset: number,
  limit: number,
  opts: { filter?: Filter; before?: number } = {},
): Promise<Photo[]> {
  return photos
    .filter((p) => matches(p, opts.filter ?? 'all', opts.before))
    .slice(offset, offset + limit);
}

export async function dateRange(): Promise<{ oldest: number; newest: number } | null> {
  const times = photos.map((p) => p.time ?? 0);
  return times.length ? { oldest: Math.min(...times), newest: Math.max(...times) } : null;
}

export async function burstPhotos(opts: { before?: number } = {}): Promise<Photo[]> {
  return findBursts(photos.filter((p) => matches(p, 'photos', opts.before)));
}

export async function videoUri(_id: string): Promise<string> {
  return '';
}

export async function setFavorite(_id: string, _value: boolean): Promise<void> {}

let sampleAlbums: DeviceAlbum[] = [
  { id: 'demo-a1', title: 'Family', count: 412 },
  { id: 'demo-a2', title: 'Vacation 2024', count: 268 },
  { id: 'demo-a3', title: 'Pets', count: 190 },
  { id: 'demo-a4', title: 'Recipes', count: 87 },
  { id: 'demo-a5', title: 'Kids', count: 64 },
  { id: 'demo-a6', title: 'Garden', count: 31 },
];
/** Photos filed into albums during this preview, by album id (newest first). */
const filed: Record<string, Photo[]> = {};

export async function listAlbums(): Promise<DeviceAlbum[]> {
  return sampleAlbums.map((a) => ({ ...a, count: (a.count ?? 0) + (filed[a.id]?.length ?? 0) }));
}

export async function fileIntoAlbum(album: AlbumRef, ids: string[]): Promise<string> {
  const id = album.id ?? `demo-${album.name.toLowerCase()}`;
  if (!sampleAlbums.some((a) => a.id === id)) sampleAlbums = [...sampleAlbums, { id, title: album.name, count: 0 }];
  const moved = photos.filter((p) => ids.includes(p.id));
  filed[id] = [...moved, ...(filed[id] ?? [])];
  return id;
}

export async function albumContents(id: string): Promise<{ count: number; photos: Photo[] }> {
  const base = sampleAlbums.find((a) => a.id === id);
  if (!base) throw new Error('No such album');
  const mine = filed[id] ?? [];
  // Pad with sample pictures so a big album looks like one.
  const pad = Array.from({ length: Math.min(12, base.count ?? 0) }, (_, i) => sample(100 + i));
  return { count: (base.count ?? 0) + mine.length, photos: [...mine, ...pad] };
}

export async function removeFromAlbum(albumId: string, photoId: string): Promise<void> {
  filed[albumId] = (filed[albumId] ?? []).filter((p) => p.id !== photoId);
}

export async function deleteAlbum(albumId: string): Promise<void> {
  sampleAlbums = sampleAlbums.filter((a) => a.id !== albumId);
  delete filed[albumId];
}

export async function deletePhotos(ids: string[]): Promise<void> {
  photos = photos.filter((p) => !ids.includes(p.id));
}

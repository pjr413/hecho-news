// Browser preview: there is no photo library on the web, so this serves
// generated sample pictures and keeps every change in memory.
import type { Access, AlbumRef, DeviceAlbum, Photo } from './types';

export const isDemo = true;

const HUES = [12, 38, 160, 200, 262, 320, 95, 345];

function sample(i: number): Photo {
  const h = HUES[i % HUES.length];
  const portrait = i % 3 !== 0;
  const w = portrait ? 600 : 900;
  const ht = portrait ? 800 : 600;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h},70%,62%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},65%,34%)"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${w * 0.72}" cy="${ht * 0.26}" r="${w * 0.11}" fill="rgba(255,255,255,.55)"/>` +
    `<path d="M0 ${ht * 0.78} L${w * 0.3} ${ht * 0.5} L${w * 0.55} ${ht * 0.72} L${w * 0.75} ${ht * 0.56} L${w} ${ht * 0.8} V${ht} H0Z" fill="rgba(0,0,0,.28)"/>` +
    `<text x="50%" y="${ht * 0.93}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.06}" fill="rgba(255,255,255,.9)">Sample photo ${i + 1}</text>` +
    `</svg>`;
  return { id: `demo-${i}`, uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, favorite: false };
}

let photos: Photo[] = Array.from({ length: 24 }, (_, i) => sample(i));

export async function checkAccess(): Promise<{ access: Access; canAsk: boolean }> {
  return { access: 'none', canAsk: true };
}

export async function requestAccess(): Promise<{ access: Access; canAsk: boolean }> {
  return { access: 'all', canAsk: true };
}

export async function chooseMorePhotos(): Promise<void> {}

export async function fetchPage(offset: number, limit: number): Promise<Photo[]> {
  return photos.slice(offset, offset + limit);
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

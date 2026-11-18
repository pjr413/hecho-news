// Real photo library access (iOS / Android). The web build uses library.web.ts.
import { Platform } from 'react-native';
import {
  Album,
  AlbumType,
  Asset,
  AssetField,
  MediaSubtype,
  MediaType,
  Query,
  getPermissionsAsync,
  presentPermissionsPicker,
  requestPermissionsAsync,
  type PermissionResponse,
} from 'expo-media-library';

import {
  findBursts,
  findDuplicates,
  type Access,
  type AlbumRef,
  type DeviceAlbum,
  type Filter,
  type Photo,
  type View,
} from './types';

export const isDemo = false;

/**
 * Filters (videos, bursts), jumping to a date and throwbacks rely on photo-library
 * queries that haven't been proven on a real iPhone yet. While this is false the app only runs the
 * one query it has always used, so nothing new can reach the library.
 */
export const advancedQueries = true;

export const screenshotFilter = true;

/**
 * Views that aren't offered yet. Each one needs a kind of query that hasn't been tried on a real
 * iPhone, so they are switched on one at a time, in separate updates.
 */
export const hiddenViews: View[] = ['live', 'panoramas', 'big'];

function toAccess(res: PermissionResponse): Access {
  if (!res.granted) return 'none';
  return res.accessPrivileges === 'limited' ? 'limited' : 'all';
}

export async function checkAccess(): Promise<{ access: Access; canAsk: boolean }> {
  const res = await getPermissionsAsync(false, ['photo']);
  return { access: toAccess(res), canAsk: res.canAskAgain };
}

export async function requestAccess(): Promise<{ access: Access; canAsk: boolean }> {
  const res = await requestPermissionsAsync(false, ['photo']);
  return { access: toAccess(res), canAsk: res.canAskAgain };
}

export async function chooseMorePhotos(): Promise<void> {
  await presentPermissionsPicker(['photo']);
}

/** The library hands back times in seconds or milliseconds depending on the phone; we use ms. */
function toMs(t: number | null | undefined): number | undefined {
  if (t === null || t === undefined) return undefined;
  return t > 1e11 ? t : t * 1000;
}
let queryUnit: 1 | 1000 | undefined;
async function fromMs(ms: number): Promise<number> {
  if (queryUnit === undefined) {
    const [newest] = await new Query()
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .limit(1)
      .exeForMetadata();
    queryUnit = newest && newest.creationTime !== null && newest.creationTime > 1e11 ? 1 : 1000;
  }
  return ms / queryUnit;
}

type Row = Awaited<ReturnType<Query['exeForMetadata']>>[number];
const toPhoto = (r: Row): Photo => ({
  id: r.id,
  uri: r.id,
  favorite: r.isFavorite,
  video: r.mediaType === MediaType.VIDEO,
  duration: r.duration ?? undefined,
  time: toMs(r.creationTime),
  w: r.width ?? undefined,
  h: r.height ?? undefined,
});

/** Limits and order for the timeline: only things at or before / after a time, oldest or newest first. */
export type Range = { before?: number; after?: number; oldestFirst?: boolean };

/** Builds the query for a kind of media (and, optionally, only things at or before a time). */
async function buildQuery(filter: Filter, range: Range = {}): Promise<Query | null> {
  const { before, after, oldestFirst } = range;
  if (!advancedQueries) {
    return new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
      .orderBy({ key: AssetField.CREATION_TIME, ascending: !!oldestFirst });
  }
  let q = new Query();
  if (filter === 'photos') q = q.eq(AssetField.MEDIA_TYPE, MediaType.IMAGE);
  else if (filter === 'videos') q = q.eq(AssetField.MEDIA_TYPE, MediaType.VIDEO);
  else if (filter === 'live' || filter === 'panoramas') {
    if (Platform.OS !== 'ios' || hiddenViews.includes(filter)) return null;
    q = q
      .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
      .contains(AssetField.MEDIA_SUBTYPES, filter === 'live' ? MediaSubtype.LIVE_PHOTO : MediaSubtype.PANORAMA);
  } else if (filter === 'big') {
    // The biggest files are nearly always long videos: longest first.
    if (hiddenViews.includes('big')) return null;
    q = q.eq(AssetField.MEDIA_TYPE, MediaType.VIDEO);
    if (before !== undefined) q = q.lte(AssetField.CREATION_TIME, await fromMs(before));
    if (after !== undefined) q = q.gte(AssetField.CREATION_TIME, await fromMs(after));
    return q.orderBy({ key: AssetField.DURATION, ascending: false });
  } else if (filter === 'screenshots') {
    if (!screenshotFilter) return null;
    q = q.eq(AssetField.MEDIA_TYPE, MediaType.IMAGE);
    if (Platform.OS === 'ios') {
      q = q.contains(AssetField.MEDIA_SUBTYPES, MediaSubtype.SCREENSHOT);
    } else {
      // Android keeps screenshots in their own album.
      const album = (await Album.get('Screenshots')) ?? (await Album.get('Screenshot'));
      if (!album) return null;
      q = q.album(album);
    }
  } else q = q.within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO]);
  if (before !== undefined) q = q.lte(AssetField.CREATION_TIME, await fromMs(before));
  if (after !== undefined) q = q.gte(AssetField.CREATION_TIME, await fromMs(after));
  return q.orderBy({ key: AssetField.CREATION_TIME, ascending: !!oldestFirst });
}

/** Newest first. Asset ids double as image URIs (ph:// on iOS, content:// on Android). */
export async function fetchPage(
  offset: number,
  limit: number,
  opts: Range & { filter?: Filter } = {},
): Promise<Photo[]> {
  const q = await buildQuery(opts.filter ?? 'all', opts);
  if (!q) return [];
  return (await q.limit(limit).offset(offset).exeForMetadata()).map(toPhoto);
}

/** The oldest and newest times in the library (ms), or null when it's empty. */
export async function dateRange(): Promise<{ oldest: number; newest: number } | null> {
  if (!advancedQueries) return null;
  const base = () => new Query().within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO]);
  const [newest] = await base()
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(1)
    .exeForMetadata();
  const [oldest] = await base()
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .limit(1)
    .exeForMetadata();
  const hi = toMs(newest?.creationTime);
  const lo = toMs(oldest?.creationTime);
  return hi !== undefined && lo !== undefined ? { oldest: lo, newest: hi } : null;
}

/** Photos that look like repeats: shots taken seconds apart at the same size. */
async function wholeLibrary(opts: Range): Promise<Photo[]> {
  if (!advancedQueries) return [];
  const q = await buildQuery('photos', opts);
  if (!q) return [];
  const rows = await q.limit(4000).exeForMetadata();
  return rows.map(toPhoto);
}

/** Near-identical shots taken seconds apart. */
export async function burstPhotos(opts: Range = {}): Promise<Photo[]> {
  return findBursts(await wholeLibrary(opts));
}

/** The very same shot saved more than once. */
export async function duplicatePhotos(opts: Range = {}): Promise<Photo[]> {
  return findDuplicates(await wholeLibrary(opts));
}

/** A file the video player can open. */
export async function videoUri(id: string): Promise<string> {
  return new Asset(id).getUri();
}

export async function setFavorite(id: string, value: boolean): Promise<void> {
  await new Asset(id).setFavorite(value);
}

/**
 * The albums already on the phone, biggest first. Smart albums (Recents, Favorites and so on)
 * can't be added to, so they're left out.
 */
export async function listAlbums(): Promise<DeviceAlbum[]> {
  const all = await Album.getAlbumsMetadata();
  const real = all.filter((a) => a.type !== AlbumType.SMART_ALBUM && a.title);
  const withCounts = await Promise.all(
    real.map(async (a, i) => {
      // Counting is one call per album, so only do it for the first few dozen.
      let count: number | undefined;
      if (i < 60) count = await new Album(a.id).getAssetCount().catch(() => undefined);
      return { id: a.id, title: a.title, count };
    }),
  );
  return withCounts.sort(
    (x, y) => (y.count ?? -1) - (x.count ?? -1) || x.title.localeCompare(y.title),
  );
}

/**
 * Adds photos to an album, finding it by id, then by name, and creating it if it doesn't exist
 * yet. Returns the album's id so it can be remembered.
 */
export async function fileIntoAlbum(album: AlbumRef, ids: string[]): Promise<string> {
  const assets = ids.map((id) => new Asset(id));
  if (album.id) {
    try {
      await new Album(album.id).add(assets);
      return album.id;
    } catch {
      // The album may have been deleted or renamed on the phone; fall back to its name.
    }
  }
  const found = await Album.get(album.name);
  if (found) {
    await found.add(assets);
    return found.id;
  }
  const created = await Album.create(album.name, assets, true);
  return created.id;
}

/** What's in an album: how many photos, and the newest of them to show. */
export async function albumContents(
  id: string,
  limit = 90,
): Promise<{ count: number; photos: Photo[] }> {
  const album = new Album(id);
  const count = await album.getAssetCount();
  const rows = await new Query()
    .album(album)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(limit)
    .exeForMetadata();
  return { count, photos: rows.map((r) => ({ id: r.id, uri: r.id, favorite: r.isFavorite })) };
}

/** Takes a photo back out of an album without deleting it. iPhone only: Android can't. */
export async function removeFromAlbum(albumId: string, photoId: string): Promise<void> {
  if (Platform.OS !== 'ios') throw new Error('Android can’t take a photo out of an album');
  await new Album(albumId).removeAssets([new Asset(photoId)]);
}

/**
 * Deletes the album itself. On iPhone the photos in it stay in the library; on Android the
 * photos in an album are deleted with it (the system doesn't allow otherwise).
 */
export async function deleteAlbum(albumId: string): Promise<void> {
  await Album.delete([new Album(albumId)], false);
}

/** One system confirmation for the whole batch. On iOS they land in Recently Deleted. */
export async function deletePhotos(ids: string[]): Promise<void> {
  await Asset.delete(ids.map((id) => new Asset(id)));
}

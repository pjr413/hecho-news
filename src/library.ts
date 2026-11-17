// Real photo library access (iOS / Android). The web build uses library.web.ts.
import {
  Album,
  AlbumType,
  Asset,
  AssetField,
  MediaType,
  Query,
  getPermissionsAsync,
  presentPermissionsPicker,
  requestPermissionsAsync,
  type PermissionResponse,
} from 'expo-media-library';

import type { Access, AlbumRef, DeviceAlbum, Photo } from './types';

export const isDemo = false;

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

/** Newest photos first. Asset ids double as image URIs (ph:// on iOS, content:// on Android). */
export async function fetchPage(offset: number, limit: number): Promise<Photo[]> {
  const rows = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(limit)
    .offset(offset)
    .exeForMetadata();
  return rows.map((r) => ({ id: r.id, uri: r.id, favorite: r.isFavorite }));
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

/** One system confirmation for the whole batch. On iOS they land in Recently Deleted. */
export async function deletePhotos(ids: string[]): Promise<void> {
  await Asset.delete(ids.map((id) => new Asset(id)));
}

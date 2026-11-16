// Real photo library access (iOS / Android). The web build uses library.web.ts.
import {
  Album,
  Asset,
  AssetField,
  MediaType,
  Query,
  getPermissionsAsync,
  presentPermissionsPicker,
  requestPermissionsAsync,
  type PermissionResponse,
} from 'expo-media-library';

import type { Access, Photo } from './types';

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

/** Adds photos to the album with this name, creating it if it doesn't exist yet. */
export async function fileIntoAlbum(name: string, ids: string[]): Promise<void> {
  const assets = ids.map((id) => new Asset(id));
  const album = await Album.get(name);
  if (album) await album.add(assets);
  else await Album.create(name, assets, true);
}

/** One system confirmation for the whole batch. On iOS they land in Recently Deleted. */
export async function deletePhotos(ids: string[]): Promise<void> {
  await Asset.delete(ids.map((id) => new Asset(id)));
}

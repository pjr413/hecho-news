import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_RETENTION_DAYS,
  MAX_ALBUMS,
  MAX_ROWS,
  rowsNeeded,
  type Design,
  type AlbumRef,
  type Choice,
  type Decision,
  type Photo,
} from './types';

const KEY = 'photo-sorter/v1';
/**
 * Bumped when the album spots were reset to start empty. Data saved before that still holds the
 * old ready-made albums, which are cleared once (see the load below).
 */
const SLOTS_VERSION = 2;

type Saved = {
  /** Always MAX_ALBUMS long; null is an empty spot. */
  slots: (AlbumRef | null)[];
  /**
   * Choices not yet written to the photo library, oldest first. Also the undo history.
   * The trash ones are the trash bin: they wait here until their days run out.
   */
  pending: Decision[];
  /** Photos already dealt with, so they don't come back next time. */
  reviewed: string[];
  /** How long a photo stays in the trash bin before it's really deleted. */
  retentionDays: number;
  /** Which screen layout she picked in Options. */
  design: Design;
  slotsVersion: number;
  /** How many rows of album spots are showing (1 to MAX_ROWS). */
  albumRows: number;
};

/** Older versions saved plain names in order; spots are now fixed places that can be empty. */
function normalizeSlots(raw: unknown): (AlbumRef | null)[] {
  const out: (AlbumRef | null)[] = Array.from({ length: MAX_ALBUMS }, () => null);
  if (Array.isArray(raw)) {
    raw.slice(0, MAX_ALBUMS).forEach((v, i) => {
      if (typeof v === 'string' && v) out[i] = { name: v };
      else if (v && typeof v === 'object' && typeof (v as AlbumRef).name === 'string') {
        out[i] = { name: (v as AlbumRef).name, id: (v as AlbumRef).id };
      }
    });
  }
  return out;
}

const EMPTY: Saved = {
  slots: normalizeSlots(null),
  pending: [],
  reviewed: [],
  retentionDays: DEFAULT_RETENTION_DAYS,
  design: 1,
  slotsVersion: SLOTS_VERSION,
  albumRows: 1,
};

export function useStore() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<Saved>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<Saved>;
          const now = Date.now();
          const pending = (saved.pending ?? []).map((d) => ({ ...d, at: d.at ?? now }));
          // Older versions saved a "keep" choice; it needs no library work, so just settle it.
          const kept = pending.filter((d) => (d.action.type as string) === 'keep').map((d) => d.photo.id);
          const waiting = pending.filter((d) => (d.action.type as string) !== 'keep');
          let slots = normalizeSlots(saved.slots);
          // Data from before the spots started empty: clear the old ready-made albums.
          if (saved.slotsVersion !== SLOTS_VERSION) slots = slots.map(() => null);
          // Photos are filed into albums as soon as they're dropped. Ones that were filed in
          // an earlier session are simply done; any that never got filed (from the old Save
          // flow) go back to the photos to sort, so nothing is filed that wasn't confirmed.
          const filedBefore = waiting
            .filter((d) => d.action.type === 'album' && d.filed)
            .map((d) => d.photo.id);
          setState({
            slots,
            slotsVersion: SLOTS_VERSION,
            // Never fewer rows than it takes to show the albums she already has.
            albumRows: Math.min(
              MAX_ROWS,
              Math.max(rowsNeeded(slots), Math.floor(Number(saved.albumRows)) || 1),
            ),
            pending: waiting.filter((d) => d.action.type === 'trash'),
            reviewed: [...(saved.reviewed ?? []), ...kept, ...filedBefore],
            retentionDays: saved.retentionDays ?? DEFAULT_RETENTION_DAYS,
            design: saved.design === 2 ? 2 : 1,
          });
        }
      } catch {
        // Corrupt or unreadable storage: start fresh rather than block the app.
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [ready, state]);

  const push = useCallback((photo: Photo, action: Choice) => {
    const d: Decision = { photo, action, at: Date.now() };
    setState((s) => ({ ...s, pending: [...s.pending, d] }));
  }, []);

  /** Removes one pending decision (the latest when no id is given) and returns it. */
  const takeBack = useCallback((photoId?: string): Decision | undefined => {
    const { pending } = stateRef.current;
    const d = photoId ? pending.find((p) => p.photo.id === photoId) : pending[pending.length - 1];
    if (!d) return undefined;
    setState((s) => ({ ...s, pending: s.pending.filter((p) => p !== d) }));
    return d;
  }, []);

  /** Marks pending decisions as done. Deleted photos don't need remembering. */
  const settle = useCallback((photoIds: string[], remember: boolean) => {
    const ids = new Set(photoIds);
    setState((s) => ({
      ...s,
      pending: s.pending.filter((p) => !ids.has(p.photo.id)),
      reviewed: remember ? [...s.reviewed, ...photoIds] : s.reviewed,
    }));
  }, []);

  /** Photos she has moved past, so she picks up where she left off next time. */
  const markSeen = useCallback((photoId: string) => {
    setState((s) => (s.reviewed.includes(photoId) ? s : { ...s, reviewed: [...s.reviewed, photoId] }));
  }, []);

  /** Puts an album in a spot, or empties it with null. */
  const setSlot = useCallback((slot: number, album: AlbumRef | null) => {
    setState((s) => ({ ...s, slots: s.slots.map((a, i) => (i === slot ? album : a)) }));
  }, []);

  /** Remembers the phone's id for an album once it exists, so later saves find it exactly. */
  const setSlotId = useCallback((slot: number, id: string) => {
    setState((s) => ({
      ...s,
      slots: s.slots.map((a, i) => (i === slot && a ? { ...a, id } : a)),
    }));
  }, []);

  /** Records that a dropped photo has been filed, and into which album. */
  const markFiled = useCallback((photoId: string, album: AlbumRef) => {
    setState((s) => ({
      ...s,
      pending: s.pending.map((d) => (d.photo.id === photoId ? { ...d, filed: true, album } : d)),
    }));
  }, []);

  const setAlbumRows = useCallback((rows: number) => {
    setState((s) => ({
      ...s,
      albumRows: Math.min(MAX_ROWS, Math.max(rowsNeeded(s.slots), Math.round(rows))),
    }));
  }, []);

  const setDesign = useCallback((design: Design) => {
    setState((s) => ({ ...s, design }));
  }, []);

  const setRetentionDays = useCallback((retentionDays: number) => {
    setState((s) => ({ ...s, retentionDays }));
  }, []);

  return { ready, ...state, stateRef, push, takeBack, settle, markSeen, setSlot, setSlotId, setRetentionDays, setDesign, setAlbumRows, markFiled };
}

export type Store = ReturnType<typeof useStore>;

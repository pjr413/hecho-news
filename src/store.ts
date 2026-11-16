import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_SLOTS,
  SLOT_COUNT,
  type Action,
  type Decision,
  type Photo,
} from './types';

const KEY = 'photo-sorter/v1';

type Saved = {
  slots: string[];
  /**
   * Choices not yet written to the photo library, oldest first. Also the undo history.
   * The trash ones are the trash bin: they wait here until their days run out.
   */
  pending: Decision[];
  /** Photos already dealt with, so they don't come back next time. */
  reviewed: string[];
  /** How long a photo stays in the trash bin before it's really deleted. */
  retentionDays: number;
};

const EMPTY: Saved = {
  slots: DEFAULT_SLOTS,
  pending: [],
  reviewed: [],
  retentionDays: DEFAULT_RETENTION_DAYS,
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
          // "Keep" needs no work on the library, so settle those from the last session.
          const kept = pending.filter((d) => d.action.type === 'keep').map((d) => d.photo.id);
          setState({
            slots:
              saved.slots?.length === SLOT_COUNT ? saved.slots : DEFAULT_SLOTS,
            pending: pending.filter((d) => d.action.type !== 'keep'),
            reviewed: [...(saved.reviewed ?? []), ...kept],
            retentionDays: saved.retentionDays ?? DEFAULT_RETENTION_DAYS,
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

  const push = useCallback((photo: Photo, action: Action) => {
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

  const renameSlot = useCallback((slot: number, name: string) => {
    setState((s) => ({ ...s, slots: s.slots.map((n, i) => (i === slot ? name : n)) }));
  }, []);

  const setRetentionDays = useCallback((retentionDays: number) => {
    setState((s) => ({ ...s, retentionDays }));
  }, []);

  return { ready, ...state, stateRef, push, takeBack, settle, renameSlot, setRetentionDays };
}

export type Store = ReturnType<typeof useStore>;

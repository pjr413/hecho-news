import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_SLOTS, SLOT_COUNT, type Decision } from './types';

const KEY = 'photo-sorter/v1';

type Saved = {
  slots: string[];
  /** Choices made but not yet written to the photo library. Also the undo history. */
  pending: Decision[];
  /** Photos already dealt with, so they don't come back next time. */
  reviewed: string[];
};

const EMPTY: Saved = { slots: DEFAULT_SLOTS, pending: [], reviewed: [] };

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
          const pending = saved.pending ?? [];
          // "Keep" needs no work on the library, so settle those from the last session.
          const kept = pending.filter((d) => d.action.type === 'keep').map((d) => d.photo.id);
          setState({
            slots:
              saved.slots?.length === SLOT_COUNT ? saved.slots : DEFAULT_SLOTS,
            pending: pending.filter((d) => d.action.type !== 'keep'),
            reviewed: [...(saved.reviewed ?? []), ...kept],
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

  const push = useCallback((d: Decision) => {
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

  return { ready, ...state, stateRef, push, takeBack, settle, renameSlot };
}

export type Store = ReturnType<typeof useStore>;

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import * as library from './library';
import { PhotoCard, type Geometry, type PhotoCardHandle, type Role } from './PhotoCard';
import { buildInfo } from './buildInfo';
import { BinPeek, Confetti, StatsSheet, emojiFor, isNight, type BurstKind } from './fun';
import { onShake } from './shake';
import { Tour } from './Tour';
import { canPlayVideo } from './VideoPlayer';
import { ChessTimer } from './ChessTimer';
import { CompareSheet } from './Compare';
import { ReorderScreen } from './Reorder';
import { GamesTable, MemoryGame } from './Games';
import { AlbumPicker, AlbumView, BinSheet, JumpSheet, OptionsSheet, RenameSheet } from './Sheets';
import type { Store } from './store';
import {
  DAY_MS,
  groupAround,
  MAX_ROWS,
  ROW_SIZE,
  rowsNeeded,
  slotColor,
  type Access,
  type Action,
  type AlbumRef,
  type DeviceAlbum,
  type Filter,
  type Photo,
  type View as MediaView,
} from './types';

const PAGE = 200;
const VIEW_NAMES: Record<MediaView, string> = {
  all: 'Everything',
  photos: 'Photos',
  videos: 'Videos',
  screenshots: 'Screenshots',
  live: 'Live Photos',
  panoramas: 'Panoramas',
  big: 'Big files',
  bursts: 'Bursts',
  duplicates: 'Duplicates',
};
const LOW_WATER = 8;
/** Space between the two album rows in Version 2 (matches `rowBelow` below). */
const ROW_GAP = 6;
/** How long an album is held before it opens. */
const HOLD_MS = 1000;
/** A press shorter than this is a tap (files the photo); anything longer is a hold. */
const TAP_MS = 600;
/** Don't re-ask to clear expired photos more often than this (e.g. after she says no). */
const AUTO_EMPTY_COOLDOWN = 6 * 60 * 60 * 1000;

function buzz(kind: 'tick' | 'thud') {
  const run =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  run.catch(() => {});
}

export function Sorter({ store, access }: { store: Store; access: Access }) {
  const insets = useSafeAreaInsets();
  // Every photo loaded so far in timeline order (newest first), and which one is showing.
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState('');
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const [burst, setBurst] = useState<{ kind: BurstKind; n: number }>({ kind: 'confetti', n: 0 });
  const [statsOpen, setStatsOpen] = useState(false);
  const [binPeek, setBinPeek] = useState(false);
  const [night, setNight] = useState(isNight());
  /** What the timeline shows (everything, videos, bursts...) and an optional date it was jumped to. */
  const [view, setView] = useState<MediaView>('all');
  const [jump, setJump] = useState<{ before: number; label: string } | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  /** Photos shown side by side in "Keep which?". */
  const [comparing, setComparing] = useState<Photo[]>([]);
  const [reorderOpen, setReorderOpen] = useState(false);
  /** The album spot being filled from the picker, or null. */
  const [picking, setPicking] = useState<number | null>(null);
  /** The spot getting a brand-new album (asking for its name), or null. */
  const [naming, setNaming] = useState<number | null>(null);
  /** The filled spot whose album is open for looking inside, or null. */
  const [viewSlot, setViewSlot] = useState<number | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [binBusy, setBinBusy] = useState(false);
  const [binError, setBinError] = useState<string | null>(null);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  const indexRef = useRef(index);
  indexRef.current = index;
  const { push, takeBack, settle, markSeen, markFiled, setSlot, setSlotId, noteRecent, addStat, noteStreak, stateRef } =
    store;
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const viewRef = useRef<MediaView>('all');
  const jumpRef = useRef<{ before: number; label: string } | null>(null);
  const oldestRef = useRef(false);
  /** Bumped whenever the view changes, so a load that was already under way is thrown away. */
  const viewToken = useRef(0);
  const topCard = useRef<PhotoCardHandle>(null);
  const emptyingRef = useRef(false);
  const autoEmptiedAt = useRef(0);

  const hoverSlot = useSharedValue(-1);
  const geometry = useSharedValue<Geometry>({
    width: 1,
    height: 1,
    filled: 0,
    rowMin: Array.from({ length: MAX_ROWS }, () => 100000),
    rowMax: Array.from({ length: MAX_ROWS }, () => 100000),
    rowCenter: Array.from({ length: MAX_ROWS }, () => 0),
    cardCenterY: 0,
  });

  useAnimatedReaction(
    () => hoverSlot.value,
    (now, before) => {
      if (now >= 0 && now !== before) scheduleOnRN(buzz, 'tick');
    },
  );

  const slots = store.slots;
  const filledMask = slots.reduce((m, a, i) => (a ? m | (1 << i) : m), 0);
  const rows = store.albumRows;
  const design = store.design;
  // Version 1 puts the first rows along the top and the rest along the bottom, Version 2 puts
  // them all along the bottom.
  const topRows = design === 1 ? Math.ceil(rows / 2) : 0;
  const bottomRows = rows - topRows;
  const tileH = design === 2 ? 60 : 68;
  const layoutRef = useRef({ rows, topRows, tileH });
  layoutRef.current = { rows, topRows, tileH };
  /** Where the block of rows along the top, and the block along the bottom, start. */
  const dockY = useRef<{ top?: number; bottom?: number }>({});

  /** Works out where a finger counts as "over" each album row, wherever the rows are. */
  const applyZones = useCallback(() => {
    const { rows: n, topRows: t, tileH: h } = layoutRef.current;
    const BIG = 100000;
    const ys: number[] = []; // top edge of each row
    for (let r = 0; r < n; r++) {
      const base = r < t ? dockY.current.top : dockY.current.bottom;
      ys.push(base === undefined ? NaN : base + (r < t ? r : r - t) * (h + ROW_GAP));
    }
    const rowMin: number[] = [];
    const rowMax: number[] = [];
    const rowCenter: number[] = [];
    for (let r = 0; r < MAX_ROWS; r++) {
      if (r >= n || Number.isNaN(ys[r])) {
        rowMin.push(BIG);
        rowMax.push(BIG);
        rowCenter.push(0);
        continue;
      }
      rowCenter.push(ys[r] + h / 2);
      if (r < t) {
        // Along the top: everything from the row above (or the screen's edge) down to this row.
        rowMin.push(r === 0 ? -BIG : ys[r - 1] + h);
        rowMax.push(ys[r] + h);
      } else {
        // Along the bottom: from this row's top down to the next row's top.
        rowMin.push(ys[r]);
        rowMax.push(r + 1 < n && !Number.isNaN(ys[r + 1]) ? ys[r + 1] : BIG);
      }
    }
    geometry.modify((g) => {
      'worklet';
      g.rowMin = rowMin;
      g.rowMax = rowMax;
      g.rowCenter = rowCenter;
      return g;
    });
  }, [geometry]);

  useEffect(() => {
    geometry.modify((g) => {
      'worklet';
      g.filled = filledMask;
      return g;
    });
    applyZones();
  }, [filledMask, rows, design, geometry, applyZones]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const token = viewToken.current;
    setLoading(true);
    setLoadError(null);
    try {
      const { reviewed, pending } = stateRef.current;
      const known = new Set<string>(reviewed);
      pending.forEach((d) => known.add(d.photo.id));
      photosRef.current.forEach((p) => known.add(p.id));
      // Jumping to a month: newest-first continues from its end, oldest-first from its start.
      const end = jumpRef.current?.before;
      const oldestFirst = oldestRef.current;
      const monthStart = end === undefined ? undefined : new Date(new Date(end + 1).getFullYear(), new Date(end + 1).getMonth() - 1, 1).getTime();
      const range = oldestFirst ? { after: monthStart, oldestFirst } : { before: end, oldestFirst };
      if (viewRef.current === 'bursts' || viewRef.current === 'duplicates') {
        // Repeats are found by looking at the whole library at once.
        const list = await (viewRef.current === 'bursts' ? library.burstPhotos(range) : library.duplicatePhotos(range));
        if (token !== viewToken.current) return;
        setExhausted(true);
        setPhotos((q) => [...q, ...list.filter((p) => !known.has(p.id))]);
        return;
      }
      const fresh: Photo[] = [];
      let done = false;
      while (fresh.length < 20 && !done) {
        const page = await library.fetchPage(offsetRef.current, PAGE, {
          filter: viewRef.current as Filter,
          ...range,
        });
        if (token !== viewToken.current) return;
        offsetRef.current += page.length;
        for (const p of page) if (!known.has(p.id)) fresh.push(p);
        done = page.length < PAGE;
      }
      setExhausted(done);
      setPhotos((q) => [...q, ...fresh]);
    } catch (e) {
      if (token === viewToken.current) setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === viewToken.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [stateRef]);

  useEffect(() => {
    if (photos.length - index < LOW_WATER && !exhausted && !loading && !loadError) loadMore();
  }, [photos.length, index, exhausted, loading, loadError, loadMore]);

  // First load.
  useEffect(() => {
    loadMore();
  }, [loadMore]);

  const reload = useCallback(() => {
    viewToken.current += 1;
    loadingRef.current = false;
    setLoading(false);
    offsetRef.current = 0;
    setPhotos([]);
    photosRef.current = [];
    setIndex(0);
    setExhausted(false);
    setLoadError(null);
  }, []);

  /** Change what the timeline shows, and start it again from the top. */
  const applyView = useCallback(
    (next: MediaView, nextJump: { before: number; label: string } | null) => {
      viewRef.current = next;
      jumpRef.current = nextJump;
      finale.current = false;
      setView(next);
      setJump(nextJump);
      reload();
    },
    [reload],
  );

  // The saved order is only known once the store has loaded; switch to it then.
  useEffect(() => {
    if (store.ready && store.oldestFirst !== oldestRef.current) {
      oldestRef.current = store.oldestFirst;
      applyView(viewRef.current, jumpRef.current);
    }
  }, [store.ready, store.oldestFirst, applyView]);

  const current = photos[index];
  const hasPrev = index > 0;
  const hasNext = index + 1 < photos.length;

  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A short message that floats at the top for a few seconds. */
  const showBanner = useCallback((text: string, ms = 3500) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner({ text, id: Date.now() });
    bannerTimer.current = setTimeout(() => setBanner(null), ms);
  }, []);
  const celebrate = useCallback((kind: BurstKind) => setBurst((b) => ({ kind, n: b.n + 1 })), []);

  /** Shake: land on a random moment from the past. */
  const throwback = useCallback(async () => {
    try {
      const range = await library.dateRange();
      if (!range) return;
      const d = new Date(range.oldest + Math.random() * (range.newest - range.oldest));
      const name = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      applyView(viewRef.current, {
        before: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1,
        label: `Throwback ${name}`,
      });
      showBanner(`Throwback to ${name}`, 4500);
      buzz('thud');
    } catch {
      // No library to look at: nothing to throw back to.
    }
  }, [applyView, showBanner]);
  useEffect(() => onShake(throwback), [throwback]);

  // The first time the app is opened, a short tour.
  useEffect(() => {
    if (store.ready && !store.tourSeen) {
      const id = setTimeout(() => setTourOpen(true), 600);
      return () => clearTimeout(id);
    }
  }, [store.ready, store.tourSeen]);


  /** Counts a photo dealt with, keeps the streak, and says something every hundred in a row. */
  const streak = useRef({ count: 0, at: 0 });
  const noteProgress = useCallback(
    (kind: 'trashed' | 'filed' | 'passed') => {
      const now = Date.now();
      const st = streak.current;
      st.count = now - st.at > 20000 ? 1 : st.count + 1;
      st.at = now;
      addStat('sorted');
      if (kind !== 'passed') addStat(kind);
      noteStreak(st.count);
      if (st.count % 100 === 0) showBanner('Does it spark joy?', 4500);
    },
    [addStat, noteStreak, showBanner],
  );

  const putBack = useCallback(
    (photoId?: string) => {
      const d = takeBack(photoId);
      if (!d) return;
      setPhotos((q) => {
        const rest = q.filter((p) => p.id !== d.photo.id);
        rest.splice(Math.min(indexRef.current, rest.length), 0, d.photo);
        return rest;
      });
      setStatus('Put back');
    },
    [takeBack],
  );

  /** Changes to albums happen one at a time, so quick drops can't create an album twice. */
  const fileQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((job: () => Promise<void>) => {
    fileQueue.current = fileQueue.current.then(job).catch(() => {});
  }, []);

  const decide = useCallback(
    (photo: Photo, action: Action) => {
      if (action.type === 'next') {
        markSeen(photo.id);
        noteProgress('passed');
        setIndex((i) => Math.min(i + 1, photosRef.current.length));
        return;
      }
      if (action.type === 'prev') {
        setIndex((i) => Math.max(0, i - 1));
        return;
      }
      // Decided photos leave the timeline; the next one slides into this position.
      setPhotos((q) => q.filter((p) => p.id !== photo.id));
      push(photo, action);
      buzz('thud');
      if (action.type === 'trash') {
        noteProgress('trashed');
        setStatus('Moved to trash bin');
        return;
      }
      // A photo dropped on an album is filed straight away.
      const slot = action.slot;
      const chosen = stateRef.current.slots[slot];
      if (!chosen) return;
      noteProgress('filed');
      setStatus(`Added to ${chosen.name}`);
      enqueue(async () => {
        // Use the freshest copy of the album: it may have just been given its id.
        const now = stateRef.current.slots[slot];
        const target = now && now.name === chosen.name ? now : chosen;
        try {
          const id = await library.fileIntoAlbum(target, [photo.id]);
          markFiled(photo.id, { name: chosen.name, id });
          noteRecent(chosen.name);
          if (!target.id && stateRef.current.slots[slot]?.name === chosen.name) setSlotId(slot, id);
        } catch {
          putBack(photo.id);
          setStatus(`Couldn't add it to ${chosen.name}. It's back in your photos.`);
        }
      });
    },
    [push, markSeen, markFiled, setSlotId, enqueue, putBack, noteProgress, noteRecent, stateRef],
  );

  /** "Keep which?": keep one of the compared photos and send the others to the bin. */
  const keepOnly = useCallback(
    (keep: Photo) => {
      const group = comparing;
      const ids = new Set(group.map((p) => p.id));
      const first = Math.max(0, photosRef.current.findIndex((p) => ids.has(p.id)));
      markSeen(keep.id);
      group.filter((p) => p.id !== keep.id).forEach((p) => {
        push(p, { type: 'trash' });
        noteProgress('trashed');
      });
      setPhotos((q) => q.filter((p) => !ids.has(p.id)));
      setIndex(first);
      setComparing([]);
      buzz('thud');
      setStatus(`Kept one, ${group.length - 1} moved to the bin`);
    },
    [comparing, markSeen, push, noteProgress],
  );

  /** Undo the latest choice. A photo already filed is taken back out of its album first. */
  const undo = useCallback(() => {
    const last = stateRef.current.pending[stateRef.current.pending.length - 1];
    if (!last) return;
    if (last.action.type === 'trash') {
      putBack();
      return;
    }
    enqueue(async () => {
      const d = stateRef.current.pending.find((p) => p.photo.id === last.photo.id);
      if (!d) return;
      if (d.filed && d.album?.id) {
        try {
          await library.removeFromAlbum(d.album.id, d.photo.id);
        } catch {
          setStatus("Couldn't take it back out of the album.");
          return;
        }
      }
      putBack(d.photo.id);
    });
  }, [enqueue, putBack, stateRef]);

  const goBack = useCallback(() => {
    if (topCard.current) topCard.current.send({ type: 'prev' });
    else setIndex((i) => Math.max(0, i - 1));
  }, []);

  /** Taps of the heart on one photo, for the hearts-rain surprise. */
  const heartTaps = useRef({ id: '', n: 0, at: 0 });
  const toggleFavorite = useCallback(
    (photo: Photo) => {
      const was = favorites[photo.id] ?? photo.favorite;
      setFavorites((f) => ({ ...f, [photo.id]: !was }));
      setStatus(was ? 'Removed from favorites' : 'Favorited');
      if (!was) addStat('favorited');
      const now = Date.now();
      const h = heartTaps.current;
      h.n = h.id === photo.id && now - h.at < 8000 ? h.n + 1 : 1;
      h.id = photo.id;
      h.at = now;
      if (h.n >= 5) {
        h.n = 0;
        celebrate('hearts');
        setStatus('So much love ♥');
      }
      library.setFavorite(photo.id, !was).catch(() => {
        setFavorites((f) => ({ ...f, [photo.id]: was }));
        setStatus("Couldn't change favorite");
      });
    },
    [favorites, addStat, celebrate],
  );

  /** Really deletes photos from the phone. The system asks her to confirm, once per batch. */
  const emptyBin = useCallback(
    async (ids: string[]) => {
      if (!ids.length || emptyingRef.current) return;
      emptyingRef.current = true;
      setBinBusy(true);
      setBinError(null);
      try {
        await library.deletePhotos(ids);
        settle(ids, false);
        offsetRef.current = Math.max(0, offsetRef.current - ids.length);
        setStatus(`Deleted ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}`);
      } catch {
        setBinError("Those weren't deleted. They're still in the bin.");
      } finally {
        emptyingRef.current = false;
        setBinBusy(false);
      }
    },
    [settle],
  );

  // Clear out photos whose time in the bin is up: on launch and whenever the app comes back.
  useEffect(() => {
    const check = () => {
      if (Date.now() - autoEmptiedAt.current < AUTO_EMPTY_COOLDOWN) return;
      const { pending, retentionDays } = stateRef.current;
      const cutoff = Date.now() - retentionDays * DAY_MS;
      const expired = pending
        .filter((d) => d.action.type === 'trash' && d.at <= cutoff)
        .map((d) => d.photo.id);
      if (!expired.length) return;
      autoEmptiedAt.current = Date.now();
      emptyBin(expired);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [emptyBin, stateRef]);

  const trashCount = store.pending.filter((d) => d.action.type === 'trash').length;

  const cell = (slot: number) => {
    const album = slots[slot];
    if (!album) {
      return <EmptySpot key={slot} slot={slot} height={tileH} onPress={() => setPicking(slot)} />;
    }
    return (
      <Tile
        key={slot}
        slot={slot}
        name={album.name}
        emoji={emojiFor(album.name)}
        hoverSlot={hoverSlot}
        onPress={() => topCard.current?.send({ type: 'album', slot })}
        onLongPress={() => {
          buzz('thud');
          setViewSlot(slot);
        }}
        height={tileH}
      />
    );
  };

  /** Takes an album out of its spot. Only the app forgets it: the real album is never touched. */
  const removeSlot = useCallback((slot: number) => setSlot(slot, null), [setSlot]);

  /** Adds (or, if it's already there, removes) one of the ready-made album types. */
  const toggleType = useCallback(
    async (name: string): Promise<string> => {
      const same = (a: AlbumRef | null) => !!a && a.name.toLowerCase() === name.toLowerCase();
      const at = stateRef.current.slots.findIndex(same);
      if (at >= 0) {
        removeSlot(at);
        return `Took ${name} out.`;
      }
      const emptyShowing = () =>
        stateRef.current.slots.slice(0, layoutRef.current.rows * ROW_SIZE).findIndex((a) => !a);
      const full = 'All the spots are full. Add a row in Options, or take an album out.';
      if (emptyShowing() < 0) return full;
      // If the phone already has an album with this name, use it instead of making a second one.
      let existing: DeviceAlbum | undefined;
      try {
        existing = (await library.listAlbums()).find(
          (a) => a.title.toLowerCase() === name.toLowerCase(),
        );
      } catch {
        // Not being able to look is fine: it just gets created on Save.
      }
      // The spots may have changed while looking.
      if (stateRef.current.slots.some(same)) return `${name} is already in a spot.`;
      const spot = emptyShowing();
      if (spot < 0) return full;
      setSlot(spot, existing ? { name: existing.title, id: existing.id } : { name });
      return existing
        ? `Added ${name}. It uses the album you already have.`
        : `Added ${name}. It's created when you first put a photo in it.`;
    },
    [removeSlot, setSlot, stateRef],
  );

  /** Fills the empty spots that are showing with her biggest albums that aren't placed yet. */
  const autoFill = useCallback(async (): Promise<string> => {
    let albums: DeviceAlbum[];
    try {
      albums = await library.listAlbums();
    } catch {
      return "Couldn't read the albums on this phone.";
    }
    const now = stateRef.current.slots;
    const showing = layoutRef.current.rows * ROW_SIZE;
    const empty: number[] = [];
    for (let i = 0; i < showing; i++) if (!now[i]) empty.push(i);
    if (!empty.length) return 'There are no empty spots to fill.';
    const taken = new Set<string>();
    now.forEach((a) => {
      if (a) {
        if (a.id) taken.add(a.id);
        taken.add(a.name.toLowerCase());
      }
    });
    const candidates = albums.filter(
      (a) => (a.count ?? 1) > 0 && !taken.has(a.id) && !taken.has(a.title.toLowerCase()),
    );
    const n = Math.min(empty.length, candidates.length);
    for (let i = 0; i < n; i++) setSlot(empty[i], { name: candidates[i].title, id: candidates[i].id });
    if (!n) return 'No other albums found on this phone.';
    return `Filled ${n} ${n === 1 ? 'spot' : 'spots'}.`;
  }, [setSlot, stateRef]);

  const row = (r: number, first: boolean) => (
    <View key={r} style={[styles.row, !first && styles.rowBelow]}>
      {[0, 1, 2, 3].map((i) => cell(r * ROW_SIZE + i))}
    </View>
  );
  const rowList = (from: number, count: number) =>
    Array.from({ length: count }, (_, k) => row(from + k, k === 0));

  // Between midnight and 4am the screen dims, and the first time it's opened then, it says goodnight.
  useEffect(() => {
    const tick = () => setNight(isNight());
    const id = setInterval(tick, 60000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && tick());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  const greetedNight = useRef(false);
  useEffect(() => {
    if (night && !greetedNight.current) {
      greetedNight.current = true;
      showBanner('Go to sleep. The photos will still be here.', 6500);
    }
  }, [night, showBanner]);

  // Reaching the end of the whole library: fireworks.
  const finale = useRef(false);
  useEffect(() => {
    if (
      !current &&
      exhausted &&
      photos.length > 0 &&
      !loadError &&
      !finale.current &&
      view === 'all' &&
      !jump
    ) {
      finale.current = true;
      celebrate('fireworks');
      showBanner('Inbox zero! Every photo is sorted.', 5500);
    }
  }, [current, exhausted, photos.length, loadError, view, jump, celebrate, showBanner]);

  // The chess timer takes over the whole screen; this screen keeps its place underneath.
  if (timerOpen) return <ChessTimer onExit={() => setTimerOpen(false)} />;
  if (gameOpen) return <ChessTimer game onExit={() => setGameOpen(false)} />;
  if (memoryOpen) return <MemoryGame onExit={() => setMemoryOpen(false)} />;
  if (tableOpen) return <GamesTable onExit={() => setTableOpen(false)} />;

  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 6 }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        geometry.modify((g) => {
          'worklet';
          g.width = width;
          g.height = height;
          return g;
        });
      }}
    >
      <View style={styles.header}>
        <Pressable
          style={[styles.pill, !store.pending.length && styles.dim]}
          disabled={!store.pending.length}
          onPress={undo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Text style={styles.pillText}>Undo</Text>
        </Pressable>
        {view !== 'all' || jump ? (
          <Pressable
            style={styles.viewChip}
            onPress={() => applyView('all', null)}
            accessibilityRole="button"
            accessibilityLabel="Show everything again"
            testID="clear-view"
          >
            <Text style={styles.viewChipText} numberOfLines={1}>
              ✕ {[view !== 'all' ? VIEW_NAMES[view] : null, jump?.label].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.status} numberOfLines={1}>
            {status || (library.isDemo ? 'Preview with sample photos' : '')}
          </Text>
        )}
        <Pressable
          style={styles.pill}
          onPress={() => {
            setBinError(null);
            setBinOpen(true);
          }}
          accessibilityRole="button"
          onLongPress={() => setBinPeek(true)}
          delayLongPress={600}
          accessibilityLabel={`Trash bin, ${trashCount} photos`}
          testID="bin"
        >
          <Text style={styles.pillText}>{trashCount ? `Bin ${trashCount}` : 'Bin'}</Text>
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={() => setOptionsOpen(true)}
          onLongPress={() => setMemoryOpen(true)}
          delayLongPress={5000}
          accessibilityRole="button"
          accessibilityLabel="Options"
          testID="options"
        >
          <Text style={styles.iconText}>⚙</Text>
        </Pressable>
      </View>

      {topRows > 0 && (
        <View
          onLayout={(e) => {
            dockY.current.top = e.nativeEvent.layout.y;
            applyZones();
          }}
        >
          {rowList(0, topRows)}
        </View>
      )}

      <View
        style={styles.stage}
        onLayout={(e) => {
          const { y, height } = e.nativeEvent.layout;
          geometry.modify((g) => {
            'worklet';
            g.cardCenterY = y + height / 2;
            return g;
          });
        }}
      >
        {(
          [
            { photo: photos[index - 1], role: 'prev' },
            { photo: current, role: 'current' },
            { photo: photos[index + 1], role: 'next' },
          ] as { photo: Photo | undefined; role: Role }[]
        ).flatMap(({ photo, role }) =>
          photo
            ? [
                <PhotoCard
                  key={photo.id}
                  ref={role === 'current' ? topCard : undefined}
                  photo={photo}
                  role={role}
                  favorite={favorites[photo.id] ?? photo.favorite}
                  canBack={hasPrev}
                  canForward={hasNext}
                  geometry={geometry}
                  hoverSlot={hoverSlot}
                  onDecide={(action) => decide(photo, action)}
                  onFavorite={() => toggleFavorite(photo)}
                  canPlay={canPlayVideo()}
                />,
              ]
            : [],
        )}

        {!current && (
          <View style={styles.empty}>
            {loadError ? (
              <>
                <Text style={styles.emptyTitle}>Couldn't load photos</Text>
                <Text style={styles.emptyBody}>{loadError}</Text>
                <Pressable style={[styles.pill, styles.save]} onPress={reload}>
                  <Text style={[styles.pillText, styles.saveText]}>Try again</Text>
                </Pressable>
              </>
            ) : !exhausted ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.emptyTitle}>
                  {photos.length ? 'That\u2019s the last one' : 'No photos to sort'}
                </Text>
                <Text style={styles.emptyBody}>
                  {hasPrev ? 'Tap Back to look through again.' : ''}
                </Text>
                {access === 'limited' && (
                  <Pressable
                    style={styles.pill}
                    onPress={async () => {
                      await library.chooseMorePhotos().catch(() => {});
                      reload();
                    }}
                  >
                    <Text style={styles.pillText}>Choose more photos</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.action, !hasPrev && styles.dim]}
          disabled={!hasPrev}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Previous photo"
          testID="back"
        >
          <Text style={styles.actionText}>‹ Back</Text>
        </Pressable>
        <Pressable
          style={[styles.action, !current && styles.dim]}
          disabled={!current}
          onPress={() => topCard.current?.send({ type: 'trash' })}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Trash</Text>
        </Pressable>
        <Pressable
          style={[styles.action, !hasNext && styles.dim]}
          disabled={!hasNext}
          onPress={() => setComparing(groupAround(photosRef.current, index, view))}
          accessibilityRole="button"
          accessibilityLabel="Compare with the next photo or its burst"
          testID="compare"
        >
          <Text style={styles.actionText}>⇄</Text>
        </Pressable>
        <Pressable
          style={[styles.action, !hasNext && styles.dim]}
          disabled={!hasNext}
          onPress={() => topCard.current?.send({ type: 'next' })}
          accessibilityRole="button"
          accessibilityLabel="Next photo"
          testID="next"
        >
          <Text style={styles.actionText}>Next ›</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Swipe left for next · right to go back · flick up or pinch to trash{'\n'}
        {filledMask
          ? design === 2
            ? 'Drag down to an album · '
            : 'Drag to an album · '
          : 'Tap a + to choose an album · '}
        Double-tap to favorite ♥
      </Text>

      {bottomRows > 0 && (
        <View
          // One block for all the bottom rows: it changes size when rows are added, so its
          // position is always re-read.
          onLayout={(e) => {
            dockY.current.bottom = e.nativeEvent.layout.y;
            applyZones();
          }}
        >
          {rowList(topRows, bottomRows)}
        </View>
      )}

      <AlbumPicker
        visible={picking !== null}
        used={slots.filter((a, i): a is AlbumRef => !!a && i !== picking)}
        recent={store.recent}
        onPick={(album) => {
          if (picking !== null) {
            setSlot(picking, { name: album.title, id: album.id });
            store.noteRecent(album.title);
          }
          setPicking(null);
        }}
        onNew={() => {
          setNaming(picking);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <Confetti burst={burst.n} kind={burst.kind} />
      {banner && (
        <View style={[styles.banner, { top: insets.top + 58 }]} pointerEvents="none">
          <Text style={styles.bannerText} testID="banner">
            {banner.text}
          </Text>
        </View>
      )}
      {night && <View style={styles.nightDim} pointerEvents="none" testID="night-dim" />}
      <BinPeek visible={binPeek} count={trashCount} onClose={() => setBinPeek(false)} />
      <StatsSheet visible={statsOpen} stats={store.stats} onClose={() => setStatsOpen(false)} />
      {reorderOpen && (
        <ReorderScreen
          items={slots.flatMap((a, i) =>
            a ? [{ name: a.name, color: slotColor(i), emoji: emojiFor(a.name) }] : [],
          )}
          onMove={store.reorderAlbums}
          onClose={() => setReorderOpen(false)}
        />
      )}
      <CompareSheet
        photos={comparing}
        onKeep={keepOnly}
        onKeepAll={() => setComparing([])}
        onClose={() => setComparing([])}
      />
      <JumpSheet
        visible={jumpOpen}
        onPick={(before, label) => {
          setJumpOpen(false);
          applyView(viewRef.current, { before, label });
        }}
        onClose={() => setJumpOpen(false)}
      />
      <Tour
        visible={tourOpen}
        onDone={() => {
          setTourOpen(false);
          store.setFlag('tourSeen', true);
        }}
      />
      <RenameSheet
        visible={naming !== null}
        title="New album"
        name=""
        onClose={() => setNaming(null)}
        onSave={(name) => {
          if (naming !== null) setSlot(naming, { name });
          setNaming(null);
        }}
      />
      <AlbumView
        visible={viewSlot !== null}
        album={viewSlot !== null ? (slots[viewSlot] ?? null) : null}
        onRemove={() => {
          if (viewSlot !== null) {
            setStatus(`Removed ${slots[viewSlot]?.name ?? 'the album'} from Tidy`);
            removeSlot(viewSlot);
          }
          setViewSlot(null);
        }}
        onDelete={async () => {
          if (viewSlot === null) return;
          const album = slots[viewSlot];
          if (album?.id) await library.deleteAlbum(album.id);
          setSlot(viewSlot, null);
          setStatus(`Deleted the album ${album?.name ?? ''}`.trim());
          setViewSlot(null);
        }}
        onClose={() => setViewSlot(null)}
      />
      <OptionsSheet
        visible={optionsOpen}
        design={design}
        info={buildInfo()}
        onPick={store.setDesign}
        onAutoFill={autoFill}
        chosen={slots.flatMap((a) => (a ? [a.name.toLowerCase()] : []))}
        onToggleType={toggleType}
        view={view}
        onView={(v) => {
          setOptionsOpen(false);
          applyView(v, jumpRef.current);
        }}
        oldestFirst={store.oldestFirst}
        onOrder={(oldest) => {
          setOptionsOpen(false);
          store.setFlag('oldestFirst', oldest);
        }}
        advanced={library.advancedQueries}
        hiddenViews={library.hiddenViews}
        jumpLabel={jump?.label ?? null}
        onOpenJump={() => {
          setOptionsOpen(false);
          setTimeout(() => setJumpOpen(true), 350);
        }}
        onClearJump={() => {
          setOptionsOpen(false);
          applyView(viewRef.current, null);
        }}
        canReorder={slots.filter(Boolean).length >= 2}
        onReorder={() => {
          setOptionsOpen(false);
          setTimeout(() => setReorderOpen(true), 350);
        }}
        onShowTour={() => {
          setOptionsOpen(false);
          setTimeout(() => setTourOpen(true), 350);
        }}
        gamesUnlocked={store.gamesUnlocked}
        onUnlockGames={() => {
          // Holding the Chess game button (or tapping the knight) opens the games table.
          if (!store.gamesUnlocked) {
            store.setFlag('gamesUnlocked', true);
            celebrate('confetti');
            showBanner('Games table unlocked 🎲');
          } else {
            setOptionsOpen(false);
            setTableOpen(true);
          }
        }}
        onOpenGames={() => {
          setOptionsOpen(false);
          setTableOpen(true);
        }}
        onSecret={() => {
          setOptionsOpen(false);
          setTimeout(() => setStatsOpen(true), 350);
        }}
        rows={rows}
        minRows={rowsNeeded(slots)}
        onRows={store.setAlbumRows}
        onOpenTimer={() => {
          setOptionsOpen(false);
          setTimerOpen(true);
        }}
        onOpenGame={() => {
          setOptionsOpen(false);
          setGameOpen(true);
        }}
        onClose={() => setOptionsOpen(false)}
      />
      <BinSheet
        visible={binOpen}
        store={store}
        busy={binBusy}
        error={binError}
        onRestore={(id) => putBack(id)}
        onEmpty={emptyBin}
        onClose={() => setBinOpen(false)}
      />
    </View>
  );
}

function Tile({
  slot,
  name,
  emoji,
  hoverSlot,
  onPress,
  onLongPress,
  height,
}: {
  slot: number;
  name: string;
  emoji: string | null;
  hoverSlot: SharedValue<number>;
  onPress: () => void;
  onLongPress: () => void;
  height: number;
}) {
  const color = slotColor(slot);
  const hold = useSharedValue(0);
  const pressedAt = useRef(0);
  const fill = useAnimatedStyle(() => ({ width: `${hold.value * 100}%` }));
  const style = useAnimatedStyle(() => {
    const on = hoverSlot.value === slot;
    return {
      transform: [{ scale: withTiming(on ? 1.1 : 1, { duration: 110 }) }],
      backgroundColor: on ? color : '#1B1D24',
    };
  });
  const label = useAnimatedStyle(() => ({
    color: hoverSlot.value === slot ? '#101114' : '#F2F3F5',
  }));
  // The emoji hops up and tilts when a photo is held over the album.
  const bounce = useAnimatedStyle(() => ({
    transform: [
      { scale: withTiming(hoverSlot.value === slot ? 1.5 : 1, { duration: 140 }) },
      { rotate: hoverSlot.value === slot ? '-12deg' : '0deg' },
    ],
  }));
  return (
    <Animated.View style={[styles.tile, { borderColor: color, height }, style]}>
      {/* Fills across while the album is held, so the long wait is visible. */}
      <View style={styles.holdWrap} pointerEvents="none">
        <Animated.View style={[styles.holdFill, fill]} />
      </View>
      {emoji && (
        <Animated.Text style={[styles.tileEmoji, bounce]} testID={`emoji-${slot}`}>
          {emoji}
        </Animated.Text>
      )}
      <Pressable
        style={styles.tilePress}
        // Only a quick tap files the photo, so letting go part-way through a hold does nothing.
        onPress={() => {
          if (Date.now() - pressedAt.current <= TAP_MS) onPress();
        }}
        onPressIn={() => {
          pressedAt.current = Date.now();
          hold.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear });
        }}
        onPressOut={() => {
          hold.value = withTiming(0, { duration: 150 });
        }}
        delayLongPress={HOLD_MS}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${name} album`}
        accessibilityHint="Adds this photo. Hold for one second to open the album."
        testID={`tile-${slot}`}
      >
        <Animated.Text
          style={[styles.tileName, label]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {name}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

/** An empty album spot: a dotted outline with a plus. Tap to pick or create an album for it. */
function EmptySpot({
  slot,
  height,
  onPress,
}: {
  slot: number;
  height: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.addTile, { height }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Empty album spot. Choose an album."
      testID={`slot-${slot}`}
    >
      <Text style={styles.addPlus}>＋</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0F13' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 52,
    gap: 8,
  },
  status: { flex: 1, textAlign: 'center', color: '#A9AEB8', fontSize: 14 },
  viewChip: {
    flex: 1,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
  viewChipText: { color: '#F2F3F5', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  pill: {
    minWidth: 64,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22252E',
  },
  pillText: { color: '#F2F3F5', fontSize: 15, fontWeight: '600' },
  save: { backgroundColor: '#F2F3F5' },
  saveText: { color: '#101114' },
  dim: { opacity: 0.35 },
  row: { flexDirection: 'row', paddingHorizontal: 4, zIndex: 1 },
  rowBelow: { marginTop: ROW_GAP },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22252E',
  },
  iconText: { color: '#F2F3F5', fontSize: 18 },
  addTile: {
    flex: 1,
    height: 68,
    marginHorizontal: 4,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#454B59',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: { color: '#8A90A0', fontSize: 26, fontWeight: '300' },
  tile: {
    flex: 1,
    height: 68,
    marginHorizontal: 4,
    borderRadius: 16,
    borderWidth: 2,
  },
  holdWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 14,
    overflow: 'hidden',
  },
  holdFill: { height: '100%', backgroundColor: 'rgba(229,57,53,0.45)' },
  tileEmoji: { position: 'absolute', top: 2, left: 0, right: 0, textAlign: 'center', fontSize: 14, zIndex: 2 },
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '88%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(242,243,245,0.96)',
    zIndex: 60,
  },
  bannerText: { color: '#101114', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  nightDim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,12,0.3)',
    zIndex: 40,
  },
  tilePress: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingTop: 4 },
  tileName: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  count: {
    position: 'absolute',
    top: -8,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#101114', fontSize: 12, fontWeight: '800' },
  stage: { flex: 1, marginHorizontal: 12, marginTop: 12, marginBottom: 4, zIndex: 5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyTitle: { color: '#F2F3F5', fontSize: 22, fontWeight: '700' },
  emptyBody: { color: '#A9AEB8', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  action: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22252E',
  },
  actionText: { color: '#F2F3F5', fontSize: 14, fontWeight: '600' },
  hint: {
    textAlign: 'center',
    color: '#7C828E',
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
});

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
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
import { AlbumPicker, BinSheet, OptionsSheet, RenameSheet, ReviewSheet, SlotMenu } from './Sheets';
import type { Store } from './store';
import {
  DAY_MS,
  MAX_ALBUMS,
  ROW_SIZE,
  SLOT_COLORS,
  type Access,
  type Action,
  type AlbumRef,
  type DeviceAlbum,
  type Photo,
} from './types';

const PAGE = 200;
const LOW_WATER = 8;
/** Space between the two album rows in Version 2 (matches `rowBelow` below). */
const ROW_GAP = 6;
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
  /** The album spot being filled from the picker, or null. */
  const [picking, setPicking] = useState<number | null>(null);
  /** The spot getting a brand-new album (asking for its name), or null. */
  const [naming, setNaming] = useState<number | null>(null);
  /** The filled spot whose menu (change / remove) is open, or null. */
  const [menuSlot, setMenuSlot] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [binBusy, setBinBusy] = useState(false);
  const [binError, setBinError] = useState<string | null>(null);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  const indexRef = useRef(index);
  indexRef.current = index;
  const { push, takeBack, settle, markSeen, setSlot, setSlotId, stateRef } = store;
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const topCard = useRef<PhotoCardHandle>(null);
  const emptyingRef = useRef(false);
  const autoEmptiedAt = useRef(0);

  const hoverSlot = useSharedValue(-1);
  const geometry = useSharedValue<Geometry>({
    width: 1,
    height: 1,
    filled: 0,
    aMin: 0,
    aMax: 0,
    aCenter: 0,
    bMin: 100000,
    bMax: 100000,
    bCenter: 0,
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
  // The second row only appears once every spot in the first row has an album.
  const rowBVisible = slots.slice(0, ROW_SIZE).every(Boolean);
  const design = store.design;
  const designRef = useRef(design);
  designRef.current = design;
  const rowRects = useRef<{ a?: { y: number; h: number }; b?: { y: number; h: number } }>({});

  /** Works out where a finger counts as "over" each album row, wherever the rows are. */
  const applyZones = useCallback(() => {
    const { a, b } = rowRects.current;
    const BIG = 100000;
    let aMin: number, aMax: number;
    const bMin = b ? b.y : BIG;
    const bMax = BIG;
    if (designRef.current === 1) {
      // Version 1: the first row is along the top, so anything above it counts.
      aMin = -BIG;
      aMax = a ? a.y + a.h : 0;
    } else {
      // Version 2: both rows are at the bottom; the first row's zone ends where the second begins.
      aMin = a ? a.y : BIG;
      aMax = b ? b.y : BIG;
    }
    const aCenter = a ? a.y + a.h / 2 : 0;
    const bCenter = b ? b.y + b.h / 2 : 0;
    geometry.modify((g) => {
      'worklet';
      g.aMin = aMin;
      g.aMax = aMax;
      g.aCenter = aCenter;
      g.bMin = bMin;
      g.bMax = bMax;
      g.bCenter = bCenter;
      return g;
    });
  }, [geometry]);

  useEffect(() => {
    if (!rowBVisible) rowRects.current.b = undefined;
    geometry.modify((g) => {
      'worklet';
      g.filled = filledMask;
      return g;
    });
    applyZones();
  }, [filledMask, rowBVisible, design, geometry, applyZones]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const { reviewed, pending } = stateRef.current;
      const known = new Set<string>(reviewed);
      pending.forEach((d) => known.add(d.photo.id));
      photosRef.current.forEach((p) => known.add(p.id));
      const fresh: Photo[] = [];
      let done = false;
      while (fresh.length < 20 && !done) {
        const page = await library.fetchPage(offsetRef.current, PAGE);
        offsetRef.current += page.length;
        for (const p of page) if (!known.has(p.id)) fresh.push(p);
        done = page.length < PAGE;
      }
      setExhausted(done);
      setPhotos((q) => [...q, ...fresh]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
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
    offsetRef.current = 0;
    setPhotos([]);
    photosRef.current = [];
    setIndex(0);
    setExhausted(false);
    setLoadError(null);
  }, []);

  const current = photos[index];
  const hasPrev = index > 0;
  const hasNext = index + 1 < photos.length;

  const decide = useCallback(
    (photo: Photo, action: Action) => {
      if (action.type === 'next') {
        markSeen(photo.id);
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
      setStatus(
        action.type === 'trash'
          ? 'Moved to trash bin'
          : `Added to ${stateRef.current.slots[action.slot]?.name ?? 'album'}`,
      );
    },
    [push, markSeen, stateRef],
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

  const goBack = useCallback(() => {
    if (topCard.current) topCard.current.send({ type: 'prev' });
    else setIndex((i) => Math.max(0, i - 1));
  }, []);

  const toggleFavorite = useCallback(
    (photo: Photo) => {
      const was = favorites[photo.id] ?? photo.favorite;
      setFavorites((f) => ({ ...f, [photo.id]: !was }));
      setStatus(was ? 'Removed from favorites' : 'Favorited');
      library.setFavorite(photo.id, !was).catch(() => {
        setFavorites((f) => ({ ...f, [photo.id]: was }));
        setStatus("Couldn't change favorite");
      });
    },
    [favorites],
  );

  const apply = useCallback(async () => {
    setBusy(true);
    setApplyError(null);
    try {
      const { pending, slots } = stateRef.current;
      for (let slot = 0; slot < slots.length; slot++) {
        const album = slots[slot];
        const ids = pending
          .filter((d) => d.action.type === 'album' && d.action.slot === slot)
          .map((d) => d.photo.id);
        if (!ids.length || !album) continue;
        const id = await library.fileIntoAlbum(album, ids);
        if (!album.id) setSlotId(slot, id);
        settle(ids, true);
      }
      setReviewing(false);
      setStatus('All saved');
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setApplyError(`That didn't finish (${why}). Anything not done is still waiting here.`);
    } finally {
      setBusy(false);
    }
  }, [settle, setSlotId, stateRef]);

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

  const counts = store.slots.map(
    (_, slot) =>
      store.pending.filter((d) => d.action.type === 'album' && d.action.slot === slot).length,
  );
  const trashCount = store.pending.filter((d) => d.action.type === 'trash').length;
  const toSave = counts.reduce((a, b) => a + b, 0);

  const tileH = design === 2 ? 60 : 68;
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
        count={counts[slot]}
        hoverSlot={hoverSlot}
        onPress={() => topCard.current?.send({ type: 'album', slot })}
        onLongPress={() => setMenuSlot(slot)}
        height={tileH}
      />
    );
  };

  /** Fills the empty spots that are showing with her biggest albums that aren't placed yet. */
  const autoFill = useCallback(async (): Promise<string> => {
    let albums: DeviceAlbum[];
    try {
      albums = await library.listAlbums();
    } catch {
      return "Couldn't read the albums on this phone.";
    }
    const now = stateRef.current.slots;
    const showing = now.slice(0, ROW_SIZE).every(Boolean) ? MAX_ALBUMS : ROW_SIZE;
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

  const row = (from: number) => (
    <View
      style={[styles.row, design === 2 && from === ROW_SIZE && styles.rowBelow]}
      // Version 2 measures both rows together, see `dock` below.
      onLayout={
        design === 1
          ? (e) => {
              const { y, height } = e.nativeEvent.layout;
              rowRects.current[from === 0 ? 'a' : 'b'] = { y, h: height };
              applyZones();
            }
          : undefined
      }
    >
      {[0, 1, 2, 3].map((i) => cell(from + i))}
    </View>
  );

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
          onPress={() => putBack()}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Text style={styles.pillText}>Undo</Text>
        </Pressable>
        <Text style={styles.status} numberOfLines={1}>
          {status || (library.isDemo ? 'Preview with sample photos' : '')}
        </Text>
        <Pressable
          style={styles.pill}
          onPress={() => {
            setBinError(null);
            setBinOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Trash bin, ${trashCount} photos`}
          testID="bin"
        >
          <Text style={styles.pillText}>{trashCount ? `Bin ${trashCount}` : 'Bin'}</Text>
        </Pressable>
        <Pressable
          style={[styles.pill, styles.save, !toSave && styles.dim]}
          disabled={!toSave}
          onPress={() => {
            setApplyError(null);
            setReviewing(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Save ${toSave} changes`}
        >
          <Text style={[styles.pillText, styles.saveText]}>
            {toSave ? `Save ${toSave}` : 'Save'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={() => setOptionsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Options"
          testID="options"
        >
          <Text style={styles.iconText}>⚙</Text>
        </Pressable>
      </View>

      {design === 1 && row(0)}

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
                  {toSave ? 'Tap Save to move your picks into albums. ' : ''}
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

      {design === 1 ? (
        rowBVisible && row(ROW_SIZE)
      ) : (
        <View
          // Both rows as one block: it changes size when the second row appears, so its
          // position is always re-read, and each row's place follows from the block's.
          onLayout={(e) => {
            const { y } = e.nativeEvent.layout;
            rowRects.current.a = { y, h: tileH };
            rowRects.current.b =
              rowBVisible ? { y: y + tileH + ROW_GAP, h: tileH } : undefined;
            applyZones();
          }}
        >
          {row(0)}
          {rowBVisible && row(ROW_SIZE)}
        </View>
      )}

      <AlbumPicker
        visible={picking !== null}
        used={slots.filter((a, i): a is AlbumRef => !!a && i !== picking)}
        onPick={(album) => {
          if (picking !== null) setSlot(picking, { name: album.title, id: album.id });
          setPicking(null);
        }}
        onNew={() => {
          setNaming(picking);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
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
      <SlotMenu
        visible={menuSlot !== null}
        name={menuSlot !== null ? (slots[menuSlot]?.name ?? '') : ''}
        locked={menuSlot !== null && counts[menuSlot] > 0}
        onChange={() => {
          setPicking(menuSlot);
          setMenuSlot(null);
        }}
        onRemove={() => {
          if (menuSlot !== null) setSlot(menuSlot, null);
          setMenuSlot(null);
        }}
        onClose={() => setMenuSlot(null)}
      />
      <OptionsSheet
        visible={optionsOpen}
        design={design}
        info={buildInfo()}
        onPick={store.setDesign}
        onAutoFill={autoFill}
        onClose={() => setOptionsOpen(false)}
      />
      <ReviewSheet
        visible={reviewing}
        store={store}
        busy={busy}
        error={applyError}
        onClose={() => setReviewing(false)}
        onApply={apply}
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
  count,
  hoverSlot,
  onPress,
  onLongPress,
  height,
}: {
  slot: number;
  name: string;
  count: number;
  hoverSlot: SharedValue<number>;
  onPress: () => void;
  onLongPress: () => void;
  height: number;
}) {
  const color = SLOT_COLORS[slot];
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
  return (
    <Animated.View style={[styles.tile, { borderColor: color, height }, style]}>
      <Pressable
        style={styles.tilePress}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${name} album`}
        accessibilityHint="Adds this photo. Hold to change or remove."
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
        {count > 0 && (
          <View style={[styles.count, { backgroundColor: color }]}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        )}
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
  tilePress: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
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

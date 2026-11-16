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
import { BinSheet, RenameSheet, ReviewSheet } from './Sheets';
import type { Store } from './store';
import {
  DAY_MS,
  MAX_ALBUMS,
  ROW_SIZE,
  SLOT_COLORS,
  type Access,
  type Action,
  type Photo,
} from './types';

const PAGE = 200;
const LOW_WATER = 8;
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
  /** An album slot being renamed, 'new' for a new album, or null when closed. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [binOpen, setBinOpen] = useState(false);
  const [binBusy, setBinBusy] = useState(false);
  const [binError, setBinError] = useState<string | null>(null);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  const indexRef = useRef(index);
  indexRef.current = index;
  const { push, takeBack, settle, markSeen, stateRef } = store;
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const topCard = useRef<PhotoCardHandle>(null);
  const emptyingRef = useRef(false);
  const autoEmptiedAt = useRef(0);

  const hoverSlot = useSharedValue(-1);
  const geometry = useSharedValue<Geometry>({
    width: 1,
    height: 1,
    albums: 0,
    topEdge: 0,
    topCenterY: 0,
    bottomEdge: 100000,
    bottomCenterY: 0,
    cardCenterY: 0,
  });

  useAnimatedReaction(
    () => hoverSlot.value,
    (now, before) => {
      if (now >= 0 && now !== before) scheduleOnRN(buzz, 'tick');
    },
  );

  const albumCount = store.slots.length;
  useEffect(() => {
    geometry.modify((g) => {
      'worklet';
      g.albums = albumCount;
      // No bottom row yet means no bottom drop zone.
      if (albumCount < ROW_SIZE) g.bottomEdge = 100000;
      return g;
    });
  }, [albumCount, geometry]);

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
          : `Added to ${stateRef.current.slots[action.slot]}`,
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
        const ids = pending
          .filter((d) => d.action.type === 'album' && d.action.slot === slot)
          .map((d) => d.photo.id);
        if (!ids.length) continue;
        await library.fileIntoAlbum(slots[slot], ids);
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
  }, [settle, stateRef]);

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

  const albumNames = store.slots;
  const cell = (slot: number) => {
    if (slot < albumNames.length) {
      return (
        <Tile
          key={slot}
          slot={slot}
          name={albumNames[slot]}
          count={counts[slot]}
          hoverSlot={hoverSlot}
          onPress={() => topCard.current?.send({ type: 'album', slot })}
          onLongPress={() => setEditing(slot)}
        />
      );
    }
    if (slot === albumNames.length && slot < MAX_ALBUMS) {
      return <AddTile key={slot} onPress={() => setEditing('new')} />;
    }
    return <View key={slot} style={styles.gap} />;
  };

  const row = (from: number) => (
    <View
      style={styles.row}
      onLayout={(e) => {
        const { y, height } = e.nativeEvent.layout;
        geometry.modify((g) => {
          'worklet';
          if (from === 0) {
            g.topEdge = y + height;
            g.topCenterY = y + height / 2;
          } else {
            g.bottomEdge = y;
            g.bottomCenterY = y + height / 2;
          }
          return g;
        });
      }}
    >
      {from === 0 && albumNames.length === 0 ? (
        <AddTile wide onPress={() => setEditing('new')} />
      ) : (
        [0, 1, 2, 3].map((i) => cell(from + i))
      )}
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
      </View>

      {row(0)}

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
        Swipe left for next · right to go back · flick up to trash{'\n'}
        {albumNames.length ? 'Drag to an album · ' : ''}Double-tap to favorite ♥
      </Text>

      {albumNames.length >= ROW_SIZE && row(ROW_SIZE)}

      <RenameSheet
        visible={editing !== null}
        title={editing === 'new' ? 'New album' : 'Album name'}
        name={typeof editing === 'number' ? (albumNames[editing] ?? '') : ''}
        onClose={() => setEditing(null)}
        onSave={(name) => {
          if (editing === 'new') store.addSlot(name);
          else if (typeof editing === 'number') store.renameSlot(editing, name);
          setEditing(null);
        }}
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
}: {
  slot: number;
  name: string;
  count: number;
  hoverSlot: SharedValue<number>;
  onPress: () => void;
  onLongPress: () => void;
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
    <Animated.View style={[styles.tile, { borderColor: color }, style]}>
      <Pressable
        style={styles.tilePress}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${name} album`}
        accessibilityHint="Adds this photo. Hold to rename."
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

function AddTile({ onPress, wide }: { onPress: () => void; wide?: boolean }) {
  return (
    <Pressable
      style={[styles.addTile, wide && styles.addWide]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add album"
      testID="add-album"
    >
      <Text style={styles.addPlus}>＋</Text>
      <Text style={styles.addText}>Add album</Text>
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
  gap: { flex: 1, height: 68, marginHorizontal: 4 },
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
  addWide: { flexDirection: 'row', gap: 10 },
  addPlus: { color: '#C5C9D2', fontSize: 20, fontWeight: '600' },
  addText: { color: '#C5C9D2', fontSize: 13, fontWeight: '600' },
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

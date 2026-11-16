import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { PhotoCard, type Geometry, type PhotoCardHandle } from './PhotoCard';
import { RenameSheet, ReviewSheet } from './Sheets';
import type { Store } from './store';
import { SLOT_COLORS, type Access, type Action, type Photo } from './types';

const PAGE = 200;
const LOW_WATER = 8;

function buzz(kind: 'tick' | 'thud') {
  const run =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  run.catch(() => {});
}

export function Sorter({ store, access }: { store: Store; access: Access }) {
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const topCard = useRef<PhotoCardHandle>(null);

  const hoverSlot = useSharedValue(-1);
  const geometry = useSharedValue<Geometry>({
    width: 1,
    height: 1,
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

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const { reviewed, pending } = store.stateRef.current;
      const known = new Set<string>(reviewed);
      pending.forEach((d) => known.add(d.photo.id));
      queueRef.current.forEach((p) => known.add(p.id));
      const fresh: Photo[] = [];
      let done = false;
      while (fresh.length < 20 && !done) {
        const page = await library.fetchPage(offsetRef.current, PAGE);
        offsetRef.current += page.length;
        for (const p of page) if (!known.has(p.id)) fresh.push(p);
        done = page.length < PAGE;
      }
      setExhausted(done);
      setQueue((q) => [...q, ...fresh]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [store.stateRef]);

  useEffect(() => {
    if (queue.length < LOW_WATER && !exhausted && !loading && !loadError) loadMore();
  }, [queue.length, exhausted, loading, loadError, loadMore]);

  // First load.
  useEffect(() => {
    loadMore();
  }, [loadMore]);

  const reload = useCallback(() => {
    offsetRef.current = 0;
    setQueue([]);
    queueRef.current = [];
    setExhausted(false);
    setLoadError(null);
  }, []);

  const current = queue[0];

  const decide = useCallback(
    (photo: Photo, action: Action) => {
      setQueue((q) => q.filter((p) => p.id !== photo.id));
      store.push({ photo, action });
      if (action.type === 'trash') {
        buzz('thud');
        setStatus('Moved to trash');
      } else if (action.type === 'album') {
        buzz('thud');
        setStatus(`Added to ${store.stateRef.current.slots[action.slot]}`);
      } else {
        setStatus('Kept');
      }
    },
    [store],
  );

  const putBack = useCallback(
    (photoId?: string) => {
      const d = store.takeBack(photoId);
      if (!d) return;
      setQueue((q) => [d.photo, ...q.filter((p) => p.id !== d.photo.id)]);
      setStatus('Put back');
    },
    [store],
  );

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
      const { pending, slots } = store.stateRef.current;
      for (let slot = 0; slot < slots.length; slot++) {
        const ids = pending
          .filter((d) => d.action.type === 'album' && d.action.slot === slot)
          .map((d) => d.photo.id);
        if (!ids.length) continue;
        await library.fileIntoAlbum(slots[slot], ids);
        store.settle(ids, true);
      }
      const kept = pending.filter((d) => d.action.type === 'keep').map((d) => d.photo.id);
      if (kept.length) store.settle(kept, true);
      const trash = pending.filter((d) => d.action.type === 'trash').map((d) => d.photo.id);
      if (trash.length) {
        await library.deletePhotos(trash);
        store.settle(trash, false);
        offsetRef.current = Math.max(0, offsetRef.current - trash.length);
      }
      setReviewing(false);
      setStatus('All saved');
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setApplyError(`That didn't finish (${why}). Anything not done is still waiting here.`);
    } finally {
      setBusy(false);
    }
  }, [store]);

  const counts = store.slots.map(
    (_, slot) =>
      store.pending.filter((d) => d.action.type === 'album' && d.action.slot === slot).length,
  );
  const trashCount = store.pending.filter((d) => d.action.type === 'trash').length;
  const toSave = trashCount + counts.reduce((a, b) => a + b, 0);

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
      {[0, 1, 2, 3].map((i) => {
        const slot = from + i;
        return (
          <Tile
            key={slot}
            slot={slot}
            name={store.slots[slot]}
            count={counts[slot]}
            hoverSlot={hoverSlot}
            onPress={() => topCard.current?.send({ type: 'album', slot })}
            onLongPress={() => setRenaming(slot)}
          />
        );
      })}
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
        {queue
          .slice(0, 2)
          .reverse()
          .map((photo) => (
            <PhotoCard
              key={photo.id}
              ref={photo === current ? topCard : undefined}
              photo={photo}
              active={photo === current}
              favorite={favorites[photo.id] ?? photo.favorite}
              geometry={geometry}
              hoverSlot={hoverSlot}
              onDecide={(action) => decide(photo, action)}
              onFavorite={() => toggleFavorite(photo)}
            />
          ))}

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
                <Text style={styles.emptyTitle}>All caught up</Text>
                <Text style={styles.emptyBody}>
                  {toSave
                    ? 'Tap Save to move your picks into albums and empty the trash.'
                    : 'Every photo has been sorted.'}
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
          style={[styles.action, !current && styles.dim]}
          disabled={!current}
          onPress={() => topCard.current?.send({ type: 'trash' })}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Trash</Text>
        </Pressable>
        <Text style={styles.hint}>
          Flick up to trash{'\n'}Drag to an album · Double-tap ♥
        </Text>
        <Pressable
          style={[styles.action, !current && styles.dim]}
          disabled={!current}
          onPress={() => topCard.current?.send({ type: 'keep' })}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Skip</Text>
        </Pressable>
      </View>

      {row(4)}

      <RenameSheet
        slot={renaming}
        name={renaming === null ? '' : store.slots[renaming]}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (renaming !== null) store.renameSlot(renaming, name);
          setRenaming(null);
        }}
      />
      <ReviewSheet
        visible={reviewing}
        store={store}
        busy={busy}
        error={applyError}
        onRescue={(id) => putBack(id)}
        onClose={() => setReviewing(false)}
        onApply={apply}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0F13' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 52,
    gap: 10,
  },
  status: { flex: 1, textAlign: 'center', color: '#A9AEB8', fontSize: 14 },
  pill: {
    minWidth: 72,
    height: 38,
    paddingHorizontal: 14,
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
    width: 72,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22252E',
  },
  actionText: { color: '#F2F3F5', fontSize: 14, fontWeight: '600' },
  hint: { flex: 1, textAlign: 'center', color: '#7C828E', fontSize: 12, lineHeight: 16 },
});

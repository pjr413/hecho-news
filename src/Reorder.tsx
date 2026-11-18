// "Rearrange albums": a list the albums can be dragged around in by their handles.
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

const ROW_H = 58;
const GAP = 10;
const STEP = ROW_H + GAP;

export type ReorderItem = { name: string; color: string; emoji?: string | null };

function Row({
  item,
  index,
  count,
  onMove,
}: {
  item: ReorderItem;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const pan = usePanGesture({
    onUpdate: (e) => {
      'worklet';
      ty.value = e.translationY;
      lift.value = 1;
    },
    onDeactivate: (e) => {
      'worklet';
      const to = Math.max(0, Math.min(count - 1, index + Math.round(e.translationY / STEP)));
      ty.value = 0;
      lift.value = 0;
      if (to !== index) scheduleOnRN(onMove, index, to);
    },
  });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: 1 + 0.05 * lift.value }],
    zIndex: lift.value > 0 ? 10 : 0,
    opacity: lift.value > 0 ? 0.92 : 1,
  }));
  return (
    <Animated.View style={[styles.row, { borderColor: item.color }, style]} testID={`reorder-row-${index}`}>
      <Text style={styles.emoji}>{item.emoji ?? ''}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {item.name}
      </Text>
      <GestureDetector gesture={pan}>
        <View style={styles.handle} testID={`reorder-handle-${index}`} accessibilityLabel={`Drag ${item.name}`}>
          <Text style={styles.handleText}>≡</Text>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

export function ReorderScreen({
  items,
  onMove,
  onClose,
}: {
  items: ReorderItem[];
  onMove: (from: number, to: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]} testID="reorder">
      <Text style={styles.title}>Rearrange albums</Text>
      <Text style={styles.hint}>Hold the ≡ and drag an album up or down.</Text>
      <View style={styles.list}>
        {items.map((item, i) => (
          <Row key={item.name} item={item} index={i} count={items.length} onMove={onMove} />
        ))}
      </View>
      <Text style={styles.done} onPress={onClose} accessibilityRole="button" testID="reorder-done">
        Done
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#14161c', paddingHorizontal: 18, zIndex: 50 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  hint: { color: '#C9CDE0', fontSize: 15, marginTop: 4, marginBottom: 18 },
  list: { gap: GAP },
  row: {
    height: ROW_H,
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: '#22252E',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    gap: 10,
  },
  emoji: { fontSize: 22 },
  name: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '600' },
  handle: { width: 64, height: '100%', alignItems: 'center', justifyContent: 'center' },
  handleText: { color: '#C9CDE0', fontSize: 28 },
  done: {
    marginTop: 'auto',
    textAlign: 'center',
    backgroundColor: '#3a4060',
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    paddingVertical: 14,
    borderRadius: 16,
    overflow: 'hidden',
  },
});

import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Store } from './store';
import { DAY_MS, RETENTION_CHOICES, SLOT_COLORS } from './types';

export function RenameSheet({
  visible,
  title,
  name,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  name: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name, visible]);
  const clean = text.trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, styles.top]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>
            Photos you drop here go into the album with this name. It's created on your phone if
            it doesn't exist yet.
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={() => clean && onSave(clean)}
            style={styles.input}
            placeholder="Album name"
            placeholderTextColor="#6B7180"
            testID="rename-input"
          />
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, !clean && styles.dim]}
              disabled={!clean}
              onPress={() => onSave(clean)}
            >
              <Text style={[styles.buttonText, styles.primaryText]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ReviewSheet({
  visible,
  store,
  busy,
  error,
  onClose,
  onApply,
}: {
  visible: boolean;
  store: Store;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: () => void;
}) {
  const albums = store.slots
    .map((name, slot) => ({
      name,
      slot,
      count: store.pending.filter((d) => d.action.type === 'album' && d.action.slot === slot)
        .length,
    }))
    .filter((a) => a.count > 0);
  const nothing = !albums.length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Save to albums</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
            {nothing && <Text style={styles.body}>Nothing left to save.</Text>}
            {albums.map((a) => (
              <View key={a.slot} style={styles.line}>
                <View style={[styles.dot, { backgroundColor: SLOT_COLORS[a.slot] }]} />
                <Text style={styles.lineText} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={styles.lineCount}>
                  {a.count} {a.count === 1 ? 'photo' : 'photos'}
                </Text>
              </View>
            ))}
          </ScrollView>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose} disabled={busy}>
              <Text style={styles.buttonText}>Not yet</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, (busy || nothing) && styles.dim]}
              disabled={busy || nothing}
              onPress={onApply}
              testID="apply"
            >
              {busy ? (
                <ActivityIndicator color="#101114" />
              ) : (
                <Text style={[styles.buttonText, styles.primaryText]}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function BinSheet({
  visible,
  store,
  busy,
  error,
  onRestore,
  onEmpty,
  onClose,
}: {
  visible: boolean;
  store: Store;
  busy: boolean;
  error: string | null;
  onRestore: (photoId: string) => void;
  onEmpty: (photoIds: string[]) => void;
  onClose: () => void;
}) {
  const days = store.retentionDays;
  const trash = store.pending.filter((d) => d.action.type === 'trash');
  const now = Date.now();
  const daysLeft = (at: number) => Math.max(0, Math.ceil((at + days * DAY_MS - now) / DAY_MS));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Trash bin</Text>
          <Text style={styles.body}>
            {trash.length
              ? 'Tap a photo to put it back. Photos are deleted from your phone when their days run out.'
              : 'The bin is empty. Photos you flick away wait here before they are deleted.'}
          </Text>
          <View style={styles.chips}>
            <Text style={styles.chipLabel}>Days to keep</Text>
            {RETENTION_CHOICES.map((n) => (
              <Pressable
                key={n}
                style={[styles.chip, n === days && styles.chipOn]}
                onPress={() => store.setRetentionDays(n)}
                accessibilityRole="button"
                accessibilityState={{ selected: n === days }}
                accessibilityLabel={`Keep for ${n} days`}
                testID={`keep-${n}`}
              >
                <Text style={[styles.chipText, n === days && styles.chipTextOn]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          {trash.length > 0 && (
            <ScrollView style={styles.scroll}>
              <View style={styles.grid}>
                {trash.map((d) => (
                  <Pressable
                    key={d.photo.id}
                    disabled={busy}
                    onPress={() => onRestore(d.photo.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Put back. ${daysLeft(d.at)} days left`}
                    testID="bin-photo"
                  >
                    <Image source={{ uri: d.photo.uri }} style={styles.thumb} contentFit="cover" />
                    <View style={styles.left}>
                      <Text style={styles.leftText}>
                        {daysLeft(d.at) === 0 ? 'today' : `${daysLeft(d.at)}d`}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose} disabled={busy}>
              <Text style={styles.buttonText}>Done</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.danger, (busy || !trash.length) && styles.dim]}
              disabled={busy || !trash.length}
              onPress={() => onEmpty(trash.map((d) => d.photo.id))}
              testID="empty-bin"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Delete all now</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', padding: 16 },
  top: { justifyContent: 'flex-start', paddingTop: 110 },
  bottom: { justifyContent: 'flex-end', paddingBottom: 28 },
  sheet: { backgroundColor: '#1B1D24', borderRadius: 22, padding: 20, gap: 12 },
  tall: { maxHeight: '80%' },
  title: { color: '#F2F3F5', fontSize: 20, fontWeight: '700' },
  body: { color: '#A9AEB8', fontSize: 14, lineHeight: 20 },
  section: { color: '#F2F3F5', fontSize: 16, fontWeight: '700', marginTop: 8 },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#0E0F13',
    color: '#F2F3F5',
    fontSize: 17,
  },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
  buttonText: { color: '#F2F3F5', fontSize: 16, fontWeight: '600' },
  primary: { backgroundColor: '#F2F3F5' },
  primaryText: { color: '#101114' },
  dim: { opacity: 0.4 },
  scroll: { flexGrow: 0 },
  scrollBody: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  lineText: { flex: 1, color: '#F2F3F5', fontSize: 16 },
  lineCount: { color: '#A9AEB8', fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#0E0F13' },
  error: { color: '#FF8A8A', fontSize: 14, lineHeight: 20 },
  danger: { backgroundColor: '#B3303C' },
  chips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chipLabel: { color: '#A9AEB8', fontSize: 14, marginRight: 2 },
  chip: {
    height: 34,
    minWidth: 46,
    paddingHorizontal: 11,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2D37',
  },
  chipOn: { backgroundColor: '#F2F3F5' },
  chipText: { color: '#F2F3F5', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#101114' },
  left: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  leftText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

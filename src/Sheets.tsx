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
import { SLOT_COLORS } from './types';

export function RenameSheet({
  slot,
  name,
  onClose,
  onSave,
}: {
  slot: number | null;
  name: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name, slot]);
  const clean = text.trim();

  return (
    <Modal visible={slot !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, styles.top]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Album name</Text>
          <Text style={styles.body}>
            Photos dropped here go into the album with this name. It's created if it doesn't
            exist yet.
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
  onRescue,
  onClose,
  onApply,
}: {
  visible: boolean;
  store: Store;
  busy: boolean;
  error: string | null;
  onRescue: (photoId: string) => void;
  onClose: () => void;
  onApply: () => void;
}) {
  const trash = store.pending.filter((d) => d.action.type === 'trash');
  const albums = store.slots
    .map((name, slot) => ({
      name,
      slot,
      count: store.pending.filter((d) => d.action.type === 'album' && d.action.slot === slot)
        .length,
    }))
    .filter((a) => a.count > 0);
  const nothing = !trash.length && !albums.length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Save changes</Text>
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
            {trash.length > 0 && (
              <>
                <Text style={styles.section}>
                  Delete {trash.length} {trash.length === 1 ? 'photo' : 'photos'}
                </Text>
                <Text style={styles.body}>Tap any photo to keep it instead.</Text>
                <View style={styles.grid}>
                  {trash.map((d) => (
                    <Pressable
                      key={d.photo.id}
                      disabled={busy}
                      onPress={() => onRescue(d.photo.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Keep this photo"
                    >
                      <Image source={{ uri: d.photo.uri }} style={styles.thumb} contentFit="cover" />
                    </Pressable>
                  ))}
                </View>
              </>
            )}
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
});

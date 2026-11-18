// "Keep which?": shows a few photos that are alike (a burst, a pair of duplicates, or the photo and
// the next one); tapping one keeps it and sends the rest to the bin.
import { Image } from 'expo-image';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Photo } from './types';

export function CompareSheet({
  photos,
  onKeep,
  onKeepAll,
  onClose,
}: {
  /** The photos to choose between; the sheet is shown when there are at least two. */
  photos: Photo[];
  onKeep: (keep: Photo) => void;
  onKeepAll: () => void;
  onClose: () => void;
}) {
  const visible = photos.length >= 2;
  const many = photos.length > 2;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Keep which?</Text>
          <Text style={styles.body}>
            Tap the one you want. {photos.length > 2 ? `The other ${photos.length - 1} go` : 'The other one goes'} to the
            bin.
          </Text>
          <ScrollView contentContainerStyle={styles.grid} testID="compare-grid">
            {photos.map((p, i) => (
              <Pressable
                key={p.id}
                onPress={() => onKeep(p)}
                style={[styles.cell, many ? styles.cellSmall : styles.cellBig]}
                accessibilityRole="button"
                accessibilityLabel={`Keep photo ${i + 1}`}
                testID={`keep-${i}`}
              >
                <Image source={{ uri: p.uri }} style={styles.image} contentFit="contain" />
                <View style={styles.tag}>
                  <Text style={styles.tagText}>Keep</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onKeepAll} testID="keep-all">
              <Text style={styles.buttonText}>Keep all</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={onClose} testID="compare-close">
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1B1D24',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '88%',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  body: { color: '#C9CDE0', fontSize: 15, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 12 },
  cell: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#2A2D38' },
  cellBig: { width: '48%', aspectRatio: 0.75 },
  cellSmall: { width: '31.5%', aspectRatio: 0.75 },
  image: { width: '100%', height: '100%' },
  tag: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  tagText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, backgroundColor: '#2A2D38', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

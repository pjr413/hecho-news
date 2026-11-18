import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { advancedQueries } from './library';

const ALL_STEPS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '👈',
    title: 'Swipe through your photos',
    body: 'Swipe left for the next photo, and right to go back. They come newest first.',
  },
  {
    emoji: '🗑️',
    title: 'Clear out the clutter',
    body: 'Flick a photo up, or pinch it with two fingers, to send it to the bin. Nothing is deleted for a week, so you can change your mind.',
  },
  {
    emoji: '📁',
    title: 'File the keepers',
    body: 'Tap a + to pick an album, then drag photos onto it. Hold an album for a second to look inside.',
  },
  {
    emoji: '❤️',
    title: 'Love one?',
    body: 'Double-tap a photo to favorite it.',
  },
  {
    emoji: '🔎',
    title: 'Find things fast',
    body: 'In Options (the gear) you can show only videos or screenshots, find bursts of near-identical photos, and jump to any month.',
  },
];
// The last card is about filters, which are held back until they're proven on a phone.
const STEPS = advancedQueries ? ALL_STEPS : ALL_STEPS.slice(0, -1);

/** A short walk-through of the gestures, shown the first time and from Options. */
export function Tour({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];
  const finish = () => {
    setStep(0);
    onDone();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.emoji}>{s.emoji}</Text>
          <Text style={styles.title} testID="tour-title">
            {s.title}
          </Text>
          <Text style={styles.body}>{s.body}</Text>
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
            ))}
          </View>
          <Pressable
            style={styles.next}
            onPress={() => (last ? finish() : setStep(step + 1))}
            accessibilityRole="button"
            testID="tour-next"
          >
            <Text style={styles.nextText}>{last ? 'Start sorting' : 'Next'}</Text>
          </Pressable>
          {!last && (
            <Pressable onPress={finish} accessibilityRole="button" testID="tour-skip">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 12,
    padding: 26,
    borderRadius: 26,
    backgroundColor: '#1B1D24',
  },
  emoji: { fontSize: 54 },
  title: { color: '#F2F3F5', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: '#A9AEB8', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3A3F4B' },
  dotOn: { backgroundColor: '#F2F3F5' },
  next: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },
  nextText: { color: '#101114', fontSize: 17, fontWeight: '700' },
  skip: { color: '#7C828E', fontSize: 15, padding: 6 },
});

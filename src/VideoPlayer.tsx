import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import * as library from './library';
import { videoModule } from './optional';
import type { Photo } from './types';

/** Can this install play videos? (The player has a native part older installs don't have.) */
export const canPlayVideo = (): boolean => !library.isDemo && videoModule() !== null;

function Player({ uri }: { uri: string }) {
  const mod = videoModule()!;
  const player = mod.useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <mod.VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

/** A Live Photo's clip, laid over the photo while it's held. */
export function LiveClip({ uri }: { uri: string }) {
  const mod = videoModule()!;
  const player = mod.useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <mod.VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      nativeControls={false}
      contentFit="contain"
      pointerEvents="none"
    />
  );
}

/** Plays a video from the library full screen. */
export function VideoPlayerSheet({ photo, onClose }: { photo: Photo | null; onClose: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUri(null);
    setFailed(false);
    if (!photo) return;
    let live = true;
    library
      .videoUri(photo.id)
      .then((u) => live && (u ? setUri(u) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [photo]);

  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {!canPlayVideo() && !library.isDemo ? (
          <Text style={styles.message}>
            This copy of the app can’t play videos yet. It needs the latest app build.
          </Text>
        ) : failed ? (
          <Text style={styles.message}>This video can’t be played here.</Text>
        ) : uri ? (
          <Player uri={uri} />
        ) : (
          <ActivityIndicator color="#fff" />
        )}
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" testID="video-close">
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '70%' },
  message: { color: '#C5C9D2', fontSize: 16, padding: 24, textAlign: 'center' },
  close: {
    position: 'absolute',
    bottom: 48,
    height: 48,
    paddingHorizontal: 32,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },
  closeText: { color: '#101114', fontSize: 16, fontWeight: '700' },
});

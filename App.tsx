import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import * as library from './src/library';
import { Sorter } from './src/Sorter';
import { useStore } from './src/store';
import type { Access } from './src/types';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Gate />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Gate() {
  const store = useStore();
  const [access, setAccess] = useState<Access | null>(null);
  const [canAsk, setCanAsk] = useState(true);

  useEffect(() => {
    library
      .checkAccess()
      .then((r) => {
        setAccess(r.access);
        setCanAsk(r.canAsk);
      })
      .catch(() => setAccess('none'));
  }, []);

  if (!store.ready || access === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (access === 'none') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Sort your photos</Text>
        <Text style={styles.body}>
          Flick a photo up to throw it away, or drag it onto an album to keep it. Nothing is
          deleted until you tap Save.
        </Text>
        <Pressable
          style={styles.button}
          testID="allow"
          onPress={async () => {
            if (!canAsk) return Linking.openSettings();
            const r = await library.requestAccess().catch(() => null);
            if (r) {
              setAccess(r.access);
              setCanAsk(r.canAsk);
            }
          }}
        >
          <Text style={styles.buttonText}>
            {canAsk ? 'Allow access to photos' : 'Open Settings'}
          </Text>
        </Pressable>
        {!canAsk && (
          <Text style={styles.note}>Photo access is turned off for this app in Settings.</Text>
        )}
      </View>
    );
  }

  return <Sorter store={store} access={access} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0E0F13' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
    backgroundColor: '#0E0F13',
  },
  title: { color: '#F2F3F5', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  body: { color: '#A9AEB8', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  button: {
    height: 52,
    paddingHorizontal: 26,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
    marginTop: 8,
  },
  buttonText: { color: '#101114', fontSize: 17, fontWeight: '700' },
  note: { color: '#7C828E', fontSize: 13, textAlign: 'center' },
});

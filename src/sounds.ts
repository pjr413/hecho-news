// Little sounds for chess moves. expo-audio has a native part, so it's only loaded when this build
// of the app has it; otherwise everything here is silent.
import { requireOptionalNativeModule } from 'expo';

type AudioModule = typeof import('expo-audio');
type Player = ReturnType<AudioModule['createAudioPlayer']>;

export type Sound = 'move' | 'capture' | 'check' | 'end';

const FILES: Record<Sound, number> = {
  move: require('../assets/sounds/move.wav'),
  capture: require('../assets/sounds/capture.wav'),
  check: require('../assets/sounds/check.wav'),
  end: require('../assets/sounds/end.wav'),
};

let audio: AudioModule | null | undefined;
const players: Partial<Record<Sound, Player>> = {};

function load(): AudioModule | null {
  if (audio === undefined) {
    try {
      if (requireOptionalNativeModule('ExpoAudio') == null) throw new Error('no native audio');
      audio = require('expo-audio') as AudioModule;
    } catch {
      audio = null;
    }
  }
  return audio;
}

export function playSound(name: Sound): void {
  try {
    const mod = load();
    if (!mod) return;
    let player = players[name];
    if (!player) player = players[name] = mod.createAudioPlayer(FILES[name]);
    player.seekTo(0);
    player.play();
  } catch {
    // No sound is better than a crash.
  }
}

import { requireOptionalNativeModule } from 'expo';

// Packages with a native part that older installs of the app may not have. Each is loaded lazily
// and returns null when missing, so an over-the-air update never crashes such an install.

type VideoModule = typeof import('expo-video');
type SensorsModule = typeof import('expo-sensors');

/** Is the native half of a package in this build of the app? Checked before its JS is even loaded. */
function hasNative(name: string): boolean {
  try {
    return requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
}

let video: VideoModule | null | undefined;
let sensors: SensorsModule | null | undefined;

export function videoModule(): VideoModule | null {
  if (video === undefined) {
    try {
      if (!hasNative('ExpoVideo')) throw new Error('no native video');
      video = require('expo-video') as VideoModule;
    } catch {
      video = null;
    }
  }
  return video;
}

export function sensorsModule(): SensorsModule | null {
  if (sensors === undefined) {
    try {
      if (!hasNative('ExponentAccelerometer')) throw new Error('no native sensors');
      sensors = require('expo-sensors') as SensorsModule;
    } catch {
      sensors = null;
    }
  }
  return sensors;
}

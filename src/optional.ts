// Packages with a native part that older installs of the app may not have. Each is loaded lazily
// and returns null when missing, so an over-the-air update never crashes such an install.

type VideoModule = typeof import('expo-video');
type SensorsModule = typeof import('expo-sensors');

let video: VideoModule | null | undefined;
let sensors: SensorsModule | null | undefined;

export function videoModule(): VideoModule | null {
  if (video === undefined) {
    try {
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
      sensors = require('expo-sensors') as SensorsModule;
    } catch {
      sensors = null;
    }
  }
  return sensors;
}

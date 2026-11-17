// Keeps the screen on while the chess timer is showing.
//
// expo-keep-awake has a native part. A copy of the app built before it was added doesn't have
// it, and an over-the-air update must not crash such a copy, so it's loaded lazily and any
// failure just means the screen is allowed to sleep as usual.
type KeepAwake = typeof import('expo-keep-awake');

let cached: KeepAwake | null | undefined;

function load(): KeepAwake | null {
  if (cached === undefined) {
    try {
      cached = require('expo-keep-awake') as KeepAwake;
    } catch {
      cached = null;
    }
  }
  return cached;
}

export function keepAwake(tag: string): void {
  try {
    load()
      ?.activateKeepAwakeAsync(tag)
      .catch(() => {});
  } catch {
    // Not available in this build.
  }
}

export function allowSleep(tag: string): void {
  try {
    load()
      ?.deactivateKeepAwake(tag)
      .catch(() => {});
  } catch {
    // Not available in this build.
  }
}

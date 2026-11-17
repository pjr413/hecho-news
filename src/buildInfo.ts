import * as Updates from 'expo-updates';

/** One line for Options: which build this is and whether an over-the-air update is running. */
export function buildInfo(): string {
  // Set by the app's version when installed as a real build; empty while developing.
  const version = Updates.runtimeVersion ? `App ${Updates.runtimeVersion}` : 'Development build';
  if (!Updates.isEmbeddedLaunch && Updates.createdAt) {
    return `${version} · updated ${Updates.createdAt.toLocaleDateString()}`;
  }
  return version;
}

import { sensorsModule } from './optional';

/**
 * Calls back when the phone is shaken (a few hard jolts within a second or so). Returns a function
 * that stops listening. Does nothing on an install that doesn't have the motion sensors.
 */
export function onShake(callback: () => void): () => void {
  const sensors = sensorsModule();
  if (!sensors) return () => {};
  try {
    return listen(sensors, callback);
  } catch {
    return () => {};
  }
}

function listen(sensors: NonNullable<ReturnType<typeof sensorsModule>>, callback: () => void): () => void {
  const { Accelerometer } = sensors;
  Accelerometer.setUpdateInterval(80);
  let jolts = 0;
  let lastJolt = 0;
  let lastShake = 0;
  const sub = Accelerometer.addListener(({ x, y, z }) => {
    const g = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();
    if (g < 2.2) return;
    jolts = now - lastJolt < 700 ? jolts + 1 : 1;
    lastJolt = now;
    if (jolts >= 3 && now - lastShake > 2500) {
      jolts = 0;
      lastShake = now;
      callback();
    }
  });
  return () => sub.remove();
}

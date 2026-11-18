/** In the browser preview there's no shaking: press Shift+S instead. */
export function onShake(callback: () => void): () => void {
  const handler = (e: KeyboardEvent) => {
    const target = e.target as { tagName?: string } | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    if (e.shiftKey && e.key.toLowerCase() === 's') callback();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

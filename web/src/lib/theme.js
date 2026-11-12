import { useSyncExternalStore } from 'react';

const KEY = 'falcon-theme';
const listeners = new Set();
const browser = typeof window !== 'undefined';
const media = browser ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export const getPreference = () => (browser && localStorage.getItem(KEY)) || 'system';

export function resolvedTheme() {
  const preference = getPreference();
  if (preference === 'system') return media?.matches ? 'dark' : 'light';
  return preference;
}

export function applyTheme() {
  if (!browser) return;
  document.documentElement.dataset.theme = resolvedTheme();
  listeners.forEach((listener) => listener());
}

export function setPreference(preference) {
  localStorage.setItem(KEY, preference);
  applyTheme();
}

media?.addEventListener('change', applyTheme);

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, resolvedTheme, () => 'light');
  const preference = useSyncExternalStore(subscribe, getPreference, () => 'system');
  return { theme, preference, setPreference };
}

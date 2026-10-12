import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** @typedef {'light' | 'dark' | 'system'} ThemePref */

export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useThemeStore = create(
  persist(
    (set) => ({
      /** @type {ThemePref} */
      theme: 'system',
      /** @param {ThemePref} theme */
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'fv-theme' },
  ),
);

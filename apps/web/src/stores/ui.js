import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Shell UI state. Only the rail preference is persisted. */
export const useUiStore = create(
  persist(
    (set, get) => ({
      railExpanded: false,
      paletteOpen: false,
      shortcutsOpen: false,
      notificationsOpen: false,
      toggleRail: () => set({ railExpanded: !get().railExpanded }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
    }),
    { name: 'fv-ui', partialize: (s) => ({ railExpanded: s.railExpanded }) },
  ),
);

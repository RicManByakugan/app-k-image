// src/app/core/theme.service.ts
import {
  Injectable,
  Inject,
  PLATFORM_ID,
  effect,
  signal,
  computed,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-mode';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly isBrowser: boolean;
  private media: MediaQueryList | null = null;

  private _mode = signal<ThemeMode>('system');
  /** The active mode preference (what the user picked). */
  readonly mode = computed(() => this._mode());
  /** True if the effective theme should be dark, after considering system setting. */
  readonly isDark = computed(() => {
    const m = this._mode();
    if (m === 'dark') return true;
    if (m === 'light') return false;
    return this.isSystemDark();
  });

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    // Initialize from storage
    const stored = this.isBrowser
      ? (localStorage.getItem(STORAGE_KEY) as ThemeMode | null)
      : null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      this._mode.set(stored);
    }

    if (this.isBrowser) {
      // Listen for OS color scheme changes when in "system" mode
      this.media = window.matchMedia('(prefers-color-scheme: dark)');
      this.media.addEventListener?.('change', () => {
        if (this._mode() === 'system') this.applyClass();
      });

      // Cross-tab sync
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
          const v = e.newValue as ThemeMode;
          if (v === 'light' || v === 'dark' || v === 'system') {
            this._mode.set(v);
          }
        }
      });
    }

    // React to changes and apply class + persist
    effect(() => {
      const mode = this._mode();
      if (this.isBrowser) localStorage.setItem(STORAGE_KEY, mode);
      this.applyClass();
    });
  }

  setMode(mode: ThemeMode) {
    this._mode.set(mode);
  }

  /** Cycle Light → Dark → System → … */
  cycleMode() {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(this._mode());
    this._mode.set(order[(idx + 1) % order.length]);
  }

  private isSystemDark(): boolean {
    if (!this.isBrowser) return false;
    return (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  }

  private applyClass() {
    if (!this.isBrowser) return;
    const root = document.documentElement;
    const dark = this.isDark();
    root.classList.toggle('dark', dark);
  }
}

import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';

const STORAGE_KEY_THEME = 'app-editor-theme';
const STORAGE_KEY_SCENE = 'app-scene-background';

export type EditorTheme = 'dark' | 'light';
export type SceneBackground = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class AppThemeService {
  private readonly themeSubject = new BehaviorSubject<EditorTheme>(this.loadTheme());
  private readonly sceneSubject = new BehaviorSubject<SceneBackground>(this.loadSceneBackground());

  readonly theme$ = this.themeSubject.asObservable();
  readonly sceneBackground$ = this.sceneSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  getTheme(): EditorTheme {
    return this.themeSubject.value;
  }

  isLight(): boolean {
    return this.themeSubject.value === 'light';
  }

  setTheme(theme: EditorTheme): void {
    this.themeSubject.next(theme);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(STORAGE_KEY_THEME, theme);
      } catch {}
    }
  }

  toggleTheme(): EditorTheme {
    const next = this.themeSubject.value === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
    return next;
  }

  /** Zwraca tryb tła sceny 3D – zsynchronizowany z motywem (jeden przycisk = motyw + scena). */
  getSceneBackground(): SceneBackground {
    return this.themeSubject.value;
  }

  setSceneBackground(mode: SceneBackground): void {
    this.sceneSubject.next(mode);
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(STORAGE_KEY_SCENE, mode);
      } catch {}
    }
  }

  toggleSceneBackground(): SceneBackground {
    const next = this.sceneSubject.value === 'dark' ? 'light' : 'dark';
    this.setSceneBackground(next);
    return next;
  }

  private loadTheme(): EditorTheme {
    if (!isPlatformBrowser(this.platformId)) return 'dark';
    try {
      const v = localStorage.getItem(STORAGE_KEY_THEME);
      if (v === 'light' || v === 'dark') return v;
    } catch {}
    return 'dark';
  }

  private loadSceneBackground(): SceneBackground {
    if (!isPlatformBrowser(this.platformId)) return 'dark';
    try {
      const v = localStorage.getItem(STORAGE_KEY_SCENE);
      if (v === 'light' || v === 'dark') return v;
    } catch {}
    return 'dark';
  }
}

import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

if (typeof globalThis.ProgressEvent === 'undefined') {
  class NodeProgressEvent implements ProgressEvent {
    readonly type: string;
    readonly bubbles = false;
    readonly cancelBubble = false;
    readonly cancelable = false;
    readonly composed = false;
    readonly currentTarget: EventTarget | null = null;
    readonly defaultPrevented = false;
    readonly eventPhase = 0;
    readonly isTrusted = false;
    readonly NONE = 0;
    readonly CAPTURING_PHASE = 1;
    readonly AT_TARGET = 2;
    readonly BUBBLING_PHASE = 3;
    readonly returnValue = false;
    readonly timeStamp = Date.now();
    readonly srcElement: EventTarget | null = null;
    readonly target: EventTarget | null = null;
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    constructor(type: string, init: ProgressEventInit = {}) {
      this.type = type;
      this.lengthComputable = !!init.lengthComputable;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
    composedPath(): EventTarget[] {
      return [];
    }
    initEvent(): void {
      return;
    }
    preventDefault(): void {
      return;
    }
    stopImmediatePropagation(): void {
      return;
    }
    stopPropagation(): void {
      return;
    }
  }

  (globalThis as any).ProgressEvent = NodeProgressEvent as typeof ProgressEvent;
}

// three.js uses `self` when loading textures inside GLTF files; alias it to the
// Node global so SSR can hydrate decoration assets without throwing.
if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis as any;
}

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering()
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

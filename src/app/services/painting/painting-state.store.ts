import * as THREE from 'three';

/**
 * Central holder for painting scene references and render scheduling.
 * History is handled by the shared HistoryService; this store only tracks scene links.
 */
export class PaintingStateStore {
  private sceneRef: THREE.Scene | null = null;
  private cakeBaseRef: THREE.Object3D | null = null;
  private renderScheduler: (() => void) | null = null;

  public setScene(scene: THREE.Scene | null): void {
    this.sceneRef = scene;
  }

  public setCakeBase(cakeBase: THREE.Object3D | null): void {
    this.cakeBaseRef = cakeBase;
  }

  public get scene(): THREE.Scene | null {
    return this.sceneRef;
  }

  public get cakeBase(): THREE.Object3D | null {
    return this.cakeBaseRef;
  }

  public setRenderScheduler(callback: (() => void) | null): void {
    this.renderScheduler = callback;
  }

  public scheduleRender(): void {
    this.renderScheduler?.();
  }

  public get paintParent(): THREE.Object3D | null {
    return this.cakeBaseRef ?? this.sceneRef;
  }
}

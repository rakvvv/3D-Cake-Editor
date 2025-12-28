import * as THREE from 'three';

/**
 * Central holder for painting scene references and history stacks.
 * Keeps undo/redo bookkeeping away from the facade so tools can share access.
 */
export class PaintingStateStore {
  private sceneRef: THREE.Scene | null = null;
  private cakeBaseRef: THREE.Object3D | null = null;
  private undoStack: THREE.Object3D[] = [];
  private redoStack: THREE.Object3D[] = [];
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

  public pushUndo(object: THREE.Object3D): void {
    this.undoStack.push(object);
  }

  public popUndo(): THREE.Object3D | undefined {
    return this.undoStack.pop();
  }

  public get hasUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public clearUndo(): void {
    this.undoStack = [];
  }

  public pushRedo(object: THREE.Object3D): void {
    this.redoStack.push(object);
  }

  public popRedo(): THREE.Object3D | undefined {
    return this.redoStack.pop();
  }

  public get hasRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clearRedo(): void {
    this.redoStack = [];
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

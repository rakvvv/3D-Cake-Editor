import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformManagerService } from './transform-manager.service';
import { SelectionService } from './selection.service';

@Injectable({
  providedIn: 'root',
})
export class TransformControlsService {
  constructor(
    private readonly transformManager: TransformManagerService,
    private readonly selectionService: SelectionService,
  ) {}

  public init(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    orbit: OrbitControls,
    boxHelperUpdateCallback?: () => void,
    removeDecorationCallback?: (object: THREE.Object3D) => void,
    copyDecorationCallback?: () => void,
    pasteDecorationCallback?: () => void,
    anchorSnapshotCallback?: (object: THREE.Object3D | null) => void,
  ): void {
    this.transformManager.init(
      scene,
      camera,
      renderer,
      orbit,
      boxHelperUpdateCallback,
      removeDecorationCallback,
      copyDecorationCallback,
      pasteDecorationCallback,
      anchorSnapshotCallback,
    );
  }

  public updateCakeSize(size: number): void {
    this.transformManager.updateCakeSize(size);
  }

  public setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformManager.setTransformMode(mode);
  }

  public attachObject(object: THREE.Object3D): void {
    this.transformManager.attachObject(object);
  }

  public getSelectedObject(): THREE.Object3D | null {
    return this.selectionService.getSelectedObject();
  }

  public lockSelectedObject(): { success: boolean; message: string } {
    return this.transformManager.lockSelectedObject();
  }

  public unlockSelectedObject(): { success: boolean; message: string } {
    return this.transformManager.unlockSelectedObject();
  }

  public isSelectionLocked(): boolean {
    return this.transformManager.isSelectionLocked();
  }

  public deselectObject(): void {
    this.transformManager.deselectObject();
  }

  public isDragging(): boolean {
    return this.transformManager.isDragging();
  }

  public syncLockedSelectionSnapshot(): void {
    this.transformManager.syncLockedSelectionSnapshot();
  }

}

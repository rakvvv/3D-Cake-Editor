import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

@Injectable({
  providedIn: 'root',
})
export class SelectionService {
  private selectedObject: THREE.Object3D | null = null;

  public getSelectedObject(): THREE.Object3D | null {
    return this.selectedObject;
  }

  public selectObject(
    object: THREE.Object3D,
    transformControls: TransformControls,
    boxHelperCallback?: (() => void) | null,
  ): void {
    if (this.selectedObject === object) {
      return;
    }

    this.deselectObject(transformControls, boxHelperCallback);

    this.selectedObject = object;
    transformControls.attach(object);
  }

  public deselectObject(
    transformControls: TransformControls,
    boxHelperCallback?: (() => void) | null,
  ): void {
    if (!this.selectedObject) {
      return;
    }

    transformControls.detach();
    this.selectedObject = null;

    if (boxHelperCallback) {
      boxHelperCallback();
    }
  }

  public removeSelectedObject(
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
    removeCallback: ((object: THREE.Object3D, scene: THREE.Scene, cakeBase: THREE.Object3D | null) => void) | null,
    transformControls: TransformControls,
    boxHelperCallback?: (() => void) | null,
  ): void {
    if (!this.selectedObject) {
      return;
    }

    const objectToRemove = this.selectedObject;

    if (removeCallback) {
      removeCallback(objectToRemove, scene, cakeBase);
    } else {
      if (objectToRemove.parent === cakeBase && cakeBase) {
        cakeBase.remove(objectToRemove);
      }

      scene.remove(objectToRemove);
    }

    transformControls.detach();
    this.selectedObject = null;

    if (boxHelperCallback) {
      boxHelperCallback();
    }
  }

  public clearSelection(): void {
    this.selectedObject = null;
  }
}

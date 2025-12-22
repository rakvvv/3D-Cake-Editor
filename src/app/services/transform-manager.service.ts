import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SelectionService } from './selection.service';
import { SnapService } from './snap.service';
import { TransformManagerState } from './transform-manager/transform-manager.state';
import { TransformEventHandler } from './transform-manager/transform-event-handler';

@Injectable({
  providedIn: 'root',
})
export class TransformManagerService {
  private readonly state = new TransformManagerState();
  private eventHandler!: TransformEventHandler;
  private readonly isBrowser: boolean;

  private readonly renderScene = () => {
    if (!this.state.scene || !this.state.camera || !this.state.renderer) {
      return;
    }

    this.state.renderer.render(this.state.scene, this.state.camera);
  };

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: Object,
    private readonly selectionService: SelectionService,
    private readonly snapService: SnapService,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.eventHandler = new TransformEventHandler(
      this.state,
      this.selectionService,
      this.snapService,
      this.renderScene,
    );
  }

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
    if (!this.isBrowser) {
      return;
    }

    this.state.setSession(scene, camera, renderer, orbit);
    this.state.boxHelperCallback = boxHelperUpdateCallback || null;
    this.state.removeDecorationCallback = removeDecorationCallback || null;
    this.state.copyDecorationCallback = copyDecorationCallback || null;
    this.state.pasteDecorationCallback = pasteDecorationCallback || null;
    this.state.anchorSnapshotCallback = anchorSnapshotCallback || null;

    this.state.orbit?.addEventListener('change', this.renderScene);

    this.state.transformControls = new TransformControls(camera, renderer.domElement);
    this.state.transformControls.space = 'world';
    this.state.transformControls.mode = 'translate';

    this.state.transformControls.addEventListener('change', this.eventHandler.onTransformChange);
    this.state.transformControls.addEventListener('dragging-changed', this.eventHandler.onDraggingChanged);

    const gizmo = this.state.transformControls.getHelper();
    this.state.scene?.add(gizmo);

    window.addEventListener('keydown', this.eventHandler.onKeyDown);
  }

  public updateCakeSize(size: number): void {
    this.state.cakeSize = size;
  }

  public setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    if (!this.state.transformControls) {
      return;
    }

    this.state.transformControls.mode = mode;
    console.log(`TransformControls mode set to: ${mode}, enabled: ${this.state.transformControls.enabled}`);
    this.renderScene();
  }

  public attachObject(object: THREE.Object3D): void {
    const transformControls = this.state.transformControls;
    const scene = this.state.scene;
    if (!transformControls || !scene) {
      return;
    }

    const inSceneGraph = this.isObjectInSceneGraph(object);
    if (!inSceneGraph) {
      console.warn('TransformControls: Ignoring attachment for object outside the scene graph.', object);
      return;
    }

    const cakeBase = this.snapService.getCakeBase();
    if (cakeBase && object === cakeBase) {
      this.deselectObject();
      return;
    }

    const locked = this.isTransformLocked(object);
    transformControls.enabled = !locked;
    if (locked) {
      this.state.lockedSelection.object = object;
      this.state.lockedSelection.position.copy(object.position);
      this.state.lockedSelection.quaternion.copy(object.quaternion);
      this.state.lockedSelection.scale.copy(object.scale);
      transformControls.detach();
      this.selectionService.selectObject(object, transformControls, this.state.boxHelperCallback, false);
      return;
    }

    this.state.lockedSelection.object = null;
    this.selectionService.selectObject(object, transformControls, this.state.boxHelperCallback, true);
  }

  public deselectObject(): void {
    if (!this.state.transformControls) {
      return;
    }

    this.state.lockedSelection.object = null;
    this.selectionService.deselectObject(this.state.transformControls, this.state.boxHelperCallback);
    this.state.wasDragging = false;
    this.state.transformControls.dragging = false;
  }

  public isDragging(): boolean {
    return this.state.transformControls?.dragging === true;
  }

  public getSelectedObject(): THREE.Object3D | null {
    return this.selectionService.getSelectedObject();
  }

  public getTransformControls(): TransformControls | null {
    return this.state.transformControls || null;
  }

  public lockSelectedObject(): { success: boolean; message: string } {
    const selected = this.selectionService.getSelectedObject();
    if (!selected || !this.state.transformControls) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    selected.userData['isTransformLocked'] = true;
    this.state.lockedSelection.object = selected;
    this.state.lockedSelection.position.copy(selected.position);
    this.state.lockedSelection.quaternion.copy(selected.quaternion);
    this.state.lockedSelection.scale.copy(selected.scale);
    this.state.transformControls.enabled = false;
    this.state.transformControls.detach();
    this.selectionService.selectObject(selected, this.state.transformControls, this.state.boxHelperCallback, false);

    return { success: true, message: 'Dekoracja została zablokowana przed przypadkowym przesunięciem.' };
  }

  public unlockSelectedObject(): { success: boolean; message: string } {
    const selected = this.selectionService.getSelectedObject();
    if (!selected || !this.state.transformControls) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    if (!selected.userData['isTransformLocked']) {
      return { success: false, message: 'Ta dekoracja nie jest zablokowana.' };
    }

    selected.userData['isTransformLocked'] = false;
    this.state.lockedSelection.object = null;
    this.state.transformControls.enabled = true;
    this.selectionService.selectObject(selected, this.state.transformControls, this.state.boxHelperCallback, true);

    return { success: true, message: 'Zablokowanie dekoracji zostało wyłączone.' };
  }

  public isSelectionLocked(): boolean {
    const selected = this.selectionService.getSelectedObject();
    return Boolean(selected?.userData['isTransformLocked']);
  }

  public removeDecorationObject(object: THREE.Object3D): void {
    if (!object) {
      return;
    }

    const selected = this.selectionService.getSelectedObject();
    if (selected === object && this.state.transformControls) {
      this.selectionService.deselectObject(this.state.transformControls, this.state.boxHelperCallback);
    }

    if (this.state.removeDecorationCallback) {
      this.state.removeDecorationCallback(object);
      return;
    }

    if (!this.state.scene) {
      return;
    }

    const cakeBase = this.snapService.getCakeBase();
    if (cakeBase && object.parent === cakeBase) {
      this.state.scene.attach(object);
    }

    this.state.scene.remove(object);
  }

  public dispose(): void {
    if (!this.isBrowser || !this.state.transformControls) {
      return;
    }

    window.removeEventListener('keydown', this.eventHandler.onKeyDown);
    this.state.orbit?.removeEventListener('change', this.renderScene);
    this.state.transformControls.removeEventListener('change', this.eventHandler.onTransformChange);
    this.state.transformControls.removeEventListener('dragging-changed', this.eventHandler.onDraggingChanged);

    this.state.transformControls.dispose();
    this.selectionService.clearSelection();
    this.state.resetCallbacks();
    this.state.wasDragging = false;
  }

  public syncLockedSelectionSnapshot(): void {
    if (!this.state.lockedSelection.object) {
      return;
    }

    this.state.lockedSelection.position.copy(this.state.lockedSelection.object.position);
    this.state.lockedSelection.quaternion.copy(this.state.lockedSelection.object.quaternion);
    this.state.lockedSelection.scale.copy(this.state.lockedSelection.object.scale);
  }

  private isTransformLocked(object: THREE.Object3D): boolean {
    return (
      object.userData['isPaintStroke'] === true ||
      object.userData['isPaintDecoration'] === true ||
      object.userData['isTransformLocked'] === true
    );
  }

  private isObjectInSceneGraph(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current === this.state.scene) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
}

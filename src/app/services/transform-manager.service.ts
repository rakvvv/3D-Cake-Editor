import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SelectionService } from './selection.service';
import { SnapService } from './snap.service';

@Injectable({
  providedIn: 'root',
})
export class TransformManagerService {
  private transformControls!: TransformControls;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;
  private orbit!: OrbitControls;
  private boxHelperCallback: (() => void) | null = null;
  private removeDecorationCallback: ((object: THREE.Object3D) => void) | null = null;
  private copyDecorationCallback: (() => void) | null = null;
  private pasteDecorationCallback: (() => void) | null = null;
  private cakeSize = 1;
  private lockedSelection: {
    object: THREE.Object3D | null;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  } = {
    object: null,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
  private readonly isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: Object,
    private readonly selectionService: SelectionService,
    private readonly snapService: SnapService,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
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
  ): void {
    if (!this.isBrowser) {
      return;
    }

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit;
    this.boxHelperCallback = boxHelperUpdateCallback || null;
    this.removeDecorationCallback = removeDecorationCallback || null;
    this.copyDecorationCallback = copyDecorationCallback || null;
    this.pasteDecorationCallback = pasteDecorationCallback || null;

    this.orbit.addEventListener('change', this.renderScene);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.space = 'local';
    this.transformControls.mode = 'translate';

    this.transformControls.addEventListener('change', this.onTransformChange);
    this.transformControls.addEventListener('dragging-changed', this.onDraggingChanged);

    const gizmo = this.transformControls.getHelper();
    this.scene.add(gizmo);

    window.addEventListener('keydown', this.onKeyDown);
  }

  public updateCakeSize(size: number): void {
    this.cakeSize = size;
  }

  public setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    if (!this.transformControls) {
      return;
    }

    this.transformControls.mode = mode;
    console.log(`TransformControls mode set to: ${mode}, enabled: ${this.transformControls.enabled}`);
    this.renderScene();
  }

  public attachObject(object: THREE.Object3D): void {
    if (!this.transformControls) {
      return;
    }

    const locked = this.isTransformLocked(object);
    this.transformControls.enabled = true;
    if (locked) {
      this.lockedSelection.object = object;
      this.lockedSelection.position.copy(object.position);
      this.lockedSelection.quaternion.copy(object.quaternion);
      this.lockedSelection.scale.copy(object.scale);
    } else {
      this.lockedSelection.object = null;
    }
    this.selectionService.selectObject(
      object,
      this.transformControls,
      this.boxHelperCallback,
      true,
    );
  }

  public deselectObject(): void {
    if (!this.transformControls) {
      return;
    }

    this.lockedSelection.object = null;
    this.selectionService.deselectObject(this.transformControls, this.boxHelperCallback);
  }

  public isDragging(): boolean {
    return this.transformControls?.dragging === true;
  }

  public getSelectedObject(): THREE.Object3D | null {
    return this.selectionService.getSelectedObject();
  }

  public getTransformControls(): TransformControls | null {
    return this.transformControls || null;
  }

  public removeDecorationObject(object: THREE.Object3D): void {
    if (!object) {
      return;
    }

    const selected = this.selectionService.getSelectedObject();
    if (selected === object && this.transformControls) {
      this.selectionService.deselectObject(this.transformControls, this.boxHelperCallback);
    }

    if (this.removeDecorationCallback) {
      this.removeDecorationCallback(object);
      return;
    }

    if (!this.scene) {
      return;
    }

    const cakeBase = this.snapService.getCakeBase();
    if (cakeBase && object.parent === cakeBase) {
      this.scene.attach(object);
    }

    this.scene.remove(object);
  }

  public dispose(): void {
    if (!this.isBrowser || !this.transformControls) {
      return;
    }

    window.removeEventListener('keydown', this.onKeyDown);
    this.orbit?.removeEventListener('change', this.renderScene);
    this.transformControls.removeEventListener('change', this.onTransformChange);
    this.transformControls.removeEventListener('dragging-changed', this.onDraggingChanged);

    this.transformControls.dispose();
    this.selectionService.clearSelection();
    this.boxHelperCallback = null;
    this.removeDecorationCallback = null;
    this.copyDecorationCallback = null;
    this.pasteDecorationCallback = null;
  }

  private renderScene = () => {
    if (!this.scene || !this.camera || !this.renderer) {
      return;
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onTransformChange = () => {
    this.renderScene();

    if (this.boxHelperCallback) {
      this.boxHelperCallback();
    }

    const selectedObject = this.selectionService.getSelectedObject();
    if (selectedObject && this.transformControls) {
      if (this.lockedSelection.object === selectedObject) {
        selectedObject.position.copy(this.lockedSelection.position);
        selectedObject.quaternion.copy(this.lockedSelection.quaternion);
        selectedObject.scale.copy(this.lockedSelection.scale);
        selectedObject.updateMatrixWorld(true);
        this.snapService.enforceSnappedPosition(selectedObject);
        return;
      }

      const mode = this.transformControls.mode;
      if (mode === 'translate' || mode === 'scale') {
        this.snapService.enforceSnappedPosition(selectedObject);
      }
    }
  };

  private onDraggingChanged = (event: THREE.Event) => {
    const draggingValue = (event as THREE.Event & { value: boolean }).value;

    this.orbit.enabled = !draggingValue;

    if (!draggingValue && this.transformControls) {
      const selectedObject = this.selectionService.getSelectedObject();
      if (!selectedObject) {
        return;
      }

      const mode = this.transformControls.mode;
      if (mode === 'rotate') {
        this.snapService.captureSnappedOrientation(selectedObject);
      } else if (mode === 'translate' || mode === 'scale') {
        this.snapService.enforceSnappedPosition(selectedObject);
      }
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const selectedObject = this.selectionService.getSelectedObject();

    if ((event.key === 'c' || event.key === 'C') && (event.ctrlKey || event.metaKey)) {
      if (this.copyDecorationCallback && selectedObject) {
        event.preventDefault();
        this.copyDecorationCallback();
      }
      return;
    }

    if ((event.key === 'v' || event.key === 'V') && (event.ctrlKey || event.metaKey)) {
      if (this.pasteDecorationCallback) {
        event.preventDefault();
        this.pasteDecorationCallback();
      }
      return;
    }

    if (!selectedObject) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const cakeBase = this.snapService.getCakeBase();
      this.selectionService.removeSelectedObject(
        this.scene,
        cakeBase,
        (object) => {
          if (this.removeDecorationCallback) {
            this.removeDecorationCallback(object);
            return;
          }

          if (cakeBase && object.parent === cakeBase) {
            this.scene.attach(object);
          }

          this.scene.remove(object);
        },
        this.transformControls,
        this.boxHelperCallback,
      );
    }
  };

  private isTransformLocked(object: THREE.Object3D): boolean {
    return object.userData['isPaintStroke'] === true || object.userData['isPaintDecoration'] === true;
  }
}

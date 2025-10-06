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
  private cakeSize = 1;
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
  ): void {
    if (!this.isBrowser) {
      return;
    }

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit;
    this.boxHelperCallback = boxHelperUpdateCallback || null;

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

    this.selectionService.selectObject(object, this.transformControls, this.boxHelperCallback);
  }

  public deselectObject(): void {
    if (!this.transformControls) {
      return;
    }

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
    if (selectedObject) {
      this.snapService.enforceSnappedPosition(selectedObject);
    }
  };

  private onDraggingChanged = (event: THREE.Event) => {
    const draggingValue = (event as THREE.Event & { value: boolean }).value;

    this.orbit.enabled = !draggingValue;

  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const selectedObject = this.selectionService.getSelectedObject();

    if (!selectedObject) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.selectionService.removeSelectedObject(
        this.scene,
        null,
        () => {},
        this.transformControls,
        this.boxHelperCallback,
      );
    }
  };
}

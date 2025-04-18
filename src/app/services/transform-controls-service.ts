import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isPlatformBrowser } from '@angular/common';
import { ThreeObjectsFactory } from './three-objects.factory';
import { ThreeSceneService } from './three-scene.service';

@Injectable({
  providedIn: 'root',
})
export class TransformControlsService {
  private transformControls!: TransformControls;
  private selectedObject: THREE.Object3D | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;
  private orbit!: OrbitControls;
  private cakeSize = 1;
  private previousPosition!: THREE.Vector3;
  private cakeBase: THREE.Object3D | null = null;


  constructor(
    @Inject(PLATFORM_ID) 
    private platformId: Object,
    ) {}

  public init(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, orbit: OrbitControls): void {
    if (!isPlatformBrowser(this.platformId)) return;

  
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit

    orbit.addEventListener('change', () => {
      this.renderer.render(this.scene, this.camera);
    });
  
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
  
    this.transformControls.addEventListener('change', () => {
      this.renderer.render(this.scene, this.camera);
      if (this.selectedObject && this.selectedObject.parent === this.cakeBase) {
      const localPos = this.selectedObject.position.clone();

      localPos.x = THREE.MathUtils.clamp(localPos.x, -2, 2);
      localPos.y = THREE.MathUtils.clamp(localPos.y, 0, 5);
      localPos.z = THREE.MathUtils.clamp(localPos.z, -2, 2);

      this.selectedObject.position.copy(localPos);
      }
    });
  
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.changeOrbitControls(!event.value);
    });

    this.transformControls.addEventListener('mouseDown', () => {
      if (this.selectedObject && this.selectedObject.parent === this.cakeBase) {
        this.previousPosition.copy(this.selectedObject.position);
      }
    });
    
    const gizmo = this.transformControls.getHelper();
		this.scene.add(gizmo);


  
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  public attachObject(object: THREE.Object3D): void {
    if (this.selectedObject === object) {
      return;
    }
    console.log('Przypinam obiekt do TransformControls:', object);
    if (this.selectedObject) {
      this.deselectObject();
    }
  
    this.selectedObject = object;
    this.transformControls.attach(object);
  }

  public getSelectedObject(): THREE.Object3D | null {
    return this.selectedObject;
  }

  public deselectObject(): void {
    if (this.selectedObject) {
      this.transformControls.detach();
      this.selectedObject = null;
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.selectedObject) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.scene.remove(this.selectedObject);
      this.selectedObject = null;
      this.transformControls.detach();
    }
  }

  private changeOrbitControls(value: boolean): void {
    this.orbit.enabled = value;
  }

  public isDragging(): boolean {
    return (this.transformControls as any).dragging === true;
  }

  public isAttachedToCake(object: THREE.Object3D): void {

  }

  public detachFromCake(object: THREE.Object3D): void {

  }

  public updateCakeSize(size: number): void {
    this.cakeSize = size;
  }

  public setCakeBase(cake: THREE.Object3D): void {
    this.cakeBase = cake;
  }
}

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Injectable({ providedIn: 'root' })
export class SceneInitService {
  public scene!: THREE.Scene;
  public camera!: THREE.Camera;
  public renderer!: THREE.WebGLRenderer;
  public orbit!: OrbitControls;
  public cameraMode: 'perspective' | 'orthographic' = 'perspective';
  public cameraPreset: 'default' | 'isometric' | 'top' | 'front' | 'right' = 'default';
  private initialCameraPosition = new THREE.Vector3();
  private initialOrbitTarget = new THREE.Vector3();
  private orbitInteracting = false;
  private lastOrbitInteractionTime = 0;
  private orbitChangedDuringInteraction = false;
  private backgroundMode: 'light' | 'dark' = 'dark';
  private readonly lightBackground = new THREE.Color(0xffffff);
  private readonly darkBackground = new THREE.Color(0x2d2d2d);
  private perspectiveCamera!: THREE.PerspectiveCamera;
  private orthographicCamera!: THREE.OrthographicCamera;
  private container?: HTMLElement;
  private baseMinPolarAngle = THREE.MathUtils.degToRad(10);
  private baseMaxPolarAngle = THREE.MathUtils.degToRad(170);
  private lockHorizontalOrbit = false;

  public init(container: HTMLElement): void {
    this.container = container;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyBackgroundMode(this.backgroundMode);
    container.appendChild(this.renderer.domElement);

    this.createCameras(container.clientWidth, container.clientHeight);
    this.camera = this.perspectiveCamera;
    this.camera.position.set(-10, 30, 30);
    this.initialCameraPosition.copy(this.camera.position);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enablePan = true;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 150;
    this.orbit.minPolarAngle = this.baseMinPolarAngle;
    this.orbit.maxPolarAngle = this.baseMaxPolarAngle;
    this.initialOrbitTarget.copy(this.orbit.target);

    this.orbit.addEventListener('start', () => {
      this.orbitInteracting = true;
      this.orbitChangedDuringInteraction = false;
    });
    this.orbit.addEventListener('change', () => {
      this.orbitChangedDuringInteraction = true;
      this.markOrbitInteraction();
    });
    this.orbit.addEventListener('end', () => {
      this.orbitInteracting = false;
      if (this.orbitChangedDuringInteraction) {
        this.markOrbitInteraction();
      } else {
        this.lastOrbitInteractionTime = 0;
      }
    });

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(10, 20, 10);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.camera.near = 0.1;
    directional.shadow.camera.far = 100;
    this.scene.add(directional);

    this.animate();

    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  private createCameras(width: number, height: number): void {
    const aspect = width / height;
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);

    const frustumHeight = 32;
    const frustumWidth = frustumHeight * aspect;
    this.orthographicCamera = new THREE.OrthographicCamera(
      -frustumWidth / 2,
      frustumWidth / 2,
      frustumHeight / 2,
      -frustumHeight / 2,
      -1000,
      1000,
    );
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  public toggleBackgroundMode(): 'light' | 'dark' {
    const nextMode = this.backgroundMode === 'light' ? 'dark' : 'light';
    this.setBackgroundMode(nextMode);
    return this.backgroundMode;
  }

  public setBackgroundMode(mode: 'light' | 'dark'): void {
    this.backgroundMode = mode;
    this.applyBackgroundMode(mode);
  }

  public getBackgroundMode(): 'light' | 'dark' {
    return this.backgroundMode;
  }

  private applyBackgroundMode(mode: 'light' | 'dark'): void {
    const background = mode === 'light' ? this.lightBackground : this.darkBackground;
    this.scene.background = background;
    this.renderer?.setClearColor(background);
  }

  public resetCameraView(): void {
    if (!this.camera || !this.orbit) {
      return;
    }

    this.camera.position.copy(this.initialCameraPosition);
    this.camera.lookAt(this.initialOrbitTarget);
    this.orbit.target.copy(this.initialOrbitTarget);
    this.orbit.update();
  }

  public updateOrbitForCake(totalHeight: number): void {
    if (!this.orbit || !this.camera) {
      return;
    }

    const clampedHeight = Math.max(totalHeight, 0.5);
    const targetY = clampedHeight / 2;
    this.orbit.target.set(0, targetY, 0);
    this.camera.lookAt(this.orbit.target);

    const normalizedHeight = THREE.MathUtils.clamp(clampedHeight / 20, 0, 1);
    const minAngleDeg = 15 - normalizedHeight * 10;
    const maxAngleDeg = 165 + normalizedHeight * 10;

    if (!this.lockHorizontalOrbit) {
      this.orbit.minPolarAngle = THREE.MathUtils.degToRad(minAngleDeg);
      this.orbit.maxPolarAngle = THREE.MathUtils.degToRad(maxAngleDeg);
    }

    this.initialOrbitTarget.copy(this.orbit.target);
    this.orbit.update();
  }

  public setOrbitEnabled(enabled: boolean): void {
    if (!this.orbit) {
      return;
    }

    this.orbit.enabled = enabled;
  }

  private markOrbitInteraction(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.lastOrbitInteractionTime = now;
  }

  public isOrbitBusy(bufferMs = 200): boolean {
    if (this.orbitInteracting) {
      return true;
    }

    if (!this.lastOrbitInteractionTime) {
      return false;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return now - this.lastOrbitInteractionTime < bufferMs;
  }

  public setCameraMode(mode: 'perspective' | 'orthographic'): void {
    if (this.cameraMode === mode) {
      return;
    }

    this.cameraMode = mode;
    const currentPosition = this.camera.position.clone();
    const currentUp = this.camera.up.clone();
    const target = this.orbit?.target.clone() ?? new THREE.Vector3();

    this.camera = mode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
    this.camera.position.copy(currentPosition);
    this.camera.up.copy(currentUp);
    this.camera.lookAt(target);
    if (mode === 'orthographic') {
      this.adjustOrthographicZoomToDistance();
    }

    if (this.orbit) {
      this.orbit.object = this.camera as THREE.Camera;
      this.orbit.update();
    }
  }

  public setCameraPreset(preset: 'default' | 'isometric' | 'top' | 'front' | 'right'): void {
    this.cameraPreset = preset;
    const target = this.orbit?.target ?? new THREE.Vector3();

    if (preset === 'default') {
      this.setCameraMode('perspective');
      this.camera.position.copy(this.initialCameraPosition);
      this.camera.up.set(0, 1, 0);
    } else if (preset === 'isometric') {
      this.setCameraMode('orthographic');
      this.camera.position.set(18, 18, 18);
    } else if (preset === 'top') {
      this.setCameraMode('orthographic');
      this.camera.position.set(target.x, target.y + 40, target.z);
      this.camera.up.set(0, 0, -1);
    } else if (preset === 'front') {
      this.setCameraMode('orthographic');
      this.camera.position.set(target.x, target.y + 4, target.z + 40);
      this.camera.up.set(0, 1, 0);
    } else if (preset === 'right') {
      this.setCameraMode('orthographic');
      this.camera.position.set(target.x + 40, target.y + 4, target.z);
      this.camera.up.set(0, 1, 0);
    }

    this.camera.lookAt(target);
    this.adjustOrthographicZoomToDistance();
    this.orbit?.update();
  }

  public setHorizontalOrbitLock(enabled: boolean): void {
    this.lockHorizontalOrbit = enabled;
    if (!this.orbit) {
      return;
    }

    if (enabled) {
      this.orbit.minPolarAngle = Math.PI / 2;
      this.orbit.maxPolarAngle = Math.PI / 2;
    } else {
      this.orbit.minPolarAngle = this.baseMinPolarAngle;
      this.orbit.maxPolarAngle = this.baseMaxPolarAngle;
    }
    this.orbit.update();
  }

  public getOrbitTarget(): THREE.Vector3 {
    return this.orbit?.target.clone() ?? new THREE.Vector3();
  }

  public setOrbitTarget(target: THREE.Vector3): void {
    if (!this.orbit || !this.camera) {
      return;
    }

    this.orbit.target.copy(target);
    this.camera.lookAt(target);
    this.orbit.update();
  }

  public resetOrbitPivot(): void {
    this.setOrbitTarget(this.initialOrbitTarget.clone());
  }

  public adjustOrthographicZoomToDistance(): void {
    if (!(this.camera instanceof THREE.OrthographicCamera)) {
      return;
    }

    const distance = this.camera.position.length();
    const base = 25;
    this.camera.zoom = Math.max(0.4, Math.min(4, base / Math.max(distance, 1)));
    this.camera.updateProjectionMatrix();
  }

  public handleResize(): void {
    if (!this.container) {
      return;
    }

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = width / height;
    this.renderer.setSize(width, height);

    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const frustumHeight = 32;
    const frustumWidth = frustumHeight * aspect;
    this.orthographicCamera.left = -frustumWidth / 2;
    this.orthographicCamera.right = frustumWidth / 2;
    this.orthographicCamera.top = frustumHeight / 2;
    this.orthographicCamera.bottom = -frustumHeight / 2;
    this.orthographicCamera.updateProjectionMatrix();

    if (this.cameraMode === 'orthographic') {
      this.adjustOrthographicZoomToDistance();
    }
  }
}

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Injectable({ providedIn: 'root' })
export class SceneInitService {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  public orbit!: OrbitControls;
  private initialCameraPosition = new THREE.Vector3();
  private initialOrbitTarget = new THREE.Vector3();
  private orbitInteracting = false;
  private lastOrbitInteractionTime = 0;
  private orbitChangedDuringInteraction = false;

  public init(container: HTMLElement): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(-10, 30, 30);
    this.camera.layers.enable(0);
    this.camera.layers.enable(2);
    this.initialCameraPosition.copy(this.camera.position);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enablePan = true;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 150;
    this.orbit.minPolarAngle = THREE.MathUtils.degToRad(10);
    this.orbit.maxPolarAngle = THREE.MathUtils.degToRad(170);
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
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
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

    this.orbit.minPolarAngle = THREE.MathUtils.degToRad(minAngleDeg);
    this.orbit.maxPolarAngle = THREE.MathUtils.degToRad(maxAngleDeg);

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
}

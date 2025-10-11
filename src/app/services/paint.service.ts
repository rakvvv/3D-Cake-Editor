import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { DecorationFactory } from '../factories/decoration.factory';

type PaintTool = 'decoration' | 'pen';

@Injectable({ providedIn: 'root' })
export class PaintService {
  public paintMode = false;
  public currentBrush = 'trawa.glb';
  public isPainting = false;
  public paintTool: PaintTool = 'decoration';

  public penSize = 0.05;
  public penThickness = 0.02;
  public penColor = '#ff4d6d';

  private readonly baseMinDistance = 0.02;
  private readonly baseMinTimeMs = 40;
  private readonly penSurfaceOffset = 0.003;

  private brushCache = new Map<string, THREE.Object3D>();
  private brushPromises = new Map<string, Promise<THREE.Object3D>>();

  private penMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private penSphereGeometry = new THREE.SphereGeometry(0.5, 16, 16);
  private penCylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

  private lastPaintPoint: THREE.Vector3 | null = null;
  private lastPaintNormal: THREE.Vector3 | null = null;
  private lastPaintTime = 0;

  public async handlePaint(
    event: MouseEvent,
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
    mouse: THREE.Vector2,
    raycaster: THREE.Raycaster,
  ): Promise<void> {
    if (!cakeBase || !this.paintMode) {
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(cakeBase, true);

    if (intersects.length === 0) {
      return;
    }

    const hit = intersects[0];
    const pointOnCakeWorld = hit.point.clone();
    const normal = this.getWorldNormal(hit) ?? new THREE.Vector3(0, 1, 0);

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const previousPoint = this.lastPaintPoint ? this.lastPaintPoint.clone() : null;
    const previousNormal = this.lastPaintNormal ? this.lastPaintNormal.clone() : null;

    if (previousPoint) {
      const distance = pointOnCakeWorld.distanceTo(previousPoint);
      const timeDelta = now - this.lastPaintTime;
      const minDistance = this.getMinDistanceThreshold();
      if (distance < minDistance && timeDelta < this.baseMinTimeMs) {
        return;
      }
    }

    try {
      if (this.paintTool === 'decoration') {
        await this.placeDecorationBrush(pointOnCakeWorld, normal, scene);
      } else {
        this.placePenStroke(pointOnCakeWorld, normal, previousPoint, previousNormal, scene);
      }

      this.lastPaintPoint = pointOnCakeWorld.clone();
      this.lastPaintNormal = normal.clone();
      this.lastPaintTime = now;
    } catch (error) {
      console.error('Paint: błąd procesu malowania:', error);
    }
  }

  public beginStroke(): void {
    this.isPainting = true;
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
    this.lastPaintTime = 0;
  }

  public endStroke(): void {
    this.isPainting = false;
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
  }

  public setPaintTool(tool: PaintTool): void {
    this.paintTool = tool;
  }

  public setCurrentBrush(brushId: string): void {
    this.currentBrush = brushId;
  }

  public updatePenSettings(settings: { size?: number; thickness?: number; color?: string }): void {
    if (settings.size !== undefined && settings.size > 0) {
      this.penSize = settings.size;
    }

    if (settings.thickness !== undefined && settings.thickness > 0) {
      this.penThickness = settings.thickness;
    }

    if (settings.color) {
      this.penColor = settings.color;
    }
  }

  private async placeDecorationBrush(point: THREE.Vector3, normal: THREE.Vector3, scene: THREE.Scene): Promise<void> {
    const brushModel = await this.getBrushInstance(this.currentBrush);

    const box = new THREE.Box3().setFromObject(brushModel);
    const center = new THREE.Vector3();
    box.getCenter(center);
    brushModel.position.sub(center);

    brushModel.position.copy(point);
    const offset = normal.clone().multiplyScalar(0.005);
    brushModel.position.add(offset);

    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone());
    brushModel.quaternion.copy(quaternion);
    brushModel.rotation.y = Math.random() * Math.PI * 2;

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scaleFactor = 0.5 / maxDim;
      brushModel.scale.setScalar(scaleFactor);
    }

    scene.add(brushModel);
    brushModel.userData['isSnapped'] = true;
  }

  private placePenStroke(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    previousPoint: THREE.Vector3 | null,
    previousNormal: THREE.Vector3 | null,
    scene: THREE.Scene,
  ): void {
    const currentOffsetNormal = normal.clone().normalize();
    const currentPosition = point.clone().add(currentOffsetNormal.clone().multiplyScalar(this.penSurfaceOffset));

    if (!previousPoint) {
      const cap = this.createPenCap();
      cap.position.copy(currentPosition);
      scene.add(cap);
      return;
    }

    const startNormal = (previousNormal ?? normal).clone().normalize();
    const startPosition = previousPoint.clone().add(startNormal.clone().multiplyScalar(this.penSurfaceOffset));

    const segmentVector = currentPosition.clone().sub(startPosition);
    const totalDistance = segmentVector.length();

    if (totalDistance === 0) {
      const cap = this.createPenCap();
      cap.position.copy(currentPosition);
      scene.add(cap);
      return;
    }

    const maxSegmentLength = Math.max(this.penSize * 0.5, this.baseMinDistance);
    const steps = Math.max(1, Math.ceil(totalDistance / maxSegmentLength));
    const direction = segmentVector.clone().normalize();

    let segmentStart = startPosition.clone();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const segmentEnd = startPosition.clone().add(direction.clone().multiplyScalar(totalDistance * t));
      const delta = segmentEnd.clone().sub(segmentStart);
      const length = delta.length();
      if (length === 0) {
        continue;
      }

      const segment = this.createPenSegment(length);
      const mid = segmentStart.clone().add(segmentEnd).multiplyScalar(0.5);
      segment.position.copy(mid);

      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
      segment.quaternion.copy(quaternion);

      scene.add(segment);
      segmentStart = segmentEnd;
    }

    const cap = this.createPenCap();
    cap.position.copy(currentPosition);
    scene.add(cap);
  }

  private async getBrushInstance(brushId: string): Promise<THREE.Object3D> {
    const template = await this.loadBrushTemplate(brushId);
    return this.cloneBrush(template);
  }

  private loadBrushTemplate(brushId: string): Promise<THREE.Object3D> {
    const cached = this.brushCache.get(brushId);
    if (cached) {
      return Promise.resolve(cached);
    }

    const inFlight = this.brushPromises.get(brushId);
    if (inFlight) {
      return inFlight;
    }

    const promise = DecorationFactory.loadDecorationModel(`/models/${brushId}`)
      .then((model) => {
        this.brushCache.set(brushId, model);
        this.brushPromises.delete(brushId);
        return model;
      })
      .catch((error) => {
        this.brushPromises.delete(brushId);
        throw error;
      });

    this.brushPromises.set(brushId, promise);
    return promise;
  }

  private cloneBrush(template: THREE.Object3D): THREE.Object3D {
    const clone = template.clone(true);
    const meshes: THREE.Mesh[] = [];

    clone.traverse((node) => {
      node.userData = { ...node.userData };

      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry = mesh.geometry.clone();
        }

        const originalMaterial = mesh.material;
        if (Array.isArray(originalMaterial)) {
          mesh.material = originalMaterial.map((mat) => mat.clone()) as THREE.Material[];
        } else if (originalMaterial) {
          mesh.material = originalMaterial.clone();
        }

        meshes.push(mesh);
      }
    });

    if (meshes.length) {
      clone.userData['clickableMeshes'] = meshes;
    }

    return clone;
  }

  private createPenCap(): THREE.Mesh {
    const material = this.getPenMaterial();
    const cap = new THREE.Mesh(this.penSphereGeometry, material);
    cap.scale.setScalar(this.penSize);
    cap.userData['isPaintStroke'] = true;
    cap.castShadow = true;
    cap.receiveShadow = true;
    return cap;
  }

  private createPenSegment(length: number): THREE.Mesh {
    const material = this.getPenMaterial();
    const segment = new THREE.Mesh(this.penCylinderGeometry, material);
    segment.scale.set(this.penThickness, length, this.penThickness);
    segment.userData['isPaintStroke'] = true;
    segment.castShadow = true;
    segment.receiveShadow = true;
    return segment;
  }

  private getPenMaterial(): THREE.MeshStandardMaterial {
    const cached = this.penMaterialCache.get(this.penColor);
    if (cached) {
      return cached;
    }

    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.penColor) });
    material.roughness = 0.6;
    material.metalness = 0.1;
    this.penMaterialCache.set(this.penColor, material);
    return material;
  }

  private getWorldNormal(intersection: THREE.Intersection): THREE.Vector3 | null {
    if (!intersection.face) {
      return null;
    }

    const normal = intersection.face.normal.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld);
    return normal.applyMatrix3(normalMatrix).normalize();
  }

  private getMinDistanceThreshold(): number {
    if (this.paintTool === 'pen') {
      return Math.max(this.penThickness * 0.6, this.baseMinDistance);
    }

    return this.baseMinDistance;
  }
}

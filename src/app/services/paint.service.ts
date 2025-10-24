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
  private readonly maxPenInterpolationSteps = 24;
  private readonly maxPenSmoothingIterations = 2;
  private readonly maxSmoothedStrokePoints = 600;

  private brushCache = new Map<string, THREE.Object3D>();
  private brushPromises = new Map<string, Promise<THREE.Object3D>>();
  private brushSizes = new Map<string, THREE.Vector3>();

  private penMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private penSphereGeometry = new THREE.SphereGeometry(0.5, 16, 12);

  private sceneRef: THREE.Scene | null = null;
  private undoStack: THREE.Object3D[] = [];
  private redoStack: THREE.Object3D[] = [];

  private lastPaintPoint: THREE.Vector3 | null = null;
  private lastPaintNormal: THREE.Vector3 | null = null;
  private lastPaintTime = 0;
  private paintCanvasRect: { left: number; top: number; width: number; height: number } | null = null;

  private activePenStrokeGroup: THREE.Group | null = null;
  private activePenStrokePoints: THREE.Vector3[] = [];
  private activePenCurveMesh: THREE.Mesh | null = null;
  private activePenStartCap: THREE.Mesh | null = null;
  private activePenEndCap: THREE.Mesh | null = null;

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

    this.sceneRef = scene;

    const rect = this.paintCanvasRect ?? renderer.domElement.getBoundingClientRect();
    if (!this.paintCanvasRect) {
      this.paintCanvasRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

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

  public beginStroke(rect: DOMRect): void {
    this.isPainting = true;
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
    this.lastPaintTime = 0;
    this.paintCanvasRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    this.activePenStrokePoints = [];
    this.activePenStrokeGroup = null;
    this.activePenCurveMesh = null;
    this.activePenStartCap = null;
    this.activePenEndCap = null;
  }

  public endStroke(): void {
    this.isPainting = false;
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
    this.paintCanvasRect = null;
    if (this.activePenStrokeGroup) {
      if (this.activePenStrokeGroup.children.length) {
        this.trackPaintAddition(this.activePenStrokeGroup);
      } else if (this.sceneRef) {
        this.sceneRef.remove(this.activePenStrokeGroup);
      }
    }
    this.activePenStrokeGroup = null;
    this.activePenStrokePoints = [];
    this.activePenCurveMesh = null;
    this.activePenStartCap = null;
    this.activePenEndCap = null;
  }

  public setPaintTool(tool: PaintTool): void {
    this.paintTool = tool;
  }

  public setCurrentBrush(brushId: string): void {
    this.currentBrush = brushId;
  }

  public updatePenSettings(settings: { size?: number; thickness?: number; color?: string }): void {
    if (settings.size !== undefined && settings.size > 0) {
      this.penSize = Math.max(settings.size, 0.005);
    }

    if (settings.thickness !== undefined && settings.thickness > 0) {
      this.penThickness = Math.max(settings.thickness, 0.003);
    }

    if (settings.color) {
      this.penColor = settings.color;
    }
  }

  public registerScene(scene: THREE.Scene): void {
    this.sceneRef = scene;
  }

  public undo(): void {
    if (!this.sceneRef || !this.undoStack.length) {
      return;
    }

    const lastObject = this.undoStack.pop()!;
    this.sceneRef.remove(lastObject);
    this.redoStack.push(lastObject);
  }

  public redo(): void {
    if (!this.sceneRef || !this.redoStack.length) {
      return;
    }

    const object = this.redoStack.pop()!;
    this.sceneRef.add(object);
    this.undoStack.push(object);
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private async placeDecorationBrush(point: THREE.Vector3, normal: THREE.Vector3, scene: THREE.Scene): Promise<void> {
    const brushModel = await this.getBrushInstance(this.currentBrush);
    const brushSize = this.getBrushSize(this.currentBrush, brushModel);

    brushModel.position.copy(point);
    const offset = normal.clone().multiplyScalar(0.005);
    brushModel.position.add(offset);

    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone());
    brushModel.quaternion.copy(quaternion);
    brushModel.rotation.y = Math.random() * Math.PI * 2;

    const maxDim = Math.max(brushSize.x, brushSize.y, brushSize.z);
    if (maxDim > 0) {
      const scaleFactor = 0.5 / maxDim;
      brushModel.scale.setScalar(scaleFactor);
    }

    brushModel.updateMatrixWorld(true);
    brushModel.matrixAutoUpdate = false;

    scene.add(brushModel);
    brushModel.userData['isSnapped'] = true;
    brushModel.userData['isPaintDecoration'] = true;
    this.trackPaintAddition(brushModel);
  }

  private placePenStroke(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    previousPoint: THREE.Vector3 | null,
    previousNormal: THREE.Vector3 | null,
    scene: THREE.Scene,
  ): void {
    const strokeGroup = this.ensureActivePenGroup(scene);
    const currentOffsetNormal = normal.clone().normalize();
    const currentPosition = point.clone().add(currentOffsetNormal.clone().multiplyScalar(this.penSurfaceOffset));

    if (!previousPoint) {
      this.activePenStrokePoints = [currentPosition.clone()];
      this.ensurePenStartCap(currentPosition, strokeGroup);
      this.refreshPenCurve(strokeGroup);
      this.updatePenEndCap(currentPosition, strokeGroup);
      return;
    }

    const startNormal = (previousNormal ?? normal).clone().normalize();
    const startPosition = previousPoint.clone().add(startNormal.clone().multiplyScalar(this.penSurfaceOffset));

    if (!this.activePenStrokePoints.length) {
      this.activePenStrokePoints.push(startPosition.clone());
    }

    if (this.activePenStrokePoints.length === 1) {
      this.activePenStrokePoints[0] = startPosition.clone();
    }

    const lastPoint = this.activePenStrokePoints[this.activePenStrokePoints.length - 1];
    const distance = lastPoint.distanceTo(currentPosition);
    if (distance === 0) {
      this.updatePenEndCap(currentPosition, strokeGroup);
      return;
    }

    this.insertInterpolatedPenPoints(lastPoint, currentPosition, distance);
    this.activePenStrokePoints.push(currentPosition.clone());
    this.refreshPenCurve(strokeGroup);
    this.updatePenEndCap(currentPosition, strokeGroup);
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
        this.brushSizes.set(brushId, this.computeBrushSize(model));
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
        meshes.push(node as THREE.Mesh);
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
    cap.scale.setScalar(this.getPenCapScale());
    cap.userData['isPaintStroke'] = true;
    cap.castShadow = true;
    cap.receiveShadow = true;
    return cap;
  }

  private ensurePenStartCap(position: THREE.Vector3, strokeGroup: THREE.Group): void {
    if (!this.activePenStartCap) {
      this.activePenStartCap = this.createPenCap();
      this.activePenStartCap.matrixAutoUpdate = false;
      strokeGroup.add(this.activePenStartCap);
    }

    this.activePenStartCap.material = this.getPenMaterial();
    this.activePenStartCap.scale.setScalar(this.getPenCapScale());
    this.activePenStartCap.position.copy(position);
    this.activePenStartCap.updateMatrix();
  }

  private refreshPenCurve(strokeGroup: THREE.Group): void {
    if (!this.activePenCurveMesh) {
      this.activePenCurveMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.getPenMaterial());
      this.activePenCurveMesh.userData['isPaintStroke'] = true;
      this.activePenCurveMesh.castShadow = true;
      this.activePenCurveMesh.receiveShadow = true;
      this.activePenCurveMesh.matrixAutoUpdate = false;
      strokeGroup.add(this.activePenCurveMesh);
    } else {
      this.activePenCurveMesh.material = this.getPenMaterial();
    }

    if (this.activePenStrokePoints.length < 2) {
      this.activePenCurveMesh.visible = false;
      return;
    }

    const workingPoints = this.buildExtendedStrokePoints();
    const radius = this.getPenTubeRadius();
    const curve = new THREE.CatmullRomCurve3(workingPoints, false, 'centripetal', 0.5);
    const strokeLength = this.computePolylineLength(workingPoints);
    const minSegmentLength = Math.max(radius * 0.2, 0.008);
    const tubularSegments = Math.min(512, Math.max(18, Math.ceil(strokeLength / minSegmentLength)));
    const radialSegments = Math.min(64, Math.max(20, Math.ceil(radius * 40)));
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
    geometry.computeVertexNormals();

    const previousGeometry = this.activePenCurveMesh.geometry;
    this.activePenCurveMesh.geometry = geometry;
    previousGeometry.dispose();

    this.activePenCurveMesh.visible = true;
    this.activePenCurveMesh.updateMatrix();
  }

  private getPenTubeRadius(): number {
    return Math.max(this.penThickness, 0.004);
  }

  private getPenMaterial(): THREE.MeshStandardMaterial {
    const cached = this.penMaterialCache.get(this.penColor);
    if (cached) {
      return cached;
    }

    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.penColor) });
    material.roughness = 0.85;
    material.metalness = 0.02;
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
      const thickness = this.getPenTubeRadius();
      const dynamic = thickness * 0.25;
      const clamped = Math.min(this.baseMinDistance * 0.5, dynamic);
      return Math.max(0.001, clamped);
    }

    return this.baseMinDistance;
  }

  private ensureActivePenGroup(scene: THREE.Scene): THREE.Group {
    if (!this.activePenStrokeGroup) {
      this.activePenStrokeGroup = new THREE.Group();
      this.activePenStrokeGroup.userData['isPaintStroke'] = true;
      scene.add(this.activePenStrokeGroup);
      this.redoStack = [];
      this.activePenStrokePoints = [];
      this.activePenCurveMesh = null;
      this.activePenStartCap = null;
      this.activePenEndCap = null;
    }

    return this.activePenStrokeGroup;
  }

  private updatePenEndCap(position: THREE.Vector3, strokeGroup: THREE.Group): void {
    if (!this.activePenEndCap) {
      this.activePenEndCap = this.createPenCap();
      this.activePenEndCap.matrixAutoUpdate = false;
      strokeGroup.add(this.activePenEndCap);
    }

    this.activePenEndCap.material = this.getPenMaterial();
    this.activePenEndCap.scale.setScalar(this.getPenCapScale());
    this.activePenEndCap.position.copy(position);
    this.activePenEndCap.updateMatrix();
  }

  private getPenCapScale(): number {
    const capRadius = this.getPenCapRadius() + this.penSurfaceOffset;
    return capRadius * 2;
  }

  private getPenCapRadius(): number {
    return Math.max(this.penSize, this.getPenTubeRadius());
  }

  private insertInterpolatedPenPoints(
    start: THREE.Vector3,
    end: THREE.Vector3,
    distance: number,
  ): void {
    const radius = this.getPenTubeRadius();
    const minSpacing = Math.max(radius * 0.15, 0.0015);
    const steps = Math.min(this.maxPenInterpolationSteps, Math.floor(distance / minSpacing));
    if (!steps) {
      return;
    }

    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const intermediate = start.clone().lerp(end, t);
      this.activePenStrokePoints.push(intermediate);
    }
  }

  private buildExtendedStrokePoints(): THREE.Vector3[] {
    const cloned = this.activePenStrokePoints.map((point) => point.clone());
    if (cloned.length < 2) {
      return cloned;
    }

    const radius = this.getPenTubeRadius();
    const first = cloned[0];
    const second = cloned[1];
    const startDirection = second.clone().sub(first);
    if (startDirection.lengthSq() > 1e-6) {
      const startExtension = first.clone().sub(startDirection.normalize().multiplyScalar(radius));
      cloned.unshift(startExtension);
    }

    const last = cloned[cloned.length - 1];
    const previous = cloned[cloned.length - 2];
    const endDirection = last.clone().sub(previous);
    if (endDirection.lengthSq() > 1e-6) {
      const endExtension = last.clone().add(endDirection.normalize().multiplyScalar(radius));
      cloned.push(endExtension);
    }

    const smoothed = this.smoothStrokePoints(cloned);
    return smoothed;
  }

  private computePolylineLength(points: THREE.Vector3[]): number {
    if (points.length < 2) {
      return 0;
    }

    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += points[i - 1].distanceTo(points[i]);
    }

    return length;
  }

  private smoothStrokePoints(points: THREE.Vector3[]): THREE.Vector3[] {
    if (points.length < 3) {
      return points;
    }

    let result = points.map((point) => point.clone());
    for (let i = 0; i < this.maxPenSmoothingIterations; i++) {
      if (result.length * 2 > this.maxSmoothedStrokePoints) {
        break;
      }

      const next: THREE.Vector3[] = [result[0].clone()];
      for (let j = 0; j < result.length - 1; j++) {
        const current = result[j];
        const following = result[j + 1];
        const q = current.clone().multiplyScalar(0.75).add(following.clone().multiplyScalar(0.25));
        const r = current.clone().multiplyScalar(0.25).add(following.clone().multiplyScalar(0.75));
        next.push(q, r);
      }
      next.push(result[result.length - 1].clone());
      result = next;
    }

    return result;
  }

  private getBrushSize(brushId: string, model: THREE.Object3D): THREE.Vector3 {
    const cached = this.brushSizes.get(brushId);
    if (cached) {
      return cached;
    }

    const computed = this.computeBrushSize(model);
    this.brushSizes.set(brushId, computed);
    return computed;
  }

  private computeBrushSize(model: THREE.Object3D): THREE.Vector3 {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size;
  }

  private trackPaintAddition(object: THREE.Object3D): void {
    this.undoStack.push(object);
    this.redoStack = [];
  }
}

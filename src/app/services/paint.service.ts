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
  private brushSizes = new Map<string, THREE.Vector3>();

  private penMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private penSphereGeometry = new THREE.SphereGeometry(0.5, 16, 12);
  private penJointGeometry = new THREE.SphereGeometry(0.5, 14, 10);
  private penSegmentGeometryCache = new Map<number, THREE.CylinderGeometry>();

  private sceneRef: THREE.Scene | null = null;
  private undoStack: THREE.Object3D[] = [];
  private redoStack: THREE.Object3D[] = [];

  private lastPaintPoint: THREE.Vector3 | null = null;
  private lastPaintNormal: THREE.Vector3 | null = null;
  private lastPaintTime = 0;
  private paintCanvasRect: { left: number; top: number; width: number; height: number } | null = null;
  private lastPenDirection: THREE.Vector3 | null = null;

  private activePenStrokeGroup: THREE.Group | null = null;
  private activePenStrokePoints: THREE.Vector3[] = [];
  private activePenSegments: THREE.Mesh[] = [];
  private activePenJoints: THREE.Mesh[] = [];
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
    this.activePenSegments = [];
    this.activePenJoints = [];
    this.activePenStartCap = null;
    this.activePenEndCap = null;
    this.lastPenDirection = null;
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
    this.activePenSegments = [];
    this.activePenJoints = [];
    this.activePenStartCap = null;
    this.activePenEndCap = null;
    this.lastPenDirection = null;
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
    const strokeOffset = this.getPenStrokeOffset();
    const currentPosition = point.clone().add(currentOffsetNormal.clone().multiplyScalar(strokeOffset));

    if (!previousPoint) {
      this.activePenStrokePoints = [currentPosition.clone()];
      this.ensurePenStartCap(currentPosition, strokeGroup);
      this.updatePenEndCap(currentPosition, strokeGroup);
      this.lastPenDirection = null;
      return;
    }

    const startNormal = (previousNormal ?? normal).clone().normalize();
    const startPosition = previousPoint.clone().add(startNormal.clone().multiplyScalar(strokeOffset));

    if (!this.activePenStrokePoints.length) {
      this.activePenStrokePoints.push(startPosition.clone());
    } else if (this.activePenStrokePoints.length === 1) {
      this.activePenStrokePoints[0] = startPosition.clone();
    }

    const lastPoint = this.activePenStrokePoints[this.activePenStrokePoints.length - 1];
    const distance = lastPoint.distanceTo(currentPosition);
    if (distance === 0) {
      this.updatePenEndCap(currentPosition, strokeGroup);
      return;
    }

    this.appendPenSegments(lastPoint, currentPosition, strokeGroup);
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

  private getPenTubeRadius(): number {
    return Math.max(this.penThickness * 0.5, 0.004);
  }

  private getPenStrokeOffset(): number {
    const radius = this.getPenTubeRadius();
    const inset = Math.min(radius * 0.2, 0.0015);
    return Math.max(radius - inset, this.penSurfaceOffset);
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
      this.activePenSegments = [];
      this.activePenJoints = [];
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
    const capRadius = this.getPenCapRadius() + this.getPenStrokeOffset() * 0.5;
    return capRadius * 2;
  }

  private getPenCapRadius(): number {
    return Math.max(this.penSize * 0.5, this.getPenTubeRadius());
  }

  private appendPenSegments(start: THREE.Vector3, end: THREE.Vector3, strokeGroup: THREE.Group): void {
    let lastPoint = start.clone();
    const points = this.getInterpolatedPenPoints(start, end);
    for (let i = 0; i < points.length; i++) {
      const nextPoint = points[i];
      const direction = nextPoint.clone().sub(lastPoint).normalize();
      if (this.lastPenDirection && this.lastPenDirection.angleTo(direction) > 0.25) {
        this.ensurePenJoint(lastPoint.clone(), strokeGroup);
      }
      this.addPenSegment(lastPoint, nextPoint, strokeGroup);
      this.lastPenDirection = direction.clone();
      this.activePenStrokePoints.push(nextPoint.clone());
      lastPoint = nextPoint.clone();
    }
  }

  private getInterpolatedPenPoints(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
    const radius = this.getPenTubeRadius();
    const maxSegmentLength = Math.max(radius * 1.2, 0.01);
    const distance = start.distanceTo(end);
    const steps = Math.max(1, Math.ceil(distance / maxSegmentLength));
    const points: THREE.Vector3[] = [];

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      points.push(start.clone().lerp(end, t));
    }

    return points;
  }

  private addPenSegment(start: THREE.Vector3, end: THREE.Vector3, strokeGroup: THREE.Group): void {
    const length = start.distanceTo(end);
    if (length <= 1e-5) {
      return;
    }

    const radius = this.getPenTubeRadius();
    const direction = end.clone().sub(start);
    const unitDirection = direction.clone().normalize();
    const overlap = Math.min(radius * 0.75, length * 0.49);
    const adjustedStart = start.clone().sub(unitDirection.clone().multiplyScalar(overlap));
    const adjustedEnd = end.clone().add(unitDirection.clone().multiplyScalar(overlap));
    if (this.tryExtendLastPenSegment(adjustedStart, adjustedEnd, unitDirection)) {
      return;
    }

    const geometry = this.getPenSegmentGeometry();
    const mesh = new THREE.Mesh(geometry, this.getPenMaterial());
    mesh.userData['isPaintStroke'] = true;
    mesh.userData['segmentStart'] = adjustedStart.clone();
    mesh.userData['segmentEnd'] = adjustedEnd.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.updatePenSegmentTransform(mesh, adjustedStart, adjustedEnd);
    strokeGroup.add(mesh);
    this.activePenSegments.push(mesh);
  }

  private tryExtendLastPenSegment(
    start: THREE.Vector3,
    end: THREE.Vector3,
    direction: THREE.Vector3,
  ): boolean {
    if (!this.activePenSegments.length) {
      return false;
    }

    const lastMesh = this.activePenSegments[this.activePenSegments.length - 1];
    const lastStart = (lastMesh.userData['segmentStart'] as THREE.Vector3 | undefined)?.clone();
    const lastEnd = (lastMesh.userData['segmentEnd'] as THREE.Vector3 | undefined)?.clone();
    if (!lastStart || !lastEnd) {
      return false;
    }

    const lastDirection = lastEnd.clone().sub(lastStart);
    if (lastDirection.lengthSq() <= 1e-6) {
      return false;
    }

    const lastUnit = lastDirection.clone().normalize();
    const angle = lastUnit.angleTo(direction);
    if (angle > 0.05) {
      return false;
    }

    const connectionGap = lastEnd.distanceTo(start);
    if (connectionGap > this.getPenTubeRadius() * 0.75) {
      return false;
    }

    lastMesh.userData['segmentEnd'] = end.clone();
    this.updatePenSegmentTransform(lastMesh, lastStart, end);
    return true;
  }

  private updatePenSegmentTransform(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
    const radius = this.getPenTubeRadius();
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 1e-6) {
      return;
    }

    mesh.userData['segmentStart'] = start.clone();
    mesh.userData['segmentEnd'] = end.clone();
    mesh.material = this.getPenMaterial();
    mesh.scale.set(radius, length, radius);
    mesh.position.copy(start.clone().lerp(end, 0.5));

    if (direction.lengthSq() > 1e-6) {
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      mesh.quaternion.copy(quaternion);
    }

    mesh.updateMatrix();
  }

  private ensurePenJoint(position: THREE.Vector3, strokeGroup: THREE.Group): void {
    const tolerance = Math.max(this.getPenTubeRadius() * 0.2, 1e-3);
    const existing = this.activePenJoints.find((joint) => joint.position.distanceTo(position) < tolerance);
    if (existing) {
      existing.material = this.getPenMaterial();
      existing.scale.setScalar(this.getPenJointScale());
      existing.position.copy(position);
      existing.updateMatrix();
      return;
    }

    const joint = new THREE.Mesh(this.penJointGeometry, this.getPenMaterial());
    joint.scale.setScalar(this.getPenJointScale());
    joint.userData['isPaintStroke'] = true;
    joint.castShadow = true;
    joint.receiveShadow = true;
    joint.matrixAutoUpdate = false;
    joint.position.copy(position);
    joint.updateMatrix();
    strokeGroup.add(joint);
    this.activePenJoints.push(joint);
  }

  private getPenJointScale(): number {
    const radius = this.getPenTubeRadius();
    const padding = Math.min(radius * 0.1, 0.001);
    return radius * 2 + padding;
  }

  private getPenSegmentGeometry(): THREE.CylinderGeometry {
    const radialSegments = this.getPenRadialSegments();
    const cached = this.penSegmentGeometryCache.get(radialSegments);
    if (cached) {
      return cached;
    }

    const geometry = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, false);
    this.penSegmentGeometryCache.set(radialSegments, geometry);
    return geometry;
  }

  private getPenRadialSegments(): number {
    const radius = this.getPenTubeRadius();
    return Math.min(48, Math.max(16, Math.round(radius * 200)));
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

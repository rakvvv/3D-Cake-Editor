import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import * as THREE from 'three';
import { DecorationFactory } from '../factories/decoration.factory';
import { TransformManagerService } from './transform-manager.service';

type ExtruderVariantData = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: THREE.Vector3;
  name: string;
};

type ExtruderInstanceState = {
  mesh: THREE.InstancedMesh;
  count: number;
};

type DecorationVariantData = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  name: string;
};

type DecorationInstanceState = {
  mesh: THREE.InstancedMesh;
  count: number;
};

type PenInstanceState = {
  mesh: THREE.InstancedMesh;
  count: number;
};

type PenSegmentInstance = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  index: number;
};

type PenJointInstance = {
  position: THREE.Vector3;
  index: number;
};

type PaintTool = 'decoration' | 'pen' | 'extruder' | 'eraser';

@Injectable({ providedIn: 'root' })
export class PaintService {
  public paintMode = false;
  public currentBrush = 'trawa.glb';
  public isPainting = false;
  public paintTool: PaintTool = 'decoration';
  private lastNonEraserTool: Exclude<PaintTool, 'eraser'> = 'decoration';

  public penSize = 0.05;
  public penThickness = 0.02;
  public penColor = '#ff4d6d';
  public readonly sceneChanged$ = new Subject<void>();

  private readonly baseMinDistance = 0.02;
  private readonly baseMinTimeMs = 40;
  private readonly penSurfaceOffset = 0.003;
  private readonly penMaxInstances = 6000;
  private brushCache = new Map<string, THREE.Object3D>();
  private brushPromises = new Map<string, Promise<THREE.Object3D>>();
  private brushSizes = new Map<string, THREE.Vector3>();

  private penMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private penSphereGeometry = new THREE.SphereGeometry(0.5, 16, 12);
  private penJointGeometry = new THREE.SphereGeometry(0.5, 14, 10);
  private penSegmentGeometryCache = new Map<number, THREE.CylinderGeometry>();

  private readonly extruderModelId = 'creamset_longpiping.glb';
  private extruderVariantSelection: number | 'random' = 'random';
  private extruderVariants: ExtruderVariantData[] | null = null;
  private extruderVariantsPromise: Promise<ExtruderVariantData[]> | null = null;
  private extruderStrokeInstances: Map<number, ExtruderInstanceState> = new Map();
  private activeExtruderStrokeGroup: THREE.Group | null = null;
  private extruderLastPlacedPoint: THREE.Vector3 | null = null;
  private extruderLastNormal: THREE.Vector3 | null = null;
  private readonly extruderTargetWidth = 0.04;
  private readonly extruderMaxInstances = 1500;

  private sceneRef: THREE.Scene | null = null;
  private cakeBaseRef: THREE.Object3D | null = null;
  private undoStack: THREE.Object3D[] = [];
  private redoStack: THREE.Object3D[] = [];

  private lastPaintPoint: THREE.Vector3 | null = null;
  private lastPaintNormal: THREE.Vector3 | null = null;
  private lastPaintTime = 0;
  private paintCanvasRect: { left: number; top: number; width: number; height: number } | null = null;
  private lastPenDirection: THREE.Vector3 | null = null;

  private activePenStrokeGroup: THREE.Group | null = null;
  private activePenStrokePoints: THREE.Vector3[] = [];
  private activePenSegments: PenSegmentInstance[] = [];
  private activePenJoints: PenJointInstance[] = [];
  private penSegmentInstance: PenInstanceState | null = null;
  private penJointInstance: PenInstanceState | null = null;
  private penCapInstance: PenInstanceState | null = null;
  private activePenStartCapIndex: number | null = null;
  private activePenEndCapIndex: number | null = null;
  private activeDecorationGroup: THREE.Group | null = null;

  private decorationVariants = new Map<string, DecorationVariantData[]>();
  private decorationStrokeInstances = new Map<string, DecorationInstanceState[]>();
  private decorationVariantCursor = new Map<string, number>();

  constructor(private readonly transformManager: TransformManagerService) {}

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
    this.cakeBaseRef = cakeBase;

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

    if (this.paintTool === 'eraser') {
      this.performErase(raycaster, scene);
      this.resetPaintTracking();
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
      } else if (this.paintTool === 'extruder') {
        await this.placeExtruderStroke(pointOnCakeWorld, normal, previousPoint, previousNormal, scene);
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
    this.penSegmentInstance = null;
    this.penJointInstance = null;
    this.penCapInstance = null;
    this.activePenStartCapIndex = null;
    this.activePenEndCapIndex = null;
    this.lastPenDirection = null;
    this.activeDecorationGroup = null;
    this.decorationStrokeInstances.clear();
    this.activeExtruderStrokeGroup = null;
    this.extruderStrokeInstances.clear();
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;
  }

  public endStroke(): void {
    this.isPainting = false;
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
    this.paintCanvasRect = null;
    if (this.activePenStrokeGroup) {
      if (this.activePenStrokeGroup.children.length) {
        this.finalizePaintRoot(this.activePenStrokeGroup);
        this.trackPaintAddition(this.activePenStrokeGroup);
      } else if (this.sceneRef) {
        this.sceneRef.remove(this.activePenStrokeGroup);
      }
    }
    this.activePenStrokeGroup = null;
    this.activePenStrokePoints = [];
    this.activePenSegments = [];
    this.activePenJoints = [];
    this.penSegmentInstance = null;
    this.penJointInstance = null;
    this.penCapInstance = null;
    this.activePenStartCapIndex = null;
    this.activePenEndCapIndex = null;
    this.lastPenDirection = null;
    if (this.activeDecorationGroup) {
      if (this.activeDecorationGroup.children.length) {
        this.finalizePaintRoot(this.activeDecorationGroup);
        this.trackPaintAddition(this.activeDecorationGroup);
      } else if (this.sceneRef) {
        this.sceneRef.remove(this.activeDecorationGroup);
      }
    }
    this.activeDecorationGroup = null;
    if (this.activeExtruderStrokeGroup) {
      const hasInstances = Array.from(this.extruderStrokeInstances.values()).some((state) => state.count > 0);
      if (this.activeExtruderStrokeGroup.children.length && hasInstances) {
        this.finalizePaintRoot(this.activeExtruderStrokeGroup);
        this.trackPaintAddition(this.activeExtruderStrokeGroup);
      } else if (this.sceneRef) {
        this.sceneRef.remove(this.activeExtruderStrokeGroup);
      }
    }
    this.activeExtruderStrokeGroup = null;
    this.extruderStrokeInstances.clear();
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;
  }

  public setPaintTool(tool: PaintTool): void {
    this.paintTool = tool;
    if (tool !== 'eraser') {
      this.lastNonEraserTool = tool;
    }
  }

  public getLastNonEraserTool(): Exclude<PaintTool, 'eraser'> {
    return this.lastNonEraserTool;
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
    lastObject.parent?.remove(lastObject);
    this.redoStack.push(lastObject);
    this.notifySceneChanged();
  }

  public redo(): void {
    if (!this.sceneRef || !this.redoStack.length) {
      return;
    }

    const object = this.redoStack.pop()!;
    const targetParent = this.getPaintParent(object) ?? this.sceneRef;
    targetParent.add(object);
    this.undoStack.push(object);
    this.notifySceneChanged();
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private performErase(raycaster: THREE.Raycaster, scene: THREE.Scene): void {
    const hits = raycaster.intersectObjects(scene.children, true);
    if (!hits.length) {
      return;
    }

    const targetIntersection = hits.find((intersection) => this.findErasableRoot(intersection.object));
    if (!targetIntersection) {
      return;
    }

    const erasableObject = this.findErasableRoot(targetIntersection.object);
    if (!erasableObject) {
      return;
    }

    if (erasableObject.userData['isPaintStroke']) {
      this.disposePaintStroke(erasableObject);
      if (erasableObject.parent) {
        erasableObject.parent.remove(erasableObject);
      }
      this.removeFromHistory(erasableObject);
      this.notifySceneChanged();
      return;
    }

    if (erasableObject.userData['isPaintDecoration'] || erasableObject.userData['isDecoration']) {
      this.transformManager.removeDecorationObject(erasableObject);
      this.removeFromHistory(erasableObject);
      this.notifySceneChanged();
    }
  }

  private isErasableObject(object: THREE.Object3D | undefined): boolean {
    if (!object) {
      return false;
    }

    return Boolean(
      object.userData['isPaintStroke'] ||
        object.userData['isPaintDecoration'] ||
        object.userData['isDecoration'],
    );
  }

  private findErasableRoot(object: THREE.Object3D): THREE.Object3D | null {
    let current: THREE.Object3D | null = object;
    let lastMatch: THREE.Object3D | null = null;

    while (current) {
      if (this.isErasableObject(current)) {
        lastMatch = current;
      }
      current = current.parent;
    }

    return lastMatch;
  }

  private disposePaintStroke(object: THREE.Object3D): void {
    const strokeRoot = object.userData['isPaintStroke'] ? object : this.findErasableRoot(object);
    if (!strokeRoot || !strokeRoot.userData['isPaintStroke']) {
      return;
    }

    strokeRoot.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

        const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
        if (geometry && !this.isSharedStrokeGeometry(geometry)) {
          geometry.dispose();
        }

      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
          material.forEach((mat) => {
            if (mat && !this.isSharedStrokeMaterial(mat)) {
              mat.dispose();
            }
          });
        } else if (material && !this.isSharedStrokeMaterial(material)) {
          material.dispose();
        }
      });
    }

  private isSharedStrokeGeometry(geometry: THREE.BufferGeometry): boolean {
    if (geometry === this.penSphereGeometry || geometry === this.penJointGeometry) {
      return true;
    }

    for (const cachedGeometry of this.penSegmentGeometryCache.values()) {
      if (geometry === cachedGeometry) {
        return true;
      }
    }

    for (const variants of this.decorationVariants.values()) {
      if (variants.some((variant) => variant.geometry === geometry)) {
        return true;
      }
    }

    if (this.extruderVariants?.some((variant) => variant.geometry === geometry)) {
      return true;
    }

    return false;
  }

  private isSharedStrokeMaterial(material: THREE.Material): boolean {
    for (const cachedMaterial of this.penMaterialCache.values()) {
      if (material === cachedMaterial) {
        return true;
      }
    }

    for (const variants of this.decorationVariants.values()) {
      if (variants.some((variant) => variant.material === material)) {
        return true;
      }
    }

    if (this.extruderVariants?.some((variant) => variant.material === material)) {
      return true;
    }

    return false;
  }

  private removeFromHistory(object: THREE.Object3D): void {
    this.undoStack = this.undoStack.filter((entry) => entry !== object);
    this.redoStack = this.redoStack.filter((entry) => entry !== object);

    if (this.activePenStrokeGroup === object) {
      this.activePenStrokeGroup = null;
      this.activePenStrokePoints = [];
      this.activePenSegments = [];
      this.activePenJoints = [];
      this.penSegmentInstance = null;
      this.penJointInstance = null;
      this.penCapInstance = null;
      this.activePenStartCapIndex = null;
      this.activePenEndCapIndex = null;
      this.lastPenDirection = null;
    }

    if (this.activeExtruderStrokeGroup === object) {
      this.activeExtruderStrokeGroup = null;
      this.extruderStrokeInstances.clear();
      this.extruderLastPlacedPoint = null;
      this.extruderLastNormal = null;
    }

    if (this.activeDecorationGroup === object) {
      this.activeDecorationGroup = null;
    }
  }

  private resetPaintTracking(): void {
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
    this.lastPaintTime = 0;
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;
  }

  private ensureActiveDecorationGroup(scene: THREE.Scene): THREE.Group {
    if (!this.activeDecorationGroup) {
      this.activeDecorationGroup = new THREE.Group();
      this.activeDecorationGroup.userData['isPaintDecoration'] = true;
      this.activeDecorationGroup.userData['displayName'] = 'Dekoracja malowana';
      this.activeDecorationGroup.userData['isPaintStroke'] = true;
      scene.add(this.activeDecorationGroup);
      this.redoStack = [];
    }

    return this.activeDecorationGroup;
  }

  private addDecorationInstances(
    brushId: string,
    variants: DecorationVariantData[],
    decorationGroup: THREE.Group,
    matrix: THREE.Matrix4,
    selectedIndex?: number,
  ): void {
    const states = this.ensureDecorationInstanceMeshes(brushId, variants, decorationGroup);

    const targetIndex = typeof selectedIndex === 'number' ? selectedIndex : 0;
    const state = states[targetIndex];
    if (!state || state.count >= this.extruderMaxInstances) {
      return;
    }

    state.mesh.setMatrixAt(state.count, matrix);
    state.mesh.count = state.count + 1;
    state.mesh.instanceMatrix.needsUpdate = true;
    state.count += 1;
  }

  private getNextDecorationVariantIndex(brushId: string, total: number): number {
    if (total <= 0) {
      return 0;
    }

    const next = this.decorationVariantCursor.get(brushId) ?? 0;
    const index = next % total;
    this.decorationVariantCursor.set(brushId, index + 1);
    return index;
  }

  private ensureDecorationInstanceMeshes(
    brushId: string,
    variants: DecorationVariantData[],
    decorationGroup: THREE.Group,
  ): DecorationInstanceState[] {
    const existing = this.decorationStrokeInstances.get(brushId);
    if (existing && existing.length === variants.length) {
      return existing;
    }

    const states: DecorationInstanceState[] = variants.map((variant) => {
      const mesh = new THREE.InstancedMesh(variant.geometry, variant.material, this.extruderMaxInstances);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData['isPaintDecoration'] = true;
      mesh.userData['isPaintStroke'] = true;
      decorationGroup.add(mesh);

      return { mesh, count: 0 };
    });

    this.decorationStrokeInstances.set(brushId, states);
    return states;
  }

  private getDecorationScale(brushId: string, variants: DecorationVariantData[]): number {
    const templateSize = this.brushSizes.get(brushId);
    if (templateSize) {
      const maxDim = Math.max(templateSize.x, templateSize.y, templateSize.z);
      if (maxDim > 0) {
        return 0.5 / maxDim;
      }
    }

    if (variants.length) {
      const geometriesBox = new THREE.Box3();
      const mergedSize = new THREE.Vector3();
      variants.forEach((variant) => {
        variant.geometry.computeBoundingBox();
        const box = variant.geometry.boundingBox;
        if (box) {
          geometriesBox.union(box);
        }
      });
      geometriesBox.getSize(mergedSize);
      const maxDim = Math.max(mergedSize.x, mergedSize.y, mergedSize.z);
      if (maxDim > 0) {
        return 0.5 / maxDim;
      }
    }

    return 1;
  }

  private getDecorationSpacing(brushId: string): number {
    const templateSize = this.brushSizes.get(brushId);
    if (templateSize) {
      const maxDim = Math.max(templateSize.x, templateSize.y, templateSize.z);
      if (maxDim > 0) {
        const scale = 0.5 / maxDim;
        const scaledMax = maxDim * scale;
        const spacing = scaledMax * 0.35;
        return Math.max(this.baseMinDistance * 1.5, spacing);
      }
    }

    return this.baseMinDistance * 1.5;
  }

  private async getDecorationVariants(brushId: string): Promise<DecorationVariantData[]> {
    const cached = this.decorationVariants.get(brushId);
    if (cached) {
      return cached;
    }

    const variants = await this.loadDecorationVariants(brushId);
    this.decorationVariants.set(brushId, variants);
    return variants;
  }

  private async loadDecorationVariants(brushId: string): Promise<DecorationVariantData[]> {
    const template = await this.loadBrushTemplate(brushId);
    const variants: DecorationVariantData[] = [];

    template.updateMatrixWorld(true);

    template.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld.clone());
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.clone();

      if (!material) {
        return;
      }

      variants.push({
        geometry,
        material,
        name: mesh.name || 'Dekoracja',
      });
    });

    return variants;
  }

  private async placeDecorationBrush(point: THREE.Vector3, normal: THREE.Vector3, scene: THREE.Scene): Promise<void> {
    const decorationGroup = this.ensureActiveDecorationGroup(scene);
    const variants = await this.getDecorationVariants(this.currentBrush);
    if (!variants.length) {
      return;
    }

    const offset = normal.clone().normalize().multiplyScalar(0.005);
    const position = point.clone().add(offset);
    const up = new THREE.Vector3(0, 1, 0);
    const align = new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize());
    const spin = new THREE.Quaternion().setFromAxisAngle(normal.clone().normalize(), Math.random() * Math.PI * 2);
    const rotation = align.clone().multiply(spin).normalize();
    const scale = this.getDecorationScale(this.currentBrush, variants);

    const matrix = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(scale, scale, scale));
    const selectedVariant = this.getNextDecorationVariantIndex(this.currentBrush, variants.length);
    this.addDecorationInstances(this.currentBrush, variants, decorationGroup, matrix, selectedVariant);
  }

  public setExtruderVariantSelection(selection: number | 'random'): void {
    this.extruderVariantSelection = selection;
  }

  public getExtruderVariantSelection(): number | 'random' {
    return this.extruderVariantSelection;
  }

  private async placeExtruderStroke(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    previousPoint: THREE.Vector3 | null,
    previousNormal: THREE.Vector3 | null,
    scene: THREE.Scene,
  ): Promise<void> {
    const variants = await this.getExtruderVariants();
    if (!variants.length) {
      return;
    }

    const strokeGroup = this.ensureActiveExtruderGroup(scene);
    const offset = this.getExtruderSurfaceOffset(variants);
    const currentNormal = normal.clone().normalize();
    const currentPosition = point.clone().add(currentNormal.clone().multiplyScalar(offset));

    if (!previousPoint || !this.extruderLastPlacedPoint) {
      const fallbackTangent = new THREE.Vector3().crossVectors(currentNormal, new THREE.Vector3(0, 1, 0));
      if (fallbackTangent.lengthSq() <= 1e-6) {
        fallbackTangent.set(1, 0, 0);
      } else {
        fallbackTangent.normalize();
      }
      this.addExtruderInstance(currentPosition, currentNormal, fallbackTangent, variants, strokeGroup);
      this.extruderLastPlacedPoint = currentPosition.clone();
      this.extruderLastNormal = currentNormal.clone();
      return;
    }

    const baseNormal = (previousNormal ?? currentNormal).clone().normalize();
    const startPosition = previousPoint.clone().add(baseNormal.clone().multiplyScalar(offset));
    if (!this.extruderLastPlacedPoint) {
      this.extruderLastPlacedPoint = startPosition.clone();
    }

    const startPoint = this.extruderLastPlacedPoint.clone();
    const pathVector = currentPosition.clone().sub(startPoint);
    const distance = pathVector.length();
    if (distance <= 1e-6) {
      this.extruderLastNormal = currentNormal.clone();
      return;
    }

    const tangent = pathVector.clone().normalize();
    let cursor = startPoint.clone();
    let remaining = cursor.distanceTo(currentPosition);
    const minSpacing = this.getExtruderAverageSpacing(variants);

    while (remaining >= minSpacing) {
      const variantIndex = this.selectExtruderVariant(variants.length);
      const spacing = this.getExtruderSpacing(variants, variantIndex);
      const step = Math.min(spacing, remaining);
      cursor.add(tangent.clone().multiplyScalar(step));
      this.addExtruderInstance(cursor, baseNormal, tangent, variants, strokeGroup, variantIndex);
      this.extruderLastPlacedPoint = cursor.clone();
      remaining = cursor.distanceTo(currentPosition);
    }

    if (!this.extruderLastPlacedPoint || this.extruderLastPlacedPoint.distanceTo(currentPosition) > minSpacing * 0.6) {
      const variantIndex = this.selectExtruderVariant(variants.length);
      this.addExtruderInstance(currentPosition, baseNormal, tangent, variants, strokeGroup, variantIndex);
      this.extruderLastPlacedPoint = currentPosition.clone();
    }

    this.extruderLastNormal = currentNormal.clone();
  }

  private selectExtruderVariant(total: number): number {
    if (this.extruderVariantSelection === 'random' || this.extruderVariantSelection < 0) {
      return Math.floor(Math.random() * total);
    }

    return Math.min(total - 1, this.extruderVariantSelection);
  }

  private addExtruderInstance(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    tangent: THREE.Vector3,
    variants: ExtruderVariantData[],
    strokeGroup: THREE.Group,
    variantIndex?: number,
  ): void {
    if (!variants.length) {
      return;
    }

    const selectedIndex = typeof variantIndex === 'number' ? variantIndex : this.selectExtruderVariant(variants.length);
    const variant = variants[selectedIndex];
    const scale = this.getExtruderScale(variant);
    const transform = this.buildExtruderMatrix(position, normal, tangent, scale);

    const state = this.ensureExtruderInstanceMesh(selectedIndex, variant, strokeGroup);
    if (state.count >= this.extruderMaxInstances) {
      return;
    }

    state.mesh.setMatrixAt(state.count, transform);
    state.mesh.count = state.count + 1;
    state.mesh.instanceMatrix.needsUpdate = true;
    state.count += 1;
  }

  private buildExtruderMatrix(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    tangent: THREE.Vector3,
    scale: number,
  ): THREE.Matrix4 {
    const normalizedTangent = tangent.clone().normalize();
    const normalizedNormal = normal.clone().normalize();
    const binormal = new THREE.Vector3().crossVectors(normalizedNormal, normalizedTangent);

    if (binormal.lengthSq() <= 1e-6) {
      binormal.set(1, 0, 0);
    } else {
      binormal.normalize();
    }

    const adjustedNormal = new THREE.Vector3().crossVectors(normalizedTangent, binormal);
    if (adjustedNormal.lengthSq() <= 1e-6) {
      adjustedNormal.copy(normalizedNormal.lengthSq() > 0 ? normalizedNormal : new THREE.Vector3(0, 1, 0));
    } else {
      adjustedNormal.normalize();
    }

    const basis = new THREE.Matrix4().makeBasis(binormal, adjustedNormal, normalizedTangent);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
    const matrix = new THREE.Matrix4();
    matrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
    return matrix;
  }

  private ensureExtruderInstanceMesh(
    variantIndex: number,
    variant: ExtruderVariantData,
    strokeGroup: THREE.Group,
  ): ExtruderInstanceState {
    const existing = this.extruderStrokeInstances.get(variantIndex);
    if (existing) {
      return existing;
    }

    const mesh = new THREE.InstancedMesh(variant.geometry, variant.material, this.extruderMaxInstances);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData['isPaintStroke'] = true;
    strokeGroup.add(mesh);

    const state: ExtruderInstanceState = { mesh, count: 0 };
    this.extruderStrokeInstances.set(variantIndex, state);
    return state;
  }

  private ensureActiveExtruderGroup(scene: THREE.Scene): THREE.Group {
    if (!this.activeExtruderStrokeGroup) {
      this.activeExtruderStrokeGroup = new THREE.Group();
      this.activeExtruderStrokeGroup.userData['isPaintStroke'] = true;
      scene.add(this.activeExtruderStrokeGroup);
      this.redoStack = [];
      this.extruderStrokeInstances.clear();
      this.extruderLastPlacedPoint = null;
      this.extruderLastNormal = null;
    }

    return this.activeExtruderStrokeGroup;
  }

  private getExtruderSurfaceOffset(variants: ExtruderVariantData[]): number {
    if (!variants.length) {
      return this.penSurfaceOffset;
    }

    const maxHeight = Math.max(...variants.map((variant) => variant.size.y * this.getExtruderScale(variant)));
    return Math.max(this.penSurfaceOffset, maxHeight * 0.5 + this.penSurfaceOffset * 0.5);
  }

  private getExtruderAverageSpacing(variants: ExtruderVariantData[]): number {
    if (!variants.length) {
      return this.extruderTargetWidth;
    }

    const spacings = variants.map((variant, index) => this.getExtruderSpacing(variants, index));
    const average = spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
    return Math.max(0.005, average);
  }

  private getExtruderSpacing(variants: ExtruderVariantData[], variantIndex: number): number {
    const variant = variants[variantIndex];
    const width = this.getExtruderVariantWidth(variant);
    return Math.max(this.penSurfaceOffset, width * this.getExtruderScale(variant));
  }

  private getExtruderVariantWidth(variant: ExtruderVariantData): number {
    return Math.max(variant.size.x, variant.size.z);
  }

  private getExtruderScale(variant: ExtruderVariantData): number {
    const width = this.getExtruderVariantWidth(variant);
    if (width <= 1e-6) {
      return 1;
    }

    return this.extruderTargetWidth / width;
  }

  private async getExtruderVariants(): Promise<ExtruderVariantData[]> {
    if (this.extruderVariants) {
      return this.extruderVariants;
    }

    if (!this.extruderVariantsPromise) {
      this.extruderVariantsPromise = this.loadExtruderVariants();
    }

    this.extruderVariants = await this.extruderVariantsPromise;
    this.extruderVariantsPromise = null;
    return this.extruderVariants;
  }

  private async loadExtruderVariants(): Promise<ExtruderVariantData[]> {
    try {
      const model = await DecorationFactory.loadDecorationModel(`/models/${this.extruderModelId}`);
      return this.extractExtruderVariants(model).slice(0, 5);
    } catch (error) {
      console.error('Paint: nie udało się załadować segmentów ekstrudera:', error);
      return [];
    }
  }

  private extractExtruderVariants(root: THREE.Object3D): ExtruderVariantData[] {
    const variants: ExtruderVariantData[] = [];
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || variants.length >= 5) {
        return;
      }

      mesh.updateMatrixWorld(true);

      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix.clone());
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const size = new THREE.Vector3();
      geometry.boundingBox?.getSize(size);

      const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const material = sourceMaterial?.clone() ?? new THREE.MeshStandardMaterial({ color: 0xffffff });
      if ((material as THREE.Material).side !== undefined) {
        (material as THREE.Material).side = THREE.DoubleSide;
      }

      variants.push({
        geometry,
        material,
        size,
        name: mesh.name || `Variant ${variants.length + 1}`,
      });
    });

    return variants;
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

  private ensurePenCapInstanceMesh(strokeGroup: THREE.Group): PenInstanceState {
    if (this.penCapInstance) {
      this.penCapInstance.mesh.material = this.getPenMaterial();
      return this.penCapInstance;
    }

    const mesh = new THREE.InstancedMesh(this.penSphereGeometry, this.getPenMaterial(), 4);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData['isPaintStroke'] = true;
    strokeGroup.add(mesh);
    this.penCapInstance = { mesh, count: 0 };
    return this.penCapInstance;
  }

  private ensurePenStartCap(position: THREE.Vector3, strokeGroup: THREE.Group): void {
    const capState = this.ensurePenCapInstanceMesh(strokeGroup);
    const index = this.activePenStartCapIndex ?? capState.count;
    if (this.activePenStartCapIndex === null) {
      this.activePenStartCapIndex = index;
      capState.count = Math.max(capState.count, index + 1);
      capState.mesh.count = capState.count;
    }

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(1, 1, 1).multiplyScalar(this.getPenCapScale());
    matrix.compose(position, new THREE.Quaternion(), scale);
    capState.mesh.setMatrixAt(index, matrix);
    capState.mesh.instanceMatrix.needsUpdate = true;
    capState.mesh.material = this.getPenMaterial();
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

    if (this.paintTool === 'extruder') {
      return Math.max(0.005, this.getExtruderAverageSpacing(this.extruderVariants ?? []));
    }

    if (this.paintTool === 'decoration') {
      return this.getDecorationSpacing(this.currentBrush);
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
      this.penSegmentInstance = null;
      this.penJointInstance = null;
      this.penCapInstance = null;
      this.activePenStartCapIndex = null;
      this.activePenEndCapIndex = null;
    }

    return this.activePenStrokeGroup;
  }

  private updatePenEndCap(position: THREE.Vector3, strokeGroup: THREE.Group): void {
    const capState = this.ensurePenCapInstanceMesh(strokeGroup);
    const index = this.activePenEndCapIndex ?? Math.max(capState.count, 1);
    if (this.activePenEndCapIndex === null) {
      this.activePenEndCapIndex = index;
      capState.count = Math.max(capState.count, index + 1);
      capState.mesh.count = capState.count;
    }

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(1, 1, 1).multiplyScalar(this.getPenCapScale());
    matrix.compose(position, new THREE.Quaternion(), scale);
    capState.mesh.setMatrixAt(index, matrix);
    capState.mesh.instanceMatrix.needsUpdate = true;
    capState.mesh.material = this.getPenMaterial();
  }

  private getPenCapScale(): number {
    const capRadius = this.getPenCapRadius() + this.getPenStrokeOffset() * 0.5;
    return capRadius * 2;
  }

  private getPenCapRadius(): number {
    return Math.max(this.penSize * 0.5, this.getPenTubeRadius());
  }

  private ensurePenSegmentInstanceMesh(strokeGroup: THREE.Group): PenInstanceState {
    if (this.penSegmentInstance) {
      this.penSegmentInstance.mesh.material = this.getPenMaterial();
      return this.penSegmentInstance;
    }

    const mesh = new THREE.InstancedMesh(this.getPenSegmentGeometry(), this.getPenMaterial(), this.penMaxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData['isPaintStroke'] = true;
    strokeGroup.add(mesh);
    this.penSegmentInstance = { mesh, count: 0 };
    return this.penSegmentInstance;
  }

  private ensurePenJointInstanceMesh(strokeGroup: THREE.Group): PenInstanceState {
    if (this.penJointInstance) {
      this.penJointInstance.mesh.material = this.getPenMaterial();
      return this.penJointInstance;
    }

    const mesh = new THREE.InstancedMesh(this.penJointGeometry, this.getPenMaterial(), this.penMaxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData['isPaintStroke'] = true;
    strokeGroup.add(mesh);
    this.penJointInstance = { mesh, count: 0 };
    return this.penJointInstance;
  }

  private getPenJointMatrix(position: THREE.Vector3): THREE.Matrix4 | null {
    const scale = new THREE.Vector3(1, 1, 1).multiplyScalar(this.getPenJointScale());
    const matrix = new THREE.Matrix4();
    matrix.compose(position, new THREE.Quaternion(), scale);
    return matrix;
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

    const segmentState = this.ensurePenSegmentInstanceMesh(strokeGroup);
    if (segmentState.count >= this.penMaxInstances) {
      return;
    }

    const index = segmentState.count;
    segmentState.count += 1;
    segmentState.mesh.count = Math.min(segmentState.count, this.penMaxInstances);
    const matrix = this.getPenSegmentMatrix(adjustedStart, adjustedEnd);
    if (matrix) {
      segmentState.mesh.setMatrixAt(index, matrix);
      segmentState.mesh.instanceMatrix.needsUpdate = true;
      this.activePenSegments.push({ start: adjustedStart.clone(), end: adjustedEnd.clone(), index });
    }
  }

  private tryExtendLastPenSegment(
    start: THREE.Vector3,
    end: THREE.Vector3,
    direction: THREE.Vector3,
  ): boolean {
    if (!this.activePenSegments.length) {
      return false;
    }

    const lastSegment = this.activePenSegments[this.activePenSegments.length - 1];
    const lastStart = lastSegment.start.clone();
    const lastEnd = lastSegment.end.clone();

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

    lastSegment.end = end.clone();
    const matrix = this.getPenSegmentMatrix(lastStart, end);
    if (matrix && this.penSegmentInstance) {
      this.penSegmentInstance.mesh.setMatrixAt(lastSegment.index, matrix);
      this.penSegmentInstance.mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  private getPenSegmentMatrix(start: THREE.Vector3, end: THREE.Vector3): THREE.Matrix4 | null {
    const radius = this.getPenTubeRadius();
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 1e-6) {
      return null;
    }

    const position = start.clone().lerp(end, 0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize(),
    );
    const scale = new THREE.Vector3(radius, length, radius);
    const matrix = new THREE.Matrix4();
    matrix.compose(position, quaternion, scale);
    return matrix;
  }

  private ensurePenJoint(position: THREE.Vector3, strokeGroup: THREE.Group): void {
    const tolerance = Math.max(this.getPenTubeRadius() * 0.2, 1e-3);
    const existing = this.activePenJoints.find((joint) => joint.position.distanceTo(position) < tolerance);
    if (existing) {
      const matrix = this.getPenJointMatrix(position);
      if (matrix && this.penJointInstance) {
        this.penJointInstance.mesh.setMatrixAt(existing.index, matrix);
        this.penJointInstance.mesh.instanceMatrix.needsUpdate = true;
        this.penJointInstance.mesh.material = this.getPenMaterial();
      }
      existing.position.copy(position);
      return;
    }

    const jointState = this.ensurePenJointInstanceMesh(strokeGroup);
    if (jointState.count >= this.penMaxInstances) {
      return;
    }

    const index = jointState.count;
    jointState.count += 1;
    jointState.mesh.count = Math.min(jointState.count, this.penMaxInstances);
    const matrix = this.getPenJointMatrix(position);
    if (matrix) {
      jointState.mesh.setMatrixAt(index, matrix);
      jointState.mesh.instanceMatrix.needsUpdate = true;
      this.activePenJoints.push({ position: position.clone(), index });
    }
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

  private finalizePaintRoot(object: THREE.Object3D): void {
    this.recenterPivot(object);
    this.trySnapPaintStroke(object);
    object.userData['paintParent'] = object.parent ?? null;
    object.updateMatrixWorld(true);
  }

  private trySnapPaintStroke(object: THREE.Object3D): void {
    object.traverse((child) => {
      child.userData = { ...child.userData, isSnapped: true };
    });

    this.attachToCake(object);
    object.userData['isSnapped'] = true;
  }

  private recenterPivot(object: THREE.Object3D): void {
    const box = this.computeWorldBoundingBox(object);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    if (center.lengthSq() <= 1e-8) {
      return;
    }

    object.children.forEach((child) => this.offsetChildForPivot(child, center));
    object.position.add(center);
  }

  private computeWorldBoundingBox(object: THREE.Object3D): THREE.Box3 {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tempBox = new THREE.Box3();
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();

    object.traverse((child) => {
      if ((child as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = child as THREE.InstancedMesh;
        const geometry = instanced.geometry;
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        if (!geometry.boundingBox) {
          return;
        }

        for (let i = 0; i < instanced.count; i++) {
          instanced.getMatrixAt(i, instanceMatrix);
          worldMatrix.multiplyMatrices(instanced.matrixWorld, instanceMatrix);
          tempBox.copy(geometry.boundingBox).applyMatrix4(worldMatrix);
          box.union(tempBox);
        }
        return;
      }

      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const geometry = mesh.geometry;
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        if (!geometry.boundingBox) {
          return;
        }

        tempBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        box.union(tempBox);
      }
    });

    return box;
  }

  private offsetChildForPivot(child: THREE.Object3D, offset: THREE.Vector3): void {
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = child as THREE.InstancedMesh;
      const tempMatrix = new THREE.Matrix4();
      const tempPosition = new THREE.Vector3();
      const tempQuaternion = new THREE.Quaternion();
      const tempScale = new THREE.Vector3();

      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, tempMatrix);
        tempMatrix.decompose(tempPosition, tempQuaternion, tempScale);
        tempPosition.sub(offset);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        instanced.setMatrixAt(i, tempMatrix);
      }

      instanced.instanceMatrix.needsUpdate = true;
      return;
    }

    child.position.sub(offset);
    if (child.matrixAutoUpdate === false) {
      child.updateMatrix();
    }
  }

  private attachToCake(object: THREE.Object3D): void {
    if (!this.cakeBaseRef) {
      return;
    }

    this.cakeBaseRef.updateMatrixWorld(true);
    this.sceneRef?.updateMatrixWorld(true);
    this.cakeBaseRef.attach(object);
  }

  private getPaintParent(object: THREE.Object3D): THREE.Object3D | null {
    const savedParent = object.userData['paintParent'] as THREE.Object3D | null | undefined;
    if (savedParent) {
      return savedParent;
    }

    return this.sceneRef ?? null;
  }

  private trackPaintAddition(object: THREE.Object3D): void {
    this.undoStack.push(object);
    this.redoStack = [];
    this.notifySceneChanged();
  }

  private notifySceneChanged(): void {
    this.sceneChanged$.next();
  }
}

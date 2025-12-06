import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import * as THREE from 'three';
import { DecorationFactory } from '../factories/decoration.factory';
import { TransformManagerService } from './transform-manager.service';
import { SnapService } from './snap.service';
import { ExtruderVariantInfo } from '../models/extruderVariantInfo';
import { environment } from '../../environments/environment';

type ExtruderVariantData = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: THREE.Vector3;
  name: string;
  sourceId: string;
  scaleMultiplier?: number;
  thumbnailUrl?: string;
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

type PaintTool = 'decoration' | 'pen' | 'extruder';
type ExtruderPreset = 'circle' | 'arc' | 'wave';

@Injectable({ providedIn: 'root' })
export class PaintService {
  public paintMode = false;
  public currentBrush = 'trawa.glb';
  public isPainting = false;
  public paintTool: PaintTool = 'decoration';

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

  private extruderBrushId = 'cream_dot.glb';
  private extruderVariantSelection: number | 'random' = 'random';
  private extruderVariants: ExtruderVariantData[] | null = null;
  private extruderVariantsPromise: Promise<ExtruderVariantData[]> | null = null;
  private extruderVariantThumbnails = new Map<string, string>();
  private extruderStrokeInstances: Map<number, ExtruderInstanceState> = new Map();
  private activeExtruderStrokeGroup: THREE.Group | null = null;
  private extruderLastPlacedPoint: THREE.Vector3 | null = null;
  private extruderLastNormal: THREE.Vector3 | null = null;
  private extruderFirstInstance:
    | { state: ExtruderInstanceState; index: number; position: THREE.Vector3; normal: THREE.Vector3; scale: number }
    | null = null;
  private readonly extruderTargetWidth = 0.12;
  private readonly extruderMaxInstances = 1500;
  private readonly extruderBaseRotation = new THREE.Euler(0, 0, 0);

  private readonly isBrowser: boolean;
  private readonly apiBaseUrl = environment.apiBaseUrl;

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

  constructor(
    private readonly transformManager: TransformManagerService,
    private readonly snapService: SnapService,
    private readonly http: HttpClient,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  public async handlePaint(
    event: MouseEvent,
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
    mouse: THREE.Vector2,
    raycaster: THREE.Raycaster,
  ): Promise<void> {
    if (!this.paintMode) {
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

    if (!cakeBase) {
      return;
    }

    const intersects = raycaster.intersectObject(cakeBase, true);

    if (intersects.length === 0) {
      return;
    }

    const hit =
      intersects.find((intersection) => !this.isPaintStroke(intersection.object)) ??
      intersects[0];
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
    this.extruderFirstInstance = null;
  }

  private isPaintStroke(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData?.['isPaintStroke']) return true;
      current = current.parent;
    }
    return false;
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
    this.extruderFirstInstance = null;
  }

  public setPaintTool(tool: PaintTool): void {
    this.paintTool = tool;
  }

  public setCurrentBrush(brushId: string): void {
    this.currentBrush = brushId;
  }

  public setExtruderBrush(brushId: string): void {
    if (brushId === this.extruderBrushId) {
      return;
    }

    this.extruderBrushId = brushId;
    this.extruderVariants = null;
    this.extruderVariantsPromise = null;
    this.extruderVariantThumbnails.clear();
    this.extruderStrokeInstances.clear();
    this.activeExtruderStrokeGroup = null;
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;
    this.extruderFirstInstance = null;
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
    lastObject.userData['removedByUndo'] = true;
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
    delete object.userData['removedByUndo'];
    this.undoStack.push(object);
    this.notifySceneChanged();
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public registerDecorationAddition(object: THREE.Object3D): void {
    if (!object) {
      return;
    }

    object.userData['paintParent'] = object.parent ?? null;
    this.undoStack.push(object);
    this.redoStack = [];
    this.notifySceneChanged();
  }

  private ensureActiveDecorationGroup(scene: THREE.Scene): THREE.Group {
    if (!this.activeDecorationGroup) {
      this.activeDecorationGroup = new THREE.Group();
      this.activeDecorationGroup.userData['isPaintDecoration'] = true;
      this.activeDecorationGroup.userData['displayName'] = 'Dekoracja malowana';
      this.activeDecorationGroup.userData['isPaintStroke'] = true;
      this.activeDecorationGroup.userData['paintStrokeType'] = 'decoration';
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

    const offset = normal.clone().normalize().multiplyScalar(0.0015);
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

  public async getExtruderVariantPreviews(): Promise<{ id: number; name: string; thumbnail: string | null }[]> {
    const variants = await this.getExtruderVariants();
    return variants.map((variant, index) => ({
      id: index,
      name: variant.name || `Wariant ${index + 1}`,
      thumbnail: this.getExtruderVariantThumbnail(index, variant),
    }));
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
    this.recordPaintSnapPoint(point, strokeGroup);

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
    this.recordPaintSnapPoint(previousPoint, strokeGroup);
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
    this.alignFirstExtruderInstance(tangent, baseNormal);
    let cursor = startPoint.clone();
    let remaining = cursor.distanceTo(currentPosition);
    const minSpacing = this.getExtruderAverageSpacing(variants) * 0.8;

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

  public async insertExtruderPreset(preset: ExtruderPreset): Promise<void> {
    const variants = await this.getExtruderVariants();
    if (!variants.length || !this.sceneRef) {
      return;
    }

    const center = this.getCakeTopCenter();
    if (!center) {
      return;
    }

    const strokeGroup = new THREE.Group();
    strokeGroup.userData['isPaintStroke'] = true;
    strokeGroup.userData['displayName'] = 'Ekstruder – preset';
    this.sceneRef.add(strokeGroup);

    const previousGroup = this.activeExtruderStrokeGroup;
    const previousInstances = this.extruderStrokeInstances;
    const previousPoint = this.extruderLastPlacedPoint;
    const previousNormal = this.extruderLastNormal;

    this.activeExtruderStrokeGroup = strokeGroup;
    this.extruderStrokeInstances = new Map();
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;

    const normal = new THREE.Vector3(0, 1, 0);
    const pathPoints = this.buildExtruderPresetPath(preset, center);
    this.populateExtruderPath(pathPoints, normal, variants, strokeGroup);

    const hasInstances = Array.from(this.extruderStrokeInstances.values()).some((state) => state.count > 0);
    if (strokeGroup.children.length && hasInstances) {
      this.finalizePaintRoot(strokeGroup);
      this.trackPaintAddition(strokeGroup);
    } else {
      this.sceneRef.remove(strokeGroup);
    }

    this.activeExtruderStrokeGroup = previousGroup;
    this.extruderStrokeInstances = previousInstances;
    this.extruderLastPlacedPoint = previousPoint;
    this.extruderLastNormal = previousNormal;
    this.paintTool = 'extruder';
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
    const isFirstPlacement =
      !this.extruderFirstInstance && Array.from(this.extruderStrokeInstances.values()).every((meshState) => meshState.count === 0);
    if (state.count >= this.extruderMaxInstances) {
      return;
    }

    state.mesh.setMatrixAt(state.count, transform);
    state.mesh.count = state.count + 1;
    state.mesh.instanceMatrix.needsUpdate = true;
    state.count += 1;

    if (isFirstPlacement) {
      this.extruderFirstInstance = {
        state,
        index: state.count - 1,
        position: position.clone(),
        normal: normal.clone(),
        scale,
      };
    }
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

  private alignFirstExtruderInstance(tangent: THREE.Vector3, normal: THREE.Vector3): void {
    if (!this.extruderFirstInstance) {
      return;
    }

    const { state, index, position, scale } = this.extruderFirstInstance;
    const adjustedNormal = normal.clone().normalize();
    const transform = this.buildExtruderMatrix(position, adjustedNormal, tangent, scale);

    state.mesh.setMatrixAt(index, transform);
    state.mesh.instanceMatrix.needsUpdate = true;
    this.extruderFirstInstance = null;
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
      this.activeExtruderStrokeGroup.userData['paintStrokeType'] = 'extruder';
      this.activeExtruderStrokeGroup.userData['snapPoints'] = [] as number[][];
      scene.add(this.activeExtruderStrokeGroup);
      this.redoStack = [];
      this.extruderStrokeInstances.clear();
      this.extruderLastPlacedPoint = null;
      this.extruderLastNormal = null;
    }

    return this.activeExtruderStrokeGroup;
  }

  private populateExtruderPath(
    points: THREE.Vector3[],
    normal: THREE.Vector3,
    variants: ExtruderVariantData[],
    strokeGroup: THREE.Group,
  ): void {
    if (!points.length) {
      return;
    }

    const offset = this.getExtruderSurfaceOffset(variants);
    const upNormal = normal.clone().normalize();
    const minSpacing = this.getExtruderAverageSpacing(variants) * 0.8;
    let lastPlaced: THREE.Vector3 | null = null;

    points.forEach((point, index) => {
      this.recordPaintSnapPoint(point, strokeGroup);
      const current = point.clone().add(upNormal.clone().multiplyScalar(offset));
      if (!lastPlaced) {
        const tangent = this.getPresetTangent(points, index);
        this.addExtruderInstance(current, upNormal, tangent, variants, strokeGroup);
        this.alignFirstExtruderInstance(tangent, upNormal);
        lastPlaced = current.clone();
        return;
      }

      const pathVector = current.clone().sub(lastPlaced);
      const distance = pathVector.length();
      if (distance <= 1e-6) {
        return;
      }

      const tangent = pathVector.clone().normalize();
      let cursor = lastPlaced.clone();
      let remaining = cursor.distanceTo(current);

      while (remaining >= minSpacing) {
        const variantIndex = this.selectExtruderVariant(variants.length);
        const spacing = this.getExtruderSpacing(variants, variantIndex);
        const step = Math.min(spacing, remaining);
        cursor = cursor.add(tangent.clone().multiplyScalar(step));
        this.addExtruderInstance(cursor, upNormal, tangent, variants, strokeGroup, variantIndex);
        lastPlaced = cursor.clone();
        remaining = cursor.distanceTo(current);
      }

      if (!lastPlaced || lastPlaced.distanceTo(current) > minSpacing * 0.6) {
        const variantIndex = this.selectExtruderVariant(variants.length);
        this.addExtruderInstance(current, upNormal, tangent, variants, strokeGroup, variantIndex);
        lastPlaced = current.clone();
      }
    });
  }

  private getPresetTangent(points: THREE.Vector3[], index: number): THREE.Vector3 {
    if (points.length <= 1) {
      return new THREE.Vector3(1, 0, 0);
    }

    const current = points[index];
    const next = points[index + 1] ?? points[index - 1];
    const tangent = next.clone().sub(current);
    if (tangent.lengthSq() <= 1e-6) {
      return new THREE.Vector3(1, 0, 0);
    }

    return tangent.normalize();
  }

  private getExtruderSurfaceOffset(variants: ExtruderVariantData[]): number {
    if (!variants.length) {
      return this.penSurfaceOffset;
    }

    const maxHeight = Math.max(...variants.map((variant) => variant.size.y * this.getExtruderScale(variant)));
    return Math.max(this.penSurfaceOffset * 0.25, maxHeight * 0.08);
  }

  private getExtruderAverageSpacing(variants: ExtruderVariantData[]): number {
    if (!variants.length) {
      return this.extruderTargetWidth;
    }

    const spacings = variants.map((variant, index) => this.getExtruderSpacing(variants, index));
    const average = spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
    return Math.max(0.005, average);
  }

  private buildExtruderPresetPath(preset: ExtruderPreset, center: THREE.Vector3): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];

    if (preset === 'circle') {
      const radius = 0.12;
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        points.push(new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius));
      }
      return points;
    }

    if (preset === 'arc') {
      const radius = 0.14;
      const steps = 18;
      const start = -Math.PI * 0.7;
      const end = Math.PI * 0.2;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = start + (end - start) * t;
        points.push(new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius));
      }
      return points;
    }

    const length = 0.38;
    const amplitude = 0.05;
    const waves = 3;
    const segments = 30;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = center.x - length / 2 + length * t;
      const z = center.z + Math.sin(t * Math.PI * waves) * amplitude;
      points.push(new THREE.Vector3(x, center.y, z));
    }

    return points;
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

    return (this.extruderTargetWidth * (variant.scaleMultiplier ?? 1)) / width;
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
    if (!this.isBrowser) {
      return [];
    }

    const variants: ExtruderVariantData[] = [];
    const sources = await this.fetchExtruderVariantSources();

    for (const source of sources) {
      try {
        const variant = await this.loadExtruderVariantFromFile(source);
        if (variant) {
          variants.push(variant);
        }
      } catch (error) {
        console.error(`Paint: nie udało się załadować końcówki kremu ${source.modelFileName || source.id}`, error);
      }
    }

    return variants;
  }

  private async fetchExtruderVariantSources(): Promise<ExtruderVariantInfo[]> {
    if (!this.isBrowser) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.http.get<ExtruderVariantInfo[]>(`${this.apiBaseUrl}/extruder-variants`),
      );
      return Array.isArray(response) ? response : [];
    } catch (error) {
      console.error('Paint: nie udało się pobrać wariantów ekstrudera', error);
      return [];
    }
  }

  private async loadExtruderVariantFromFile(source: ExtruderVariantInfo): Promise<ExtruderVariantData | null> {
    if (!this.isBrowser) {
      return null;
    }

    const modelId = source.modelFileName || source.id;
    const model = await DecorationFactory.loadDecorationModel(`/models/${modelId}`);
    model.updateMatrixWorld(true);

    const mesh = this.findFirstMesh(model);
    if (!mesh) {
      return null;
    }

    mesh.updateMatrixWorld(true);
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(this.extruderBaseRotation));
    geometry.computeBoundingBox();
    const minY = geometry.boundingBox?.min.y ?? 0;
    if (Math.abs(minY) > 1e-6) {
      geometry.translate(0, -minY, 0);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const size = new THREE.Vector3();
    geometry.boundingBox?.getSize(size);

    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const material = sourceMaterial?.clone() ?? new THREE.MeshStandardMaterial({ color: 0xffffff });
    if ((material as THREE.Material).side !== undefined) {
      (material as THREE.Material).side = THREE.DoubleSide;
    }

    return {
      geometry,
      material,
      size,
      name: mesh.name || source.name,
      sourceId: modelId,
      scaleMultiplier: source.scaleMultiplier,
      thumbnailUrl: source.thumbnailUrl,
    };
  }

  private findFirstMesh(
    root: THREE.Object3D,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> | null {
    let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> | null = null;

    root.traverse((node) => {
      const candidate = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
      if (candidate.isMesh && !mesh) {
        mesh = candidate;
      }
    });

    return mesh;
  }

  private getExtruderVariantThumbnail(variantIndex: number, variant: ExtruderVariantData): string | null {
    if (typeof document === 'undefined') {
      return null;
    }

    if (variant.thumbnailUrl) {
      return variant.thumbnailUrl;
    }

    const cacheKey = `${variant.sourceId}:${variantIndex}`;
    const cached = this.extruderVariantThumbnails.get(cacheKey);
    if (cached) {
      return cached;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 110;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.fillStyle = '#fff8fb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maxDimension = Math.max(variant.size.x || 1, variant.size.y || 1, variant.size.z || 1);
    const scale = (canvas.width * 0.55) / Math.max(maxDimension, 1e-3);
    const drawWidth = Math.max(8, variant.size.x * scale);
    const drawHeight = Math.max(8, variant.size.z * scale || variant.size.y * scale);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(drawWidth, drawHeight) * 0.15;

    ctx.fillStyle = '#ffdee7';
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 2;

    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight, radius);
    } else {
      ctx.beginPath();
      ctx.rect(centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
    }

    ctx.fill();
    ctx.stroke();

    const dataUrl = canvas.toDataURL('image/png');
    this.extruderVariantThumbnails.set(cacheKey, dataUrl);
    return dataUrl;
  }

  private getCakeTopCenter(): THREE.Vector3 | null {
    if (!this.cakeBaseRef) {
      return null;
    }

    const box = new THREE.Box3().setFromObject(this.cakeBaseRef);
    if (box.isEmpty()) {
      return null;
    }

    const center = box.getCenter(new THREE.Vector3());
    center.y = box.max.y + this.penSurfaceOffset;
    return center;
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
      this.activePenStrokeGroup.userData['paintStrokeType'] = 'pen';
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

  private computeBrushSize(model: THREE.Object3D): THREE.Vector3 {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size;
  }

  private recordPaintSnapPoint(point: THREE.Vector3, strokeGroup: THREE.Group): void {
    if (!strokeGroup.userData['snapPoints']) {
      strokeGroup.userData['snapPoints'] = [] as number[][];
    }

    const snapPoints = strokeGroup.userData['snapPoints'] as number[][];
    snapPoints.push(point.toArray());
  }

  private finalizePaintRoot(object: THREE.Object3D): void {
    this.recenterPivot(object);
    const strokeType = object.userData['paintStrokeType'];
    const skipSnap = strokeType === 'decoration' || strokeType === 'extruder' || strokeType === 'pen';

    if (skipSnap) {
      object.traverse((child) => {
        child.userData = { ...child.userData, isSnapped: true };
      });
      this.attachToCake(object);
      object.userData['isSnapped'] = true;
    } else {
      this.trySnapPaintStroke(object);
    }

    object.userData['paintParent'] = object.parent ?? null;
    object.updateMatrixWorld(true);
  }

  private trySnapPaintStroke(object: THREE.Object3D): void {
    const initialMatrix = object.matrixWorld.clone();
    const initialPosition = new THREE.Vector3().setFromMatrixPosition(initialMatrix);

    object.traverse((child) => {
      child.userData = { ...child.userData, isSnapped: true };
    });

    this.attachToCake(object);
    const snapResult = this.snapService.snapDecorationToCake(object);
    const snappedPosition = object.getWorldPosition(new THREE.Vector3());
    const displacement = snappedPosition.distanceTo(initialPosition);

    if (!snapResult.success || displacement > 0.2) {
      this.applyWorldMatrix(object, initialMatrix);
      this.attachToCake(object);
    }

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

  private applyWorldMatrix(object: THREE.Object3D, matrix: THREE.Matrix4): void {
    object.matrix.copy(matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    object.matrixWorld.copy(matrix);
    object.matrixWorldNeedsUpdate = false;
    object.updateMatrixWorld(true);
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

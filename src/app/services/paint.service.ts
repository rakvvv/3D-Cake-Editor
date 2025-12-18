import {Inject, Injectable, PLATFORM_ID} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {BehaviorSubject, firstValueFrom, Subject} from 'rxjs';
import * as THREE from 'three';
import {DecorationFactory} from '../factories/decoration.factory';
import {TransformManagerService} from './transform-manager.service';
import {SnapService} from './snap.service';
import {CakeMetadata, LayerMetadata} from '../factories/three-objects.factory';
import {ExtruderVariantInfo} from '../models/extruderVariantInfo';
import {environment} from '../../environments/environment';
import {
  CreamPathNode,
  CreamPosition,
  CreamRingPreset,
  defaultCreamRingPresets,
  normalizePresetAngles
} from '../models/cream-presets';
import {PaintStrokeInstance, PaintStrokePreset} from '../models/cake-preset';

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

@Injectable({ providedIn: 'root' })
export class PaintService {
  public paintMode = false;
  public currentBrush = 'trawa.glb';
  public isPainting = false;
  public paintTool: PaintTool = 'decoration';

  public penSize = 0.05;
  public penThickness = 0.02;
  public penColor = '#ff4d6d';
  public penOpacity = 1;
  public readonly sceneChanged$ = new Subject<void>();

  private readonly baseMinDistance = 0.02;
  private readonly baseMinTimeMs = 40;
  private readonly penSurfaceOffset = 0.003;
  private readonly penMaxInstances = 6000;
  private brushCache = new Map<string, THREE.Object3D>();
  private brushPromises = new Map<string, Promise<THREE.Object3D>>();
  private brushSizes = new Map<string, THREE.Vector3>();
  private brushScaleMultipliers = new Map<string, number>();
  private brushMetadata = new Map<
    string,
    {
      initialScale?: number;
      initialRotation?: [number, number, number];
      material?: {
        roughness?: number;
        metalness?: number;
      };
    }
  >();

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
  private readonly creamRingPresetsSubject = new BehaviorSubject<CreamRingPreset[]>(
    defaultCreamRingPresets.map((preset) => normalizePresetAngles(preset)),
  );
  private readonly extruderPathNodesSubject = new BehaviorSubject<CreamPathNode[]>([]);
  private extruderPathModeEnabled = false;
  private extruderPathLayerIndex = 0;
  private extruderPathPosition: CreamPosition = 'SIDE_ARC';
  private extruderPathRadiusOffset = 0;
  private extruderPathConfig: CreamRingPreset | null = null;
  private pendingPathReplaceIndex: number | null = null;
  private extruderPathMarkers: THREE.Mesh[] = [];
  private extruderPathMarkerGroup: THREE.Group | null = null;
  private extruderPathMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0xff7ea8, emissive: 0x331122 });
  private extruderPathMarkerGeometry = new THREE.SphereGeometry(0.02, 16, 12);

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
  private decorationGroups = new Map<string, THREE.Group>();

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
    void this.loadCreamRingPresets();
  }

  public async handlePaint(
    event: MouseEvent,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
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

    if (this.paintTool === 'extruder' && this.extruderPathModeEnabled) {
      if (event.type === 'mousedown') {
        this.captureExtruderPathPoint(pointOnCakeWorld);
      }
      return;
    }

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
    this.activeExtruderStrokeGroup = null;
    this.extruderStrokeInstances.clear();
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;
    this.extruderFirstInstance = null;
    this.activeDecorationGroup = null;
    this.decorationStrokeInstances.clear();
    this.decorationVariantCursor.clear();
  }

  private isPaintStroke(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData?.['isPaintStroke'] || current.userData?.['isSurfaceStroke']) {
        return true;
      }
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
        if (!this.activeDecorationGroup.userData['trackedInUndo']) {
          this.trackPaintAddition(this.activeDecorationGroup);
          this.activeDecorationGroup.userData['trackedInUndo'] = true;
        }
      } else if (this.sceneRef) {
        this.sceneRef.remove(this.activeDecorationGroup);
        this.decorationGroups.delete(this.activeDecorationGroup.userData['brushId']);
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

  public updatePenSettings(settings: { size?: number; thickness?: number; color?: string; opacity?: number }): void {
    if (settings.size !== undefined && settings.size > 0) {
      this.penSize = Math.max(settings.size, 0.005);
    }

    if (settings.thickness !== undefined && settings.thickness > 0) {
      this.penThickness = Math.max(settings.thickness, 0.003);
    }

    if (settings.color) {
      this.penColor = settings.color;
    }

    if (settings.opacity !== undefined) {
      this.penOpacity = THREE.MathUtils.clamp(settings.opacity, 0, 1);
      this.penMaterialCache.clear();
    }
  }

  public registerScene(scene: THREE.Scene): void {
    this.sceneRef = scene;
  }

  public undo(): THREE.Object3D | undefined {
    if (!this.sceneRef || !this.undoStack.length) {
      return;
    }

    const lastObject = this.undoStack.pop()!;
    lastObject.parent?.remove(lastObject);
    lastObject.userData['removedByUndo'] = true;
    this.redoStack.push(lastObject);
    this.notifySceneChanged();
    return lastObject;
  }

  public redo(): THREE.Object3D | undefined {
    if (!this.sceneRef || !this.redoStack.length) {
      return;
    }

    const object = this.redoStack.pop()!;
    const targetParent = this.getPaintParent(object) ?? this.sceneRef;
    targetParent.add(object);
    delete object.userData['removedByUndo'];
    this.undoStack.push(object);
    this.notifySceneChanged();
    return object;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public setBrushMetadata(
    brushId: string,
    metadata: {
      initialScale?: number;
      initialRotation?: [number, number, number];
      material?: { roughness?: number; metalness?: number };
    } | null,
  ): void {
    const previous = this.brushMetadata.get(brushId);
    const previousKey = previous ? JSON.stringify(previous) : null;
    const nextKey = metadata ? JSON.stringify(metadata) : null;
    if (previousKey === nextKey) {
      return;
    }

    if (metadata) {
      this.brushMetadata.set(brushId, metadata);
      this.brushScaleMultipliers.set(brushId, metadata.initialScale ?? 1);
    } else {
      this.brushMetadata.delete(brushId);
      this.brushScaleMultipliers.delete(brushId);
    }

    this.brushCache.delete(brushId);
    this.brushPromises.delete(brushId);
    this.decorationVariants.delete(brushId);
    this.decorationStrokeInstances.delete(brushId);
    this.decorationGroups.delete(brushId);
    this.brushSizes.delete(brushId);
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
    // Zawsze twórz nową grupę dla nowego pociągnięcia
    if (this.activeDecorationGroup) {
      return this.activeDecorationGroup;
    }

    const group = new THREE.Group();
    group.userData['isPaintDecoration'] = true;
    group.userData['displayName'] = 'Dekoracja malowana';
    group.userData['isPaintStroke'] = true;
    group.userData['paintStrokeType'] = 'decoration';
    group.userData['brushId'] = this.currentBrush;
    scene.add(group);
    this.redoStack = [];

    this.activeDecorationGroup = group;
    return group;
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
      const allValid = existing.every(state =>
        state.mesh.parent === decorationGroup &&
        state.count < this.extruderMaxInstances
      );
      if (allValid) {
        return existing;
      }
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
      mesh.userData['brushId'] = brushId;
      decorationGroup.add(mesh);

      return { mesh, count: 0 };
    });


    this.decorationStrokeInstances.set(brushId, states);
    return states;
  }

  private getDecorationScale(brushId: string): number {
    return this.brushScaleMultipliers.get(brushId) ?? 1;
  }

  private getDecorationSpacing(brushId: string): number {
    const templateSize = this.brushSizes.get(brushId);
    const scale = this.brushScaleMultipliers.get(brushId) ?? 1;

    if (templateSize) {
      const maxDim = Math.max(templateSize.x, templateSize.y, templateSize.z);
      const scaledMax = maxDim * scale;
      const spacing = scaledMax * 0.4; // 40% rozmiaru dekoracji
      return Math.max(this.baseMinDistance, spacing);
    }

    return this.baseMinDistance * 2;
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


    const normalDir = normal.clone().normalize();
    const templateSize = this.brushSizes.get(this.currentBrush);
    const scale = this.getDecorationScale(this.currentBrush);

    let depthInNormalDirection = 0;
    if (templateSize) {
      // Użyj najmniejszego wymiaru jako głębokości, nie największego
      const dims = [templateSize.x, templateSize.y, templateSize.z].sort((a, b) => a - b);
      depthInNormalDirection = dims[0] * scale; // najmniejszy wymiar
    }

    // Minimalny offset żeby nie było z-fighting, ale nie za duży
    const minOffset = 0.001;
    const maxOffset = 0.005; // maksymalny offset 5cm
    const calculatedOffset = depthInNormalDirection * 0.5 + minOffset;
    const offset = normalDir.clone().multiplyScalar(Math.min(calculatedOffset, maxOffset));

    const position = point.clone().add(offset);
    const qMeta = this.getBrushMetaQuat(this.currentBrush);
    const outAxis = this.getDefaultOutAxis(normalDir);
    const outAxisAfterMeta = outAxis.clone().applyQuaternion(qMeta).normalize();
    const align = new THREE.Quaternion().setFromUnitVectors(outAxisAfterMeta, normalDir);
    const spin = new THREE.Quaternion().setFromAxisAngle(normalDir, Math.random() * Math.PI * 2);
    const rotation = spin.clone().multiply(align).multiply(qMeta).normalize();

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

  public getCakeMetadataSnapshot(): CakeMetadata | null {
    return this.snapService.getCakeMetadataSnapshot();
  }

  public getLayerOptions(): number[] {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    if (!metadata) {
      return [0];
    }

    return Array.from({ length: metadata.layers }, (_, index) => index);
  }

  public getExtruderPreview(
    config: CreamRingPreset,
  ): { angleDeg: number; heightNorm: number; position: THREE.Vector3 }[] {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    if (!metadata) {
      return [];
    }

    const normalizedPreset = this.normalizePresetForMetadata(config, metadata);
    if (!normalizedPreset) {
      return [];
    }

    const layer = metadata.layerDimensions[normalizedPreset.layerIndex];
    if (!layer) {
      return [];
    }

    const layerSpan = Math.max(1e-6, layer.topY - layer.bottomY);

    const path = this.buildExtruderPath(normalizedPreset, metadata);
    return path.map((point) => ({
      angleDeg: THREE.MathUtils.radToDeg(Math.atan2(point.position.z, point.position.x)),
      heightNorm: THREE.MathUtils.clamp((point.position.y - layer.bottomY) / layerSpan, 0, 1),
      position: point.position.clone(),
    }));
  }

  public async getExtruderVariantPreviews(): Promise<{ id: number; name: string; thumbnail: string | null }[]> {
    const variants = await this.getExtruderVariants();
    return variants.map((variant, index) => ({
      id: index,
      name: variant.name || `Wariant ${index + 1}`,
      thumbnail: this.getExtruderVariantThumbnail(index, variant),
    }));
  }

  public getCreamRingPresets(): CreamRingPreset[] {
    return this.creamRingPresetsSubject.value;
  }

  public get creamRingPresets$() {
    return this.creamRingPresetsSubject.asObservable();
  }

  public exportPaintStrokes(scene?: THREE.Scene): PaintStrokePreset[] {
    const targetScene = scene ?? this.sceneRef;
    if (!targetScene) {
      return [];
    }

    const roots = this.collectPaintStrokeRoots(targetScene);
    return roots.map((root) => this.serializePaintStroke(root)).filter((item): item is PaintStrokePreset => Boolean(item));
  }

  public get extruderPathNodes$() {
    return this.extruderPathNodesSubject.asObservable();
  }

  public async loadCreamRingPresets(url = '/assets/cream-ring-presets.json'): Promise<void> {
    try {
      const presets = await firstValueFrom(this.http.get<CreamRingPreset[]>(url));
      this.setCreamRingPresets(presets ?? []);
    } catch (error) {
      console.warn('PaintService: nie udało się wczytać presetów kremu', error);
      if (!this.creamRingPresetsSubject.value.length) {
        this.setCreamRingPresets(defaultCreamRingPresets);
      }
    }
  }

  public setExtruderPathMode(enabled: boolean): void {
    this.extruderPathModeEnabled = enabled;
    if (!enabled) {
      this.pendingPathReplaceIndex = null;
      this.updateExtruderPathMarkers([]);
    }
  }

  public setExtruderPathLayer(layerIndex: number): void {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    this.extruderPathLayerIndex = metadata ? this.resolveLayerIndex(layerIndex, metadata) : Math.max(0, layerIndex);
  }

  public setExtruderPathContext(config: CreamRingPreset): void {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    this.extruderPathLayerIndex = metadata
      ? this.resolveLayerIndex(config.layerIndex, metadata)
      : Math.max(0, config.layerIndex);
    this.extruderPathPosition = config.position;
    this.extruderPathRadiusOffset = config.radiusOffset ?? 0;
    this.extruderPathConfig = { ...config, nodes: config.nodes ?? this.extruderPathNodesSubject.value };
    this.updateExtruderPathMarkers(this.extruderPathNodesSubject.value, config);
  }

  public setExtruderPathNodes(nodes: CreamPathNode[], config?: CreamRingPreset): void {
    this.extruderPathNodesSubject.next(nodes.map((node) => ({ ...node })));
    if (config) {
      this.setExtruderPathContext(config);
    } else {
      this.updateExtruderPathMarkers(nodes);
    }
  }

  public async restorePaintStrokes(entries: PaintStrokePreset[], scene: THREE.Scene): Promise<void> {
    if (!entries?.length) {
      return;
    }

    this.sceneRef = scene;
    const cakeBase = this.snapService.getCakeBase() ?? this.cakeBaseRef ?? null;
    this.cakeBaseRef = cakeBase;

    for (const entry of entries) {
      switch (entry.type) {
        case 'extruder':
          await this.restoreExtruderStroke(entry, scene, cakeBase);
          break;
        case 'pen':
          await this.restorePenStroke(entry, scene);
          break;
        case 'decoration':
          await this.restoreDecorationStroke(entry, scene);
          break;
      }
    }
  }

  public requestPathNodeReplacement(index: number | null): void {
    this.pendingPathReplaceIndex = index;
  }

  public captureExtruderPathPoint(worldPoint: THREE.Vector3): void {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    if (!metadata) {
      return;
    }

    const layerIndex = this.resolveLayerIndex(this.extruderPathLayerIndex, metadata);
    const layer = metadata.layerDimensions[layerIndex];
    if (!layer) {
      return;
    }

    const localPoint = this.cakeBaseRef?.worldToLocal(worldPoint.clone()) ?? worldPoint.clone();
    const heightSpan = Math.max(1e-6, layer.topY - layer.bottomY);
    const heightNorm = THREE.MathUtils.clamp((localPoint.y - layer.bottomY) / heightSpan, 0, 1);
    const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(localPoint.z, localPoint.x));

    const nodes = this.extruderPathNodesSubject.value.map((node) => ({ ...node }));
    const newNode: CreamPathNode = { angleDeg, heightNorm };

    if (
      this.pendingPathReplaceIndex !== null &&
      this.pendingPathReplaceIndex >= 0 &&
      this.pendingPathReplaceIndex < nodes.length
    ) {
      nodes[this.pendingPathReplaceIndex] = newNode;
    } else {
      nodes.push(newNode);
    }

    this.pendingPathReplaceIndex = null;
    const config = this.extruderPathConfig ?? this.buildPathEditorConfig(nodes, layerIndex);
    this.setExtruderPathNodes(nodes, config ?? undefined);
  }

  private buildPathEditorConfig(nodes: CreamPathNode[], layerIndex: number): CreamRingPreset | null {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    if (!metadata) {
      return null;
    }

    return {
      id: 'path-editor',
      name: 'Ścieżka ekstrudera',
      mode: 'PATH',
      layerIndex: this.resolveLayerIndex(layerIndex, metadata),
      position: this.extruderPathPosition,
      heightNorm: nodes[0]?.heightNorm ?? 0.5,
      radiusOffset: this.extruderPathRadiusOffset,
      nodes: nodes.map((node) => ({ ...node })),
    };
  }

  private updateExtruderPathMarkers(nodes: CreamPathNode[], config?: CreamRingPreset): void {
    if (!this.sceneRef || !this.extruderPathModeEnabled) {
      this.clearExtruderPathMarkers();
      return;
    }

    const metadata = this.snapService.getCakeMetadataSnapshot();
    if (!metadata || !nodes.length) {
      this.clearExtruderPathMarkers();
      return;
    }

    const preset = config ?? this.extruderPathConfig ?? this.buildPathEditorConfig(nodes, this.extruderPathLayerIndex);
    if (!preset) {
      this.clearExtruderPathMarkers();
      return;
    }

    const normalizedPreset = this.normalizePresetForMetadata(preset, metadata);
    if (!normalizedPreset || normalizedPreset.mode !== 'PATH' || !normalizedPreset.nodes?.length) {
      this.clearExtruderPathMarkers();
      return;
    }

    const layer = metadata.layerDimensions[this.resolveLayerIndex(normalizedPreset.layerIndex, metadata)];
    if (!layer) {
      this.clearExtruderPathMarkers();
      return;
    }

    const { radiusX, radiusZ } = this.getLayerRadii(layer, metadata);
    const adjustedRadiusX = Math.max(0.01, radiusX + (normalizedPreset.radiusOffset ?? 0));
    const adjustedRadiusZ = Math.max(0.01, radiusZ + (normalizedPreset.radiusOffset ?? 0));

    const markerPositions = normalizedPreset.nodes.map((node) => {
      const angle = THREE.MathUtils.degToRad(node.angleDeg);
      const height = this.getCreamHeightForPreset(normalizedPreset, layer, metadata, node.heightNorm);
      return new THREE.Vector3(adjustedRadiusX * Math.cos(angle), height, adjustedRadiusZ * Math.sin(angle));
    });

    const markerGroup = this.ensureExtruderMarkerGroup();
    if (!markerGroup) {
      return;
    }

    this.clearExtruderPathMarkers();
    this.extruderPathMarkers = markerPositions.map((position, index) => {
      const marker = new THREE.Mesh(this.extruderPathMarkerGeometry, this.extruderPathMarkerMaterial.clone());
      marker.position.copy(position);
      marker.renderOrder = 2;
      marker.material = marker.material as THREE.MeshStandardMaterial;
      (marker.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
      marker.userData['label'] = index + 1;
      markerGroup.add(marker);
      return marker;
    });
  }

  private ensureExtruderMarkerGroup(): THREE.Group | null {
    const parent = this.cakeBaseRef ?? this.sceneRef;
    if (!parent) {
      return null;
    }

    if (!this.extruderPathMarkerGroup) {
      this.extruderPathMarkerGroup = new THREE.Group();
      this.extruderPathMarkerGroup.name = 'extruder-path-markers';
      this.extruderPathMarkerGroup.renderOrder = 2;
    }

    if (this.extruderPathMarkerGroup.parent !== parent) {
      this.extruderPathMarkerGroup.parent?.remove(this.extruderPathMarkerGroup);
      parent.add(this.extruderPathMarkerGroup);
    }

    return this.extruderPathMarkerGroup;
  }

  private clearExtruderPathMarkers(): void {
    if (this.extruderPathMarkers.length && this.extruderPathMarkerGroup) {
      this.extruderPathMarkers.forEach((marker) => this.extruderPathMarkerGroup?.remove(marker));
    }
    this.extruderPathMarkers = [];
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

  public async insertExtruderPreset(presetId: string): Promise<void> {
    await this.insertCreamRingPreset(presetId);
  }

  public async insertCreamRingPreset(presetId: string): Promise<void> {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    if (!metadata) {
      return;
    }

    const preset = this.resolveCreamPreset(presetId, metadata);
    if (!preset) {
      return;
    }

    await this.generateExtruderStroke(preset);
  }

  public async generateExtruderStroke(config: CreamRingPreset): Promise<void> {
    const metadata = this.snapService.getCakeMetadataSnapshot();
    const variants = await this.getExtruderVariants();
    if (!metadata || !this.sceneRef || !variants.length) {
      return;
    }

    const preset = this.normalizePresetForMetadata(config, metadata);
    if (!preset) {
      return;
    }

    const strokeGroup = new THREE.Group();
    strokeGroup.userData['isPaintStroke'] = true;
    strokeGroup.userData['paintStrokeType'] = 'extruder';
    strokeGroup.userData['displayName'] = `Ekstruder – ${preset.name}`;
    strokeGroup.userData['snapPoints'] = [] as number[][];
    this.sceneRef.add(strokeGroup);

    const previousGroup = this.activeExtruderStrokeGroup;
    const previousInstances = this.extruderStrokeInstances;
    const previousPoint = this.extruderLastPlacedPoint;
    const previousNormal = this.extruderLastNormal;
    const previousFirstInstance = this.extruderFirstInstance;

    this.activeExtruderStrokeGroup = strokeGroup;
    this.extruderStrokeInstances = new Map();
    this.extruderLastPlacedPoint = null;
    this.extruderLastNormal = null;
    this.extruderFirstInstance = null;

    this.populateExtruderStroke(preset, metadata, variants, strokeGroup);

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
    this.extruderFirstInstance = previousFirstInstance;
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
    scaleMultiplier = 1,
    colorOverride?: string,
  ): void {
    if (!variants.length) {
      return;
    }

    const selectedIndex = typeof variantIndex === 'number' ? variantIndex : this.selectExtruderVariant(variants.length);
    const variant = variants[selectedIndex];
    const scale = this.getExtruderScale(variant) * scaleMultiplier;
    const transform = this.buildExtruderMatrix(position, normal, tangent, scale);

    const state = this.ensureExtruderInstanceMesh(selectedIndex, variant, strokeGroup, colorOverride);
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
    colorOverride?: string,
  ): ExtruderInstanceState {
    const existing = this.extruderStrokeInstances.get(variantIndex);
    if (existing) {
      return existing;
    }

    const mesh = new THREE.InstancedMesh(
      variant.geometry,
      colorOverride ? this.cloneExtruderMaterial(variant.material, colorOverride) : variant.material,
      this.extruderMaxInstances,
    );
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData['isPaintStroke'] = true;
    mesh.userData['variantSourceId'] = variant.sourceId;
    mesh.userData['variantIndex'] = variantIndex;
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

  private populateExtruderStroke(
    preset: CreamRingPreset,
    metadata: CakeMetadata,
    variants: ExtruderVariantData[],
    strokeGroup: THREE.Group,
  ): void {
    const ringPoints = this.buildExtruderPath(preset, metadata);
    if (!ringPoints.length) {
      return;
    }

    const cakeBase = this.snapService.getCakeBase() ?? this.cakeBaseRef;
    const matrixWorld = cakeBase?.matrixWorld;
    const normalMatrix = matrixWorld ? new THREE.Matrix3().getNormalMatrix(matrixWorld) : null;

    const worldPoints = matrixWorld
      ? ringPoints.map((point) => ({
          position: point.position.clone().applyMatrix4(matrixWorld),
          normal: point.normal.clone().applyMatrix3(normalMatrix!).normalize(),
          tangent: point.tangent.clone().applyMatrix3(normalMatrix!).normalize(),
        }))
      : ringPoints;

    const offset = this.getExtruderSurfaceOffset(variants);
    const minSpacing = this.getExtruderAverageSpacing(variants, preset.scale ?? 1) * 0.8;
    const scaleMultiplier = preset.scale ?? 1;
    let lastPlaced: THREE.Vector3 | null = null;

    worldPoints.forEach((point) => {
      this.recordPaintSnapPoint(point.position, strokeGroup);
      const current = point.position.clone().add(point.normal.clone().multiplyScalar(offset));

      if (!lastPlaced) {
        this.addExtruderInstance(
          current,
          point.normal,
          point.tangent,
          variants,
          strokeGroup,
          undefined,
          scaleMultiplier,
          preset.color,
        );
        this.alignFirstExtruderInstance(point.tangent, point.normal);
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
        const spacing = this.getExtruderSpacing(variants, variantIndex, scaleMultiplier);
        const step = Math.min(spacing, remaining);
        cursor = cursor.add(tangent.clone().multiplyScalar(step));
        this.addExtruderInstance(cursor, point.normal, tangent, variants, strokeGroup, variantIndex, scaleMultiplier, preset.color);
        lastPlaced = cursor.clone();
        remaining = cursor.distanceTo(current);
      }

      if (!lastPlaced || lastPlaced.distanceTo(current) > minSpacing * 0.6) {
        const variantIndex = this.selectExtruderVariant(variants.length);
        this.addExtruderInstance(current, point.normal, tangent, variants, strokeGroup, variantIndex, scaleMultiplier, preset.color);
        lastPlaced = current.clone();
      }
    });
  }

  private buildExtruderPath(
    preset: CreamRingPreset,
    metadata: CakeMetadata,
  ): { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] {
    const layerIndex = this.resolveLayerIndex(preset.layerIndex, metadata);
    const layer = metadata.layerDimensions[layerIndex];
    if (!layer) {
      return [];
    }

    const { radiusX, radiusZ } = this.getLayerRadii(layer, metadata);
    const radiusOffset = preset.radiusOffset ?? 0;
    const adjustedRadiusX = Math.max(0.01, radiusX + radiusOffset);
    const adjustedRadiusZ = Math.max(0.01, radiusZ + radiusOffset);

    switch (preset.mode) {
      case 'PATH':
        return this.buildPathFromNodes(preset, layer, metadata, adjustedRadiusX, adjustedRadiusZ);
      case 'ARC':
      case 'RING':
      default:
        return this.buildCircularExtruderPath(preset, layer, metadata, adjustedRadiusX, adjustedRadiusZ);
    }
  }

  private buildCircularExtruderPath(
    preset: CreamRingPreset,
    layer: LayerMetadata,
    metadata: CakeMetadata,
    adjustedRadiusX: number,
    adjustedRadiusZ: number,
  ): { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] {
    const height = this.getCreamHeightForPreset(preset, layer, metadata);
    const angles = normalizePresetAngles(preset);
    const start = THREE.MathUtils.degToRad(angles.startAngleDeg ?? 0);
    const end = THREE.MathUtils.degToRad(angles.endAngleDeg ?? 360);
    const span = Math.abs(end - start);
    const baseSegments = preset.segments ?? Math.max(32, Math.ceil((span / (Math.PI * 2)) * 128));
    const segments = Math.max(2, baseSegments);
    const points: { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = start + (end - start) * t;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const radial = new THREE.Vector3(cos, 0, sin).normalize();
      const position = new THREE.Vector3(adjustedRadiusX * cos, height, adjustedRadiusZ * sin);
      const tangent = new THREE.Vector3(-sin * adjustedRadiusX, 0, cos * adjustedRadiusZ);
      if (tangent.lengthSq() <= 1e-6) {
        tangent.set(1, 0, 0);
      } else {
        tangent.normalize();
      }

      points.push({ position, normal: radial, tangent });
    }

    return points;
  }

  private buildPathFromNodes(
    preset: CreamRingPreset,
    layer: LayerMetadata,
    metadata: CakeMetadata,
    adjustedRadiusX: number,
    adjustedRadiusZ: number,
  ): { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] {
    const nodes = this.normalizeNodes(preset);
    if (nodes.length < 2) {
      return [];
    }

    const totalSegments = Math.max(1, preset.segments ?? nodes.length * 8);
    const points: { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] = [];
    let lastPosition: THREE.Vector3 | null = null;
    let segmentsLeft = totalSegments;

    nodes.forEach((node, index) => {
      if (index === nodes.length - 1) {
        return;
      }

      const next = nodes[index + 1];
      const steps = Math.max(1, Math.round(segmentsLeft / (nodes.length - 1 - index)));
      const startAngle = THREE.MathUtils.degToRad(node.angleDeg);
      const endAngle = THREE.MathUtils.degToRad(next.angleDeg);
      const startHeight = this.getCreamHeightForPreset(preset, layer, metadata, node.heightNorm);
      const endHeight = this.getCreamHeightForPreset(preset, layer, metadata, next.heightNorm);

      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        const angle = startAngle + (endAngle - startAngle) * t;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const height = THREE.MathUtils.lerp(startHeight, endHeight, t);
        const position = new THREE.Vector3(adjustedRadiusX * cos, height, adjustedRadiusZ * sin);
        const normal = new THREE.Vector3(cos / Math.max(1e-6, adjustedRadiusX), 0, sin / Math.max(1e-6, adjustedRadiusZ)).normalize();

        let tangent: THREE.Vector3;
        if (lastPosition) {
          tangent = position.clone().sub(lastPosition);
          if (tangent.lengthSq() <= 1e-6) {
            tangent = new THREE.Vector3(-sin * adjustedRadiusX, 0, cos * adjustedRadiusZ);
          }
        } else {
          tangent = new THREE.Vector3(-sin * adjustedRadiusX, 0, cos * adjustedRadiusZ);
        }

        if (tangent.lengthSq() > 1e-6) {
          tangent.normalize();
        } else {
          tangent.set(1, 0, 0);
        }

        points.push({ position, normal, tangent });
        lastPosition = position.clone();
      }

      segmentsLeft = Math.max(0, segmentsLeft - steps);
    });

    return points;
  }

  private normalizeNodes(preset: CreamRingPreset): CreamPathNode[] {
    const fallbackNodes: CreamPathNode[] = [
      { angleDeg: preset.startAngleDeg ?? 0, heightNorm: preset.heightNorm },
      { angleDeg: preset.endAngleDeg ?? (preset.startAngleDeg ?? 0) + 180, heightNorm: preset.heightNorm },
    ];
    const base = preset.nodes && preset.nodes.length >= 2 ? preset.nodes : fallbackNodes;

    return base.map((node) => ({
      angleDeg: THREE.MathUtils.euclideanModulo(node.angleDeg, 360),
      heightNorm: node.heightNorm ?? preset.heightNorm ?? (preset.position === 'TOP_EDGE' ? 1 : preset.position === 'BOTTOM_EDGE' ? 0 : 0.5),
    }));
  }

  private getLayerRadii(layer: LayerMetadata, metadata: CakeMetadata): { radiusX: number; radiusZ: number } {
    const baseRadius = layer.radius ?? metadata.radius ?? metadata.maxRadius ?? 1;
    const baseWidth = layer.width ?? metadata.width ?? metadata.maxWidth ?? baseRadius * 2;
    const baseDepth = layer.depth ?? metadata.depth ?? metadata.maxDepth ?? baseRadius * 2;

    const radiusX = layer.radius ?? baseWidth / 2;
    const radiusZ = layer.radius ?? baseDepth / 2;
    return { radiusX, radiusZ };
  }

  private resolveLayerIndex(layerIndex: number, metadata: CakeMetadata): number {
    if (metadata.layers <= 0) {
      return 0;
    }

    const rounded = Math.floor(layerIndex);
    if (rounded < 0) {
      return metadata.layers - 1;
    }

    return Math.min(Math.max(0, rounded), metadata.layers - 1);
  }

  private getCreamHeightForPreset(
    preset: CreamRingPreset,
    layer: LayerMetadata,
    metadata: CakeMetadata,
    overrideHeight?: number,
  ): number {
    const layerHeight = layer.height ?? metadata.layerHeight;
    const normalizedHeight = THREE.MathUtils.clamp(
      overrideHeight ?? preset.heightNorm ?? (preset.position === 'TOP_EDGE' ? 1 : preset.position === 'BOTTOM_EDGE' ? 0 : 0.5),
      0,
      1,
    );

    const bottom = layer.bottomY;
    const top = layer.topY + (metadata.glazeTopOffset ?? 0);
    const span = Math.max(1e-6, top - bottom);
    const baseHeight = THREE.MathUtils.clamp(bottom + span * normalizedHeight, bottom, top);

    if (preset.position === 'TOP_EDGE') {
      return Math.min(top, baseHeight + (layerHeight ?? span) * 0.015);
    }
    if (preset.position === 'BOTTOM_EDGE') {
      return Math.max(bottom, baseHeight - (layerHeight ?? span) * 0.015);
    }

    return baseHeight;
  }

  private resolveCreamPreset(presetId: string, metadata: CakeMetadata): CreamRingPreset | null {
    const preset = this.getCreamRingPresets().find((item) => item.id === presetId) ?? this.getCreamRingPresets()[0];
    if (!preset) {
      return null;
    }

    return this.normalizePresetForMetadata(preset, metadata);
  }

  private normalizePresetForMetadata(preset: CreamRingPreset, metadata: CakeMetadata): CreamRingPreset | null {
    const normalized = normalizePresetAngles({ ...preset, mode: preset.mode ?? 'RING' });
    const clampedLayer = this.resolveLayerIndex(normalized.layerIndex, metadata);
    const sanitizedNodes = normalized.nodes?.map((node) => ({
      angleDeg: THREE.MathUtils.euclideanModulo(node.angleDeg, 360),
      heightNorm: node.heightNorm,
    }));

    return { ...normalized, layerIndex: clampedLayer, nodes: sanitizedNodes };
  }

  private setCreamRingPresets(presets: CreamRingPreset[]): void {
    this.creamRingPresetsSubject.next(this.normalizeCreamRingPresets(presets));
  }

  private normalizeCreamRingPresets(presets: CreamRingPreset[]): CreamRingPreset[] {
    return presets.map((preset) => normalizePresetAngles(preset));
  }

  private getExtruderSurfaceOffset(variants: ExtruderVariantData[]): number {
    if (!variants.length) {
      return this.penSurfaceOffset;
    }

    const maxHeight = Math.max(...variants.map((variant) => variant.size.y * this.getExtruderScale(variant)));
    return Math.max(this.penSurfaceOffset * 0.25, maxHeight * 0.08);
  }

  private getExtruderAverageSpacing(variants: ExtruderVariantData[], scaleMultiplier = 1): number {
    if (!variants.length) {
      return this.extruderTargetWidth * scaleMultiplier;
    }

    const spacings = variants.map((variant, index) => this.getExtruderSpacing(variants, index, scaleMultiplier));
    const average = spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
    return Math.max(0.005, average);
  }

  private getExtruderSpacing(
    variants: ExtruderVariantData[],
    variantIndex: number,
    scaleMultiplier = 1,
  ): number {
    const variant = variants[variantIndex];
    const width = this.getExtruderVariantWidth(variant);
    return Math.max(this.penSurfaceOffset, width * this.getExtruderScale(variant) * scaleMultiplier);
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

  private cloneExtruderMaterial(base: THREE.Material, colorOverride?: string): THREE.Material {
    const material = base.clone();
    if (colorOverride && (material as THREE.MeshStandardMaterial).color) {
      (material as THREE.MeshStandardMaterial).color = new THREE.Color(colorOverride);
    }

    return material;
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
        const metadata = this.brushMetadata.get(brushId);
        if (metadata) {
          this.applyBrushMetadataToTemplate(model, metadata);
        }
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
    mesh.userData['penPart'] = 'cap';
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
    material.opacity = this.penOpacity;
    material.transparent = this.penOpacity < 1;
    material.depthWrite = this.penOpacity >= 1;
    material.needsUpdate = true;
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
      this.activePenStrokeGroup.userData['penSize'] = this.penSize;
      this.activePenStrokeGroup.userData['penThickness'] = this.penThickness;
      this.activePenStrokeGroup.userData['penColor'] = this.penColor;
      this.activePenStrokeGroup.userData['penOpacity'] = this.penOpacity;
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
    mesh.userData['penPart'] = 'joint';
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

  private applyBrushMetadataToTemplate(
    model: THREE.Object3D,
    metadata: {
      initialScale?: number;
      initialRotation?: [number, number, number];
      material?: { roughness?: number; metalness?: number };
    },
  ): void {

    if (metadata.initialRotation) {
      const [x, y, z] = metadata.initialRotation;
      model.rotation.set(
        THREE.MathUtils.degToRad(x ?? 0),
        THREE.MathUtils.degToRad(y ?? 0),
        THREE.MathUtils.degToRad(z ?? 0),
      );
    }

    if (metadata.material) {
      this.applyMaterialOverrides(model, metadata.material);
    }

    model.updateMatrixWorld(true);
  }

  private computeBrushSize(model: THREE.Object3D): THREE.Vector3 {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size;
  }

  private applyMaterialOverrides(
    object: THREE.Object3D,
    materialConfig?: { roughness?: number; metalness?: number },
  ): void {
    if (!materialConfig) {
      return;
    }

    object.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) {
        return;
      }

      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((material) => {
        const hasUnlitExtension = !!(material as any).userData?.gltfExtensions?.KHR_materials_unlit;
        if (hasUnlitExtension) {
          return;
        }

        if (materialConfig.roughness !== undefined && 'roughness' in material) {
          (material as any).roughness = materialConfig.roughness;
          material.needsUpdate = true;
        }

        if (materialConfig.metalness !== undefined && 'metalness' in material) {
          (material as any).metalness = materialConfig.metalness;
          material.needsUpdate = true;
        }
      });
    });
  }

  private recordPaintSnapPoint(point: THREE.Vector3, strokeGroup: THREE.Group): void {
    if (!strokeGroup.userData['snapPoints']) {
      strokeGroup.userData['snapPoints'] = [] as number[][];
    }

    const snapPoints = strokeGroup.userData['snapPoints'] as number[][];
    snapPoints.push(point.toArray());
  }

  private collectPaintStrokeRoots(scene: THREE.Scene): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    const visit = (object: THREE.Object3D) => {
      const isStroke = object.userData?.['isPaintStroke'] === true;
      const parentStroke = object.parent?.userData?.['isPaintStroke'] === true;
      if (isStroke && !parentStroke) {
        roots.push(object);
      }
      object.children.forEach((child) => visit(child));
    };

    visit(scene);
    return roots;
  }

  private serializePaintStroke(root: THREE.Object3D): PaintStrokePreset | null {
    const paintType = (root.userData['paintStrokeType'] as PaintStrokePreset['type'] | undefined) ?? 'extruder';
    const base: PaintStrokePreset = {
      type: paintType,
      color: root.userData['penColor'] as string | undefined,
      brushId: root.userData['brushId'] as string | undefined,
      penSize: root.userData['penSize'] as number | undefined,
      penThickness: root.userData['penThickness'] as number | undefined,
      penOpacity: root.userData['penOpacity'] as number | undefined,
      penCapsEnabled: true,
      instances: [],
      snapPoints: root.userData['snapPoints'] as number[][] | undefined,
      name: root.userData['displayName'] as string | undefined,
    };

    const instancedMeshes: THREE.InstancedMesh[] = [];
    root.traverse((child) => {
      const mesh = child as THREE.InstancedMesh;
      if ((mesh as any).isInstancedMesh && mesh.count > 0) {
        instancedMeshes.push(mesh);
      }
    });

    instancedMeshes.forEach((mesh) => {
      const entries: PaintStrokeInstance[] = [];
      const matrix = new THREE.Matrix4();
      const color = (mesh.instanceColor as THREE.InstancedBufferAttribute | undefined)?.array ?? null;
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, matrix);
        const item: PaintStrokeInstance = { matrix: matrix.toArray() };
        const penPart = mesh.userData['penPart'] as PaintStrokeInstance['penPart'] | undefined;
        if (penPart) {
          item.penPart = penPart;
        }
        if (color) {
          const offset = i * 3;
          item.color = [color[offset], color[offset + 1], color[offset + 2]];
        }
        entries.push(item);
      }

      if (paintType === 'extruder') {
        base.variantSourceId = (mesh.userData['variantSourceId'] as string | undefined) ?? base.variantSourceId;
        base.variantIndex = (mesh.userData['variantIndex'] as number | undefined) ?? base.variantIndex;
        const materialColor = (mesh.material as THREE.MeshStandardMaterial | undefined)?.color;
        if (materialColor) {
          base.color = `#${materialColor.getHexString()}`;
        }
      }

      if (paintType === 'decoration' && mesh.userData['brushId']) {
        base.brushId = mesh.userData['brushId'];
      }

      base.instances.push(...entries);
    });

    if (!base.instances.length) {
      return null;
    }

    return base;
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

  private async restoreExtruderStroke(
    entry: PaintStrokePreset,
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
  ): Promise<void> {
    const variants = await this.getExtruderVariants();
    const variantIndex = typeof entry.variantIndex === 'number'
      ? entry.variantIndex
      : variants.findIndex((v) => v.sourceId === entry.variantSourceId);
    const targetVariantIndex = variantIndex >= 0 ? variantIndex : 0;
    const variant = variants[targetVariantIndex];
    if (!variant) {
      return;
    }

    const strokeGroup = new THREE.Group();
    strokeGroup.userData['isPaintStroke'] = true;
    strokeGroup.userData['paintStrokeType'] = 'extruder';
    strokeGroup.userData['snapPoints'] = entry.snapPoints ?? [];
    strokeGroup.userData['displayName'] = entry.name ?? 'Ekstruder';
    scene.add(strokeGroup);

    const previousGroup = this.activeExtruderStrokeGroup;
    const previousInstances = this.extruderStrokeInstances;
    this.activeExtruderStrokeGroup = strokeGroup;
    this.extruderStrokeInstances = new Map();

    const state = this.ensureExtruderInstanceMesh(targetVariantIndex, variant, strokeGroup, entry.color);
    const matrix = new THREE.Matrix4();
    entry.instances.forEach((instance, index) => {
      if (index >= this.extruderMaxInstances) {
        return;
      }
      matrix.fromArray(instance.matrix);
      state.mesh.setMatrixAt(index, matrix);
    });
    state.mesh.count = Math.min(entry.instances.length, this.extruderMaxInstances);
    state.mesh.instanceMatrix.needsUpdate = true;
    state.count = state.mesh.count;

    this.finalizePaintRoot(strokeGroup);
    this.trackPaintAddition(strokeGroup);

    this.activeExtruderStrokeGroup = previousGroup;
    this.extruderStrokeInstances = previousInstances;
    if (cakeBase) {
      this.cakeBaseRef = cakeBase;
    }
  }

  private getBrushMetaQuat(brushId: string): THREE.Quaternion {
    const meta = this.brushMetadata.get(brushId);
    const q = new THREE.Quaternion();
    if (!meta?.initialRotation) return q;

    const [x, y, z] = meta.initialRotation;
    const e = new THREE.Euler(
      THREE.MathUtils.degToRad(x ?? 0),
      THREE.MathUtils.degToRad(y ?? 0),
      THREE.MathUtils.degToRad(z ?? 0),
      'XYZ',
    );
    q.setFromEuler(e);
    return q;
  }

  private getDefaultOutAxis(normalDir: THREE.Vector3): THREE.Vector3 {
    if (Math.abs(normalDir.y) > 0.75) {
      return new THREE.Vector3(0, 1, 0); // UP
    }
    return new THREE.Vector3(0, 0, 1);   // FORWARD
  }

  private axisVector(axis: 'X' | 'Y' | 'Z'): THREE.Vector3 {
    if (axis === 'X') return new THREE.Vector3(1, 0, 0);
    if (axis === 'Y') return new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3(0, 0, 1);
  }

  private getWorldNormalDeco(hit: THREE.Intersection): THREE.Vector3 {
    const n = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
    n.transformDirection(hit.object.matrixWorld).normalize();
    return n;
  }

  private projectOnPlane(v: THREE.Vector3, planeNormal: THREE.Vector3): THREE.Vector3 {
    return v.sub(planeNormal.clone().multiplyScalar(v.dot(planeNormal)));
  }


  private async restoreDecorationStroke(entry: PaintStrokePreset, scene: THREE.Scene): Promise<void> {
    const brushId = entry.brushId ?? this.currentBrush;
    const variants = await this.getDecorationVariants(brushId);
    if (!variants.length) {
      return;
    }

    const group = new THREE.Group();
    group.userData['isPaintStroke'] = true;
    group.userData['isPaintDecoration'] = true;
    group.userData['paintStrokeType'] = 'decoration';
    group.userData['brushId'] = brushId;
    group.userData['displayName'] = entry.name ?? 'Dekoracja malowana';
    scene.add(group);

    const targetVariant = variants[0];
    const mesh = new THREE.InstancedMesh(targetVariant.geometry, targetVariant.material, this.extruderMaxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData['isPaintDecoration'] = true;
    mesh.userData['isPaintStroke'] = true;
    mesh.userData['brushId'] = brushId;
    group.add(mesh);

    const matrix = new THREE.Matrix4();
    entry.instances.forEach((instance, index) => {
      if (index >= this.extruderMaxInstances) {
        return;
      }
      matrix.fromArray(instance.matrix);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = Math.min(entry.instances.length, this.extruderMaxInstances);
    mesh.instanceMatrix.needsUpdate = true;

    this.finalizePaintRoot(group);
    this.trackPaintAddition(group);
  }

  private async restorePenStroke(entry: PaintStrokePreset, scene: THREE.Scene): Promise<void> {
    const previousColor = this.penColor;
    const previousSize = this.penSize;
    const previousThickness = this.penThickness;
    const previousOpacity = this.penOpacity;
    this.penColor = entry.color ?? this.penColor;
    this.penSize = entry.penSize ?? this.penSize;
    this.penThickness = entry.penThickness ?? this.penThickness;
    this.penOpacity = entry.penOpacity ?? this.penOpacity;

    const group = new THREE.Group();
    group.userData['isPaintStroke'] = true;
    group.userData['paintStrokeType'] = 'pen';
    group.userData['penColor'] = this.penColor;
    group.userData['penSize'] = this.penSize;
    group.userData['penThickness'] = this.penThickness;
    group.userData['penOpacity'] = this.penOpacity;
    scene.add(group);

    const segmentState = this.ensurePenSegmentInstanceMesh(group);
    const jointState = this.ensurePenJointInstanceMesh(group);
    const capState = this.ensurePenCapInstanceMesh(group);

    const matrix = new THREE.Matrix4();
    entry.instances.forEach((instance) => {
      matrix.fromArray(instance.matrix);
      const target = instance.penPart === 'joint' ? jointState
        : instance.penPart === 'cap' ? capState
          : segmentState;
      if (target.count >= this.penMaxInstances) {
        return;
      }
      target.mesh.setMatrixAt(target.count, matrix);
      target.count += 1;
    });

    [segmentState, jointState, capState].forEach((state) => {
      state.mesh.count = state.count;
      state.mesh.instanceMatrix.needsUpdate = true;
    });

    this.finalizePaintRoot(group);
    this.trackPaintAddition(group);

    this.penColor = previousColor;
    this.penSize = previousSize;
    this.penThickness = previousThickness;
    this.penOpacity = previousOpacity;
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

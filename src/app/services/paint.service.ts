import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { DecorationFactory } from '../factories/decoration.factory';
import { TransformManagerService } from './transform-manager.service';

type PaintTool = 'decoration' | 'pen' | 'eraser';

interface ProceduralBrushConfig {
  color: string;
  sprinkleTextureId: string | null;
}

type SprinkleTextureStyle = 'base' | 'confetti' | 'cocoa';

interface SprinkleTextureDefinition {
  id: string;
  name: string;
  alphaMap?: string;
  roughnessMap?: string;
  style?: SprinkleTextureStyle;
}

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

  private readonly baseMinDistance = 0.02;
  private readonly baseMinTimeMs = 40;
  private readonly penSurfaceOffset = 0.003;
  private readonly proceduralBrushPrefix = 'procedural:';
  private brushCache = new Map<string, THREE.Object3D>();
  private brushPromises = new Map<string, Promise<THREE.Object3D>>();
  private brushSizes = new Map<string, THREE.Vector3>();

  private readonly baseSmearMask: SprinkleTextureDefinition = {
    id: 'smear-mask',
    name: 'Maska smugi',
    style: 'base',
  };

  private readonly sprinkleTextures: SprinkleTextureDefinition[] = [
    { id: 'none', name: 'Bez posypki', style: 'base' },
    {
      id: 'confetti',
      name: 'Kolorowe konfetti',
      style: 'confetti',
    },
    {
      id: 'cocoa',
      name: 'Wiórki czekoladowe',
      style: 'cocoa',
    },
  ];

  private readonly proceduralBrushDefaults: Record<string, ProceduralBrushConfig> = {
    'procedural:smear-vanilla': { color: '#f6d5c2', sprinkleTextureId: 'none' },
    'procedural:smear-confetti': { color: '#ffe8ef', sprinkleTextureId: 'confetti' },
    'procedural:smear-cocoa': { color: '#6b3e2a', sprinkleTextureId: 'cocoa' },
  };

  private penMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private proceduralMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private proceduralBrushSettings = new Map<string, ProceduralBrushConfig>();
  private penSphereGeometry = new THREE.SphereGeometry(0.5, 16, 12);
  private penJointGeometry = new THREE.SphereGeometry(0.5, 14, 10);
  private penSegmentGeometryCache = new Map<number, THREE.CylinderGeometry>();
  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private texturePromises = new Map<string, Promise<THREE.Texture>>();

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
    if (tool !== 'eraser') {
      this.lastNonEraserTool = tool;
    }
  }

  public getLastNonEraserTool(): Exclude<PaintTool, 'eraser'> {
    return this.lastNonEraserTool;
  }

  public setCurrentBrush(brushId: string): void {
    this.currentBrush = brushId;
    if (this.isProceduralBrush(brushId)) {
      this.ensureProceduralBrushConfig(brushId);
    }
  }

  public isProceduralBrush(brushId: string): boolean {
    return brushId.startsWith(this.proceduralBrushPrefix);
  }

  public getSprinkleTextureOptions(): { id: string; name: string }[] {
    return this.sprinkleTextures.map(({ id, name }) => ({ id, name }));
  }

  public getProceduralBrushConfig(brushId: string): ProceduralBrushConfig {
    const config = this.ensureProceduralBrushConfig(brushId);
    return { ...config };
  }

  public updateProceduralBrushSettings(
    brushId: string,
    updates: Partial<ProceduralBrushConfig>,
  ): ProceduralBrushConfig {
    const current = this.ensureProceduralBrushConfig(brushId);
    const merged: ProceduralBrushConfig = {
      ...current,
      ...updates,
    };
    this.proceduralBrushSettings.set(brushId, merged);
    return { ...merged };
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
      return;
    }

    if (erasableObject.userData['isPaintDecoration'] || erasableObject.userData['isDecoration']) {
      this.transformManager.removeDecorationObject(erasableObject);
      this.removeFromHistory(erasableObject);
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
      if (geometry && !this.isCachedPenGeometry(geometry)) {
        geometry.dispose();
      }

      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) {
        material.forEach((mat) => {
          if (mat && !this.isCachedPenMaterial(mat)) {
            mat.dispose();
          }
        });
      } else if (material && !this.isCachedPenMaterial(material)) {
        material.dispose();
      }
    });
  }

  private isCachedPenGeometry(geometry: THREE.BufferGeometry): boolean {
    if (geometry === this.penSphereGeometry || geometry === this.penJointGeometry) {
      return true;
    }

    for (const cachedGeometry of this.penSegmentGeometryCache.values()) {
      if (geometry === cachedGeometry) {
        return true;
      }
    }

    return false;
  }

  private isCachedPenMaterial(material: THREE.Material): boolean {
    for (const cachedMaterial of this.penMaterialCache.values()) {
      if (material === cachedMaterial) {
        return true;
      }
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
      this.activePenStartCap = null;
      this.activePenEndCap = null;
      this.lastPenDirection = null;
    }
  }

  private resetPaintTracking(): void {
    this.lastPaintPoint = null;
    this.lastPaintNormal = null;
    this.lastPaintTime = 0;
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
    if (this.isProceduralBrush(brushId)) {
      return this.createProceduralBrushInstance(brushId);
    }

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

  private async createProceduralBrushInstance(brushId: string): Promise<THREE.Object3D> {
    const config = this.ensureProceduralBrushConfig(brushId);
    const geometry = this.buildSmearGeometry();
    const material = await this.getProceduralMaterial(brushId, config);

    const smearMesh = new THREE.Mesh(geometry, material);
    smearMesh.castShadow = true;
    smearMesh.receiveShadow = true;
    smearMesh.userData['isPaintDecoration'] = true;

    const group = new THREE.Group();
    group.add(smearMesh);
    group.userData['clickableMeshes'] = [smearMesh];

    const size = this.computeBrushSize(group);
    this.brushSizes.set(brushId, size);

    return group;
  }

  private buildSmearGeometry(): THREE.BufferGeometry {
    const width = 1.2;
    const height = 0.8;
    const segments = 32;
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const normX = x / halfWidth;
      const normY = y / halfHeight;
      const edgeFactor = Math.max(Math.abs(normX), Math.abs(normY));

      if (edgeFactor > 0.75) {
        const angle = Math.atan2(normY, normX || 0.0001);
        const strength = 0.18 + Math.random() * 0.08;
        const attenuation = Math.min(1, (edgeFactor - 0.75) / 0.25);
        const offsetX = Math.cos(angle) * strength * attenuation * halfWidth * 0.3;
        const offsetY = Math.sin(angle) * strength * attenuation * halfHeight * 0.35;
        positions.setXY(i, x - offsetX, y - offsetY);
      }

      const radiusFalloff = Math.sqrt(normX * normX + normY * normY);
      const heightNoise = (Math.random() - 0.5) * 0.05 * (1 - Math.min(1, radiusFalloff ** 1.2));
      positions.setZ(i, heightNoise);
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);

    return geometry;
  }

  private async getProceduralMaterial(
    brushId: string,
    config: ProceduralBrushConfig,
  ): Promise<THREE.MeshStandardMaterial> {
    const sprinkleKey = config.sprinkleTextureId ?? 'none';
    const cacheKey = `${brushId}|${config.color}|${sprinkleKey}`;
    const cached = this.proceduralMaterialCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.color),
      roughness: 0.62,
      metalness: 0.04,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const baseAlpha = await this.loadMaskTexture(this.baseSmearMask, 'alpha');
    material.alphaMap = baseAlpha;
    material.alphaTest = 0.03;

    if (sprinkleKey !== 'none') {
      const sprinkle = this.getSprinkleTextureDefinition(sprinkleKey);
      if (sprinkle) {
        material.alphaMap = await this.loadMaskTexture(sprinkle, 'alpha');
        material.roughnessMap = await this.loadMaskTexture(sprinkle, 'roughness');
      }
    } else {
      material.roughnessMap = await this.loadMaskTexture(this.baseSmearMask, 'roughness');
    }

    material.needsUpdate = true;
    this.proceduralMaterialCache.set(cacheKey, material);
    return material;
  }

  private async loadMaskTexture(
    definition: SprinkleTextureDefinition,
    kind: 'alpha' | 'roughness',
  ): Promise<THREE.Texture> {
    const cacheKey = `${definition.id}:${kind}`;
    const cached = this.textureCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = this.texturePromises.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const resourcePath = kind === 'alpha' ? definition.alphaMap : definition.roughnessMap;

    if (!resourcePath || typeof document === 'undefined') {
      const fallback = this.createFallbackTexture(definition, kind);
      this.textureCache.set(cacheKey, fallback);
      return fallback;
    }

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        resourcePath,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.colorSpace = THREE.LinearSRGBColorSpace;
          this.textureCache.set(cacheKey, texture);
          this.texturePromises.delete(cacheKey);
          resolve(texture);
        },
        undefined,
        (error) => {
          this.texturePromises.delete(cacheKey);
          reject(error);
        },
      );
    }).catch(() => {
      const fallback = this.createFallbackTexture(definition, kind);
      this.textureCache.set(cacheKey, fallback);
      return fallback;
    });

    this.texturePromises.set(cacheKey, promise);
    return promise;
  }

  private createFallbackTexture(
    definition: SprinkleTextureDefinition,
    kind: 'alpha' | 'roughness',
  ): THREE.DataTexture {
    const size = kind === 'alpha' ? 64 : 48;
    const data = new Uint8Array(size * size);
    const random = this.createSeededRandom(`${definition.id}:${kind}`);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        let value: number;

        if (kind === 'alpha') {
          value = this.sampleProceduralAlpha(nx, ny, definition.style ?? 'base', random);
        } else {
          value = this.sampleProceduralRoughness(nx, ny, definition.style ?? 'base', random);
        }

        data[y * size + x] = value;
      }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private createSeededRandom(seed: string): () => number {
    let h = 2166136261 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return () => {
      h += 0x6d2b79f5;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private sampleProceduralAlpha(
    nx: number,
    ny: number,
    style: SprinkleTextureStyle,
    random: () => number,
  ): number {
    const radius = Math.sqrt(nx * nx * 0.9 + ny * ny * 1.1);
    const falloff = Math.max(0, 1 - radius ** 2.1);
    const fringe = Math.max(0, 1 - Math.pow(Math.max(radius - 0.55, 0) * 3.2, 1.5));
    let variation = 0;

    switch (style) {
      case 'confetti': {
        variation = (random() - 0.5) * 0.35;
        if (random() > 0.92) {
          variation += 0.55 * random();
        }
        break;
      }
      case 'cocoa': {
        const wave = Math.sin(nx * 6.5 + ny * 3.1 + random() * Math.PI);
        variation = wave * 0.2 + (random() - 0.5) * 0.18;
        break;
      }
      default: {
        variation = (random() - 0.5) * 0.22;
      }
    }

    const alpha = Math.max(0, Math.min(1, falloff * (0.85 + variation * fringe)));
    return Math.round(alpha * 255);
  }

  private sampleProceduralRoughness(
    nx: number,
    ny: number,
    style: SprinkleTextureStyle,
    random: () => number,
  ): number {
    let base = 0.55 + (random() - 0.5) * 0.1;

    switch (style) {
      case 'confetti': {
        if (random() > 0.88) {
          base += 0.25;
        }
        base += Math.sin((nx + ny) * 7) * 0.08;
        break;
      }
      case 'cocoa': {
        base += Math.sin(nx * 8 + random() * 2) * 0.18;
        base += (random() - 0.5) * 0.25;
        break;
      }
      default: {
        base += Math.sin((nx * 2.5 + ny * 3.1) * Math.PI) * 0.05;
      }
    }

    const clamped = Math.max(0.08, Math.min(1, base));
    return Math.round(clamped * 255);
  }

  private getSprinkleTextureDefinition(id: string): SprinkleTextureDefinition | undefined {
    if (id === this.baseSmearMask.id) {
      return this.baseSmearMask;
    }
    return this.sprinkleTextures.find((definition) => definition.id === id);
  }

  private ensureProceduralBrushConfig(brushId: string): ProceduralBrushConfig {
    const existing = this.proceduralBrushSettings.get(brushId);
    if (existing) {
      return existing;
    }

    const defaults = this.proceduralBrushDefaults[brushId] ?? {
      color: '#ffffff',
      sprinkleTextureId: 'none',
    };
    const config: ProceduralBrushConfig = { ...defaults };
    this.proceduralBrushSettings.set(brushId, config);
    return config;
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

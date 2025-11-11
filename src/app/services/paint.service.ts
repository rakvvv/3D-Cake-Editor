import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { DecorationFactory } from '../factories/decoration.factory';
import { TransformManagerService } from './transform-manager.service';

const SMEAR_TEXTURE_BASE_PATH = 'assets/textures/smears';
const SPRINKLE_TEXTURE_BASE_PATH = 'assets/textures/sprinkles';
const SMEAR_BASE_ALPHA_PATH = `${SMEAR_TEXTURE_BASE_PATH}/smear-base-alpha.png`;
const SMEAR_BASE_ROUGHNESS_PATH = `${SMEAR_TEXTURE_BASE_PATH}/smear-base-roughness.png`;

type PaintTool = 'decoration' | 'pen' | 'eraser';

interface ProceduralBrushConfig {
  color: string;
  sprinkleTextureId: string | null;
}

interface SprinkleTextureDefinition {
  id: string;
  name: string;
  alphaOverlay: string | null;
  roughnessOverlay: string | null;
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

  private readonly sprinkleTextures: SprinkleTextureDefinition[] = [
    {
      id: 'none',
      name: 'Gładka smuga',
      alphaOverlay: null,
      roughnessOverlay: null,
    },
    {
      id: 'confetti',
      name: 'Kolorowe konfetti',
      alphaOverlay: `${SPRINKLE_TEXTURE_BASE_PATH}/confetti-alpha.png`,
      roughnessOverlay: `${SPRINKLE_TEXTURE_BASE_PATH}/confetti-roughness.png`,
    },
    {
      id: 'cocoa',
      name: 'Wiórki czekoladowe',
      alphaOverlay: `${SPRINKLE_TEXTURE_BASE_PATH}/cocoa-alpha.png`,
      roughnessOverlay: `${SPRINKLE_TEXTURE_BASE_PATH}/cocoa-roughness.png`,
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
  private textureCache = new Map<string, THREE.DataTexture>();
  private texturePromises = new Map<string, Promise<THREE.DataTexture>>();
  private combinedMaskCache = new Map<string, THREE.DataTexture>();
  private readonly maskTextureFormat: THREE.PixelFormat = this.detectMaskTextureFormat();

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
    const offsetAmount = this.getBrushSurfaceOffset(this.currentBrush);
    const offset = normal.clone().multiplyScalar(offsetAmount);
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

    scene.add(brushModel);
    brushModel.updateMatrixWorld(true);
    brushModel.matrixAutoUpdate = false;
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
    smearMesh.renderOrder = 10;
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
      depthTest: true,
      side: THREE.DoubleSide,
    });

    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -0.5;

    const sprinkle = this.getSprinkleTextureDefinition(sprinkleKey);
    const baseAlpha = await this.loadTextureResource(SMEAR_BASE_ALPHA_PATH, 'alpha');
    const baseRoughness = await this.loadTextureResource(SMEAR_BASE_ROUGHNESS_PATH, 'roughness');

    const alphaOverlay = sprinkle.alphaOverlay
      ? await this.loadTextureResource(sprinkle.alphaOverlay, 'alpha')
      : null;
    const roughnessOverlay = sprinkle.roughnessOverlay
      ? await this.loadTextureResource(sprinkle.roughnessOverlay, 'roughness')
      : null;

    const alphaTexture = this.combineMaskTextures(baseAlpha, alphaOverlay, 'alpha');
    const roughnessTexture = this.combineMaskTextures(baseRoughness, roughnessOverlay, 'roughness');

    material.alphaMap = alphaTexture;
    material.alphaTest = 0.005;
    material.roughnessMap = roughnessTexture;

    material.needsUpdate = true;
    this.proceduralMaterialCache.set(cacheKey, material);
    return material;
  }

  private getBrushSurfaceOffset(brushId: string): number {
    return this.isProceduralBrush(brushId) ? 0.02 : 0.005;
  }

  private async loadTextureResource(
    resourcePath: string | undefined,
    usage: 'alpha' | 'roughness',
  ): Promise<THREE.DataTexture> {
    if (!resourcePath) {
      return this.createPlaceholderTexture(usage);
    }

    const cacheKey = `${usage}:${resourcePath}`;
    const cached = this.textureCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = this.texturePromises.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = new Promise<THREE.DataTexture>((resolve) => {
      this.textureLoader.load(
        resourcePath,
        (texture) => {
          const prepared = this.prepareMaskTexture(texture, usage);
          this.textureCache.set(cacheKey, prepared);
          this.texturePromises.delete(cacheKey);
          resolve(prepared);
        },
        undefined,
        () => {
          console.warn(`PaintService: nie udało się wczytać tekstury ${resourcePath}`);
          this.texturePromises.delete(cacheKey);
          const fallback = this.createPlaceholderTexture(usage);
          this.textureCache.set(cacheKey, fallback);
          resolve(fallback);
        },
      );
    });

    this.texturePromises.set(cacheKey, promise);
    return promise;
  }

  private prepareMaskTexture(texture: THREE.Texture, usage: 'alpha' | 'roughness'): THREE.DataTexture {
    if (texture instanceof THREE.DataTexture) {
      return this.finalizeMaskTexture(texture);
    }

    const converted = this.convertTextureToDataTexture(texture, usage);
    texture.dispose();
    if (converted) {
      return this.finalizeMaskTexture(converted);
    }

    return this.createPlaceholderTexture(usage);
  }

  private finalizeMaskTexture(texture: THREE.DataTexture): THREE.DataTexture {
    texture.format = this.maskTextureFormat;
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  private convertTextureToDataTexture(
    texture: THREE.Texture,
    usage: 'alpha' | 'roughness',
  ): THREE.DataTexture | null {
    const source: any = texture.image;
    if (!source) {
      return null;
    }

    if (source.data instanceof Uint8Array && typeof source.width === 'number' && typeof source.height === 'number') {
      const channel = this.extractChannelData(source.data, source.width, source.height);
      return new THREE.DataTexture(channel, source.width, source.height, this.maskTextureFormat);
    }

    if (typeof document === 'undefined') {
      return null;
    }

    const dimensions = this.getImageDimensions(source);
    if (!dimensions) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }

    context.drawImage(source as CanvasImageSource, 0, 0, dimensions.width, dimensions.height);
    const imageData = context.getImageData(0, 0, dimensions.width, dimensions.height);
    canvas.width = 0;
    canvas.height = 0;

    const channel = new Uint8Array(dimensions.width * dimensions.height);
    let total = 0;
    for (let i = 0, srcIndex = 0; i < channel.length; i++, srcIndex += 4) {
      const value = imageData.data[srcIndex];
      channel[i] = value;
      total += value;
    }

    if (usage === 'alpha') {
      const average = total / channel.length;
      if (average < 6) {
        return this.createPlaceholderTexture('alpha');
      }
    }

    return new THREE.DataTexture(channel, dimensions.width, dimensions.height, this.maskTextureFormat);
  }

  private extractChannelData(data: Uint8Array, width: number, height: number): Uint8Array {
    if (data.length === width * height) {
      return new Uint8Array(data);
    }

    const channel = new Uint8Array(width * height);
    const stride = Math.max(1, Math.floor(data.length / channel.length));
    for (let i = 0, srcIndex = 0; i < channel.length; i++, srcIndex += stride) {
      const clampedIndex = Math.min(srcIndex, data.length - 1);
      channel[i] = data[clampedIndex];
    }
    return channel;
  }

  private getImageDimensions(source: any): { width: number; height: number } | null {
    const width =
      source.width ?? source.naturalWidth ?? source.videoWidth ?? source.image?.width ?? 0;
    const height =
      source.height ?? source.naturalHeight ?? source.videoHeight ?? source.image?.height ?? 0;

    if (!width || !height) {
      return null;
    }

    return { width, height };
  }

  private combineMaskTextures(
    base: THREE.DataTexture,
    overlay: THREE.DataTexture | null,
    usage: 'alpha' | 'roughness',
  ): THREE.DataTexture {
    if (!overlay) {
      return base;
    }

    const cacheKey = `${usage}:${base.uuid}:${overlay.uuid}`;
    const cached = this.combinedMaskCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const baseImage = base.image as { data: Uint8Array; width: number; height: number };
    const overlayImage = overlay.image as { data: Uint8Array; width: number; height: number };
    if (!baseImage || !overlayImage) {
      return base;
    }

    if (baseImage.width !== overlayImage.width || baseImage.height !== overlayImage.height) {
      return base;
    }

    const pixelCount = baseImage.width * baseImage.height;
    const merged = new Uint8Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const baseValue = baseImage.data[i];
      const overlayValue = overlayImage.data[i];
      if (usage === 'alpha') {
        merged[i] = Math.max(baseValue, overlayValue);
      } else {
        merged[i] = Math.max(baseValue, overlayValue);
      }
    }

    const mergedTexture = this.finalizeMaskTexture(
      new THREE.DataTexture(merged, baseImage.width, baseImage.height, this.maskTextureFormat),
    );
    this.combinedMaskCache.set(cacheKey, mergedTexture);
    return mergedTexture;
  }

  private createPlaceholderTexture(usage: 'alpha' | 'roughness'): THREE.DataTexture {
    const value = usage === 'alpha' ? 255 : 204;
    const data = new Uint8Array([value]);
    const texture = new THREE.DataTexture(data, 1, 1, this.maskTextureFormat);
    return this.finalizeMaskTexture(texture);
  }

  private detectMaskTextureFormat(): THREE.PixelFormat {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const gl2 = canvas.getContext('webgl2');
      if (gl2) {
        canvas.width = 0;
        canvas.height = 0;
        return THREE.RedFormat;
      }

      const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      canvas.width = 0;
      canvas.height = 0;
      if (gl) {
        return THREE.LuminanceFormat;
      }
    }

    return THREE.LuminanceFormat;
  }

  private getSprinkleTextureDefinition(id: string): SprinkleTextureDefinition {
    const match = this.sprinkleTextures.find((definition) => definition.id === id);
    return match ?? this.sprinkleTextures[0];
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

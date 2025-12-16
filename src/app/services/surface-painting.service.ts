import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { PaintService } from './paint.service';
import {
  SerializedBrushStroke,
  SerializedSprinkleStroke,
  SurfacePaintingPreset,
} from '../models/cake-preset';

export type PaintingMode = 'brush' | 'gradient' | 'sprinkles';
export type GradientDirection = 'vertical';
export type SprinkleShape = 'stick' | 'ball' | 'star';

const SPRINKLE_PALETTE = ['#ff6b81', '#ffd66b', '#6bffb0', '#6bb8ff', '#ffffff'];
const DEFAULT_SPRINKLE_COLOR = SPRINKLE_PALETTE[0];

// --- SEPARATOR ---
// Służy do oddzielania pociągnięć w scalonym pliku JSON
const STROKE_SEPARATOR = 99999;

interface PaintingShaderUniforms {
  gradientMap: { value: THREE.Texture };
  useGradient: { value: boolean };
  gradientMinY: { value: number };
  gradientHeight: { value: number };
  gradientFlip: { value: number };
}

@Injectable({ providedIn: 'root' })
export class SurfacePaintingService {
  public enabled = false;
  public mode: PaintingMode = 'brush';

  // Parametry pędzla
  public brushSize = 90;
  public brushOpacity = 1.0;
  public brushColor = '#ff6b6b';

  private brushTexture: THREE.CanvasTexture | null = null;
  public gradientEnabled = false;
  public gradientDirection: GradientDirection = 'vertical';
  public gradientFlip = false;
  public gradientStart = '#ffffff';
  public gradientEnd = '#ffe3f3';
  public sprinkleDensity = 6;
  public sprinkleShape: SprinkleShape = 'stick';
  public sprinkleMinScale = 0.7;
  public sprinkleMaxScale = 1.2;
  public sprinkleUseRandomColors = true;
  public sprinkleColor = DEFAULT_SPRINKLE_COLOR;
  public sprinkleRandomness = 0.3;

  private readonly isBrowser: boolean;
  private gradientCanvas?: HTMLCanvasElement;
  private gradientContext?: CanvasRenderingContext2D | null;
  private gradientTexture?: THREE.CanvasTexture;
  private painting = false;
  private lastBrushPoint: THREE.Vector3 | null = null;

  // --- LOGIKA CIŚNIENIA ---
  private strokeCurrentLength = 0;
  private readonly RAMP_UP_DISTANCE = 0.4;

  private brushStrokeGroup: THREE.Group | null = null;
  private brushStrokeMesh: THREE.InstancedMesh | null = null;
  private brushStrokeIndex = 0;
  private brushStrokeCapacity = 0;

  // Kolejność rysowania dla nowych pociągnięć
  private globalRenderOrder = 100;

  // Batching state to continue strokes on the same mesh
  private lastUsedBrushColor: string | null = null;
  private lastUsedSprinkleShape: string | null = null;
  private lastUsedSprinkleColor: string | null = null;

  // Optymalizacja zapisu (nie zapisujemy punktów gęściej niż co 1.5cm)
  private readonly RECORDING_DIST_SQ = 0.015 * 0.015;

  private textureLoader = new THREE.TextureLoader();
  private cakeNormalMap: THREE.Texture | null = null;
  private cakeRoughnessMap: THREE.Texture | null = null;
  private readonly TEXTURE_NORMAL_URL = '/assets/textures/Pink_Cake_Frosting_01-normal.jpg';
  private readonly TEXTURE_ROUGH_URL = '/assets/textures/Pink_Cake_Frosting_01-bump.jpg';
  private lastStrokeDir: THREE.Vector3 | null = null;
  private cakeGroup: THREE.Group | null = null;
  private paintAnchor: THREE.Group | null = null;
  private lastSprinklePoint: THREE.Vector3 | null = null;
  private sprinkleStrokeGroup: THREE.Group | null = null;
  private sprinkleStrokeMesh: THREE.InstancedMesh | null = null;
  private sprinkleStrokeIndex = 0;
  private sprinkleStrokeCapacity = 0;
  private sprinkleStrokeShape: SprinkleShape | null = null;
  private paintedMaterials: THREE.Material[] = [];
  private sprinkleGeometryCache: { stick: THREE.BufferGeometry; ball: THREE.BufferGeometry; star: THREE.BufferGeometry } | null = null;
  private sprinkleMaterial: THREE.MeshStandardMaterial | null = null;
  private sprinkleEntries: THREE.Object3D[] = [];
  private paintEntries: THREE.Object3D[] = [];
  private shaderUniforms?: PaintingShaderUniforms;
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempMatrixInverse = new THREE.Matrix4();
  private readonly tempMatrix2 = new THREE.Matrix4();
  private readonly tempColor = new THREE.Color();
  private readonly tempVec3 = new THREE.Vector3();
  private readonly tempVec3_2 = new THREE.Vector3();
  private readonly tempVec3_3 = new THREE.Vector3();
  private readonly tempVec3_4 = new THREE.Vector3();
  private readonly tempVec3_5 = new THREE.Vector3();
  private readonly tempVec3_6 = new THREE.Vector3();
  private readonly tempVec3_7 = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempQuat2 = new THREE.Quaternion();
  private readonly tempQuat3 = new THREE.Quaternion();
  private readonly tempScale = new THREE.Vector3();

  // Tutaj przechowujemy surowe pociągnięcia przed scaleniem
  private brushStrokes: SerializedBrushStroke[] = [];
  private sprinkleStrokes: SerializedSprinkleStroke[] = [];
  private activeStroke: SerializedBrushStroke | SerializedSprinkleStroke | null = null;
  private nextStrokeId = 1;
  private lastRecordedPoint: THREE.Vector3 | null = null;
  private isReplayingSprinkles = false;

  constructor(@Inject(PLATFORM_ID) platformId: object, private readonly paintService: PaintService) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.ensureCanvases();
    }
  }

  // --- GŁÓWNE METODY STERUJĄCE ---

  public attachCake(cake: THREE.Group | null, resetPaint = false): void {
    this.loadCakeTextures();
    if (resetPaint) {
      this.disposeSprinkles();
      this.clearPaint();
    }
    this.cakeGroup = cake;
    this.ensurePaintAnchor();
    this.applyPaintingShader();
    this.reattachPaintEntries();
    this.updateGradientTexture();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.lastBrushPoint = null;
  }

  public isPainting(): boolean {
    return this.painting;
  }

  public startStroke(): void {
    this.painting = true;
    this.lastBrushPoint = null;
    this.lastSprinklePoint = null;
    this.lastStrokeDir = null;
    this.strokeCurrentLength = 0;
    this.activeStroke = null;
    this.lastRecordedPoint = null;

    if (this.mode === 'brush') {
      const isSameColor = this.lastUsedBrushColor === this.brushColor;
      const hasCapacity =
        this.brushStrokeMesh && this.brushStrokeIndex < this.brushStrokeCapacity - 50;

      // --- FIX: Sprawdzamy, czy grupa nadal jest na scenie ---
      const isRemoved = !this.brushStrokeGroup || !this.brushStrokeGroup.parent;

      // Dodajemy || isRemoved do warunku
      if (!this.brushStrokeMesh || !isSameColor || !hasCapacity || isRemoved) {
        this.finalizePreviousBatch();
        this.lastUsedBrushColor = this.brushColor;
        // Ważne: createBrushStroke zostanie wywołane automatycznie w paintBrush przy pierwszym ruchu
      }

      this.activeStroke = {
        id: `brush-${this.nextStrokeId++}`,
        mode: 'brush',
        color: this.brushColor,
        brushSize: this.brushSize,
        pathData: [],
      };
    } else if (this.mode === 'sprinkles') {
      const isSameShape = this.lastUsedSprinkleShape === this.sprinkleShape;
      const isSameColor =
        this.lastUsedSprinkleColor === this.sprinkleColor || this.sprinkleUseRandomColors;
      const hasCapacity =
        this.sprinkleStrokeMesh && this.sprinkleStrokeIndex < this.sprinkleStrokeCapacity - 20;

      // --- FIX: Sprawdzamy, czy grupa posypki nadal jest na scenie ---
      const isRemoved = !this.sprinkleStrokeGroup || !this.sprinkleStrokeGroup.parent;

      // Dodajemy || isRemoved do warunku
      if (!this.sprinkleStrokeMesh || !isSameShape || !isSameColor || !hasCapacity || isRemoved) {
        this.finalizePreviousBatch();
        this.lastUsedSprinkleShape = this.sprinkleShape;
        this.lastUsedSprinkleColor = this.sprinkleColor;
        this.prepareSprinkleStroke();
      }

      this.activeStroke = {
        id: `sprinkles-${this.nextStrokeId++}`,
        mode: 'sprinkles',
        shape: this.sprinkleShape,
        density: this.sprinkleDensity,
        useRandomColors: this.sprinkleUseRandomColors,
        color: this.sprinkleColor,
        pathData: [],
      };
    }
  }

  // Czyści referencje, aby wymusić utworzenie nowego mesha przy kolejnej serii
  private finalizePreviousBatch(): void {
    this.brushStrokeGroup = null;
    this.brushStrokeMesh = null;
    this.brushStrokeIndex = 0;
    this.brushStrokeCapacity = 0;
    this.lastUsedBrushColor = null;

    this.sprinkleStrokeGroup = null;
    this.sprinkleStrokeMesh = null;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = 0;
    this.lastUsedSprinkleShape = null;
    this.lastUsedSprinkleColor = null;
  }

  public async handlePointer(hit: THREE.Intersection, scene: THREE.Scene): Promise<void> {
    if (!this.isBrowser || !this.painting) return;
    if (!hit.point) return;

    // 1. ZAPIS DANYCH
    if (this.activeStroke) {
      const p = hit.point;
      let shouldRecord = false;

      // Sampling: nie zapisujemy każdego piksela ruchu
      if (!this.lastRecordedPoint) {
        shouldRecord = true;
      } else {
        const distSq = this.lastRecordedPoint.distanceToSquared(p);
        if (distSq > this.RECORDING_DIST_SQ) {
          shouldRecord = true;
        }
      }

      if (shouldRecord) {
        let normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
        if (hit.object) {
          normal.transformDirection(hit.object.matrixWorld).normalize();
        }

        // Płaski zapis: 6 liczb na jeden punkt
        this.activeStroke.pathData.push(
          this.round(p.x), this.round(p.y), this.round(p.z),
          this.round(normal.x), this.round(normal.y), this.round(normal.z)
        );
        this.lastRecordedPoint = p.clone();
      }
    }

    // 2. RYSOWANIE WIZUALNE
    if (this.mode === 'gradient') {
      this.applyGradientFromHit(hit);
      return;
    }
    if (this.mode === 'sprinkles') {
      this.placeSprinkles(hit, scene);
      return;
    }
    this.paintBrush(hit, scene);
  }

  public endStroke(): void {
    this.painting = false;
    this.lastBrushPoint = null;
    this.lastSprinklePoint = null;
    this.strokeCurrentLength = 0;
    this.lastRecordedPoint = null;
    const finishedStroke = this.activeStroke;
    this.activeStroke = null;

    // --- PĘDZEL ---
    if (this.brushStrokeGroup && this.brushStrokeMesh) {
      // Czyścimy puste
      if (this.brushStrokeMesh.count === 0) {
        this.brushStrokeGroup.parent?.remove(this.brushStrokeGroup);
        this.brushStrokeGroup.userData['removedByUndo'] = true;
      } else if (this.brushStrokeIndex > 0) {
        const existingIds = (this.brushStrokeGroup.userData['strokeIds'] as string[] | undefined) ?? [];

        if (finishedStroke?.mode === 'brush' && finishedStroke.pathData.length >= 6) {
          this.brushStrokes.push(finishedStroke);
          existingIds.push(finishedStroke.id);
          this.brushStrokeGroup.userData['strokeIds'] = existingIds;
          this.brushStrokeGroup.userData['strokeId'] = finishedStroke.id;
        } else {
          // Jeśli to było nowe pociągnięcie i jest puste, a grupa jest nowa -> usuń
          if (existingIds.length === 0) {
            this.brushStrokeGroup.userData['removedByUndo'] = true;
            this.brushStrokeGroup.visible = false;
            this.brushStrokeGroup.parent?.remove(this.brushStrokeGroup);
          }
        }
        this.brushStrokeMesh.computeBoundingSphere();
      }
    }

    // --- POSYPKA ---
    if (this.sprinkleStrokeGroup && this.sprinkleStrokeMesh) {
      // FIX: Bezwzględne usuwanie pustych grup
      if (this.sprinkleStrokeMesh.count === 0) {
        this.sprinkleStrokeGroup.parent?.remove(this.sprinkleStrokeGroup);
        // Oznaczamy jako usunięte z tablicy referencji
        const idx = this.sprinkleEntries.indexOf(this.sprinkleStrokeGroup);
        if (idx > -1) this.sprinkleEntries.splice(idx, 1);
      } else if (this.sprinkleStrokeIndex > 0) {
        const existingIds = (this.sprinkleStrokeGroup.userData['strokeIds'] as string[] | undefined) ?? [];

        if (finishedStroke?.mode === 'sprinkles' && finishedStroke.pathData.length >= 6) {
          this.sprinkleStrokes.push(finishedStroke);
          existingIds.push(finishedStroke.id);
          this.sprinkleStrokeGroup.userData['strokeIds'] = existingIds;
          this.sprinkleStrokeGroup.userData['strokeId'] = finishedStroke.id;
        } else if (existingIds.length === 0) {
          this.sprinkleStrokeGroup.parent?.remove(this.sprinkleStrokeGroup);
        }
        this.sprinkleStrokeMesh.computeBoundingSphere();
      }
    }
  }

  // --- EKSPORT I ODTWARZANIE (Z OPTYMALIZACJĄ) ---

  public exportPaintingPreset(): SurfacePaintingPreset {
    // 1. Filtrujemy (usuwamy undo)
    const validBrushStrokes = this.brushStrokes.filter((stroke) => {
      const group = this.paintEntries.find((g) => {
        const strokeIds = g.userData?.['strokeIds'] as string[] | undefined;
        return strokeIds?.includes(stroke.id) || g.userData?.['strokeId'] === stroke.id;
      });
      return group && !group.userData?.['removedByUndo'];
    });

    const validSprinkleStrokes = this.sprinkleStrokes.filter((stroke) => {
      const group = this.sprinkleEntries.find((g) => {
        const strokeIds = g.userData?.['strokeIds'] as string[] | undefined;
        return strokeIds?.includes(stroke.id) || g.userData?.['strokeId'] === stroke.id;
      });
      return group && !group.userData?.['removedByUndo'];
    });

    // 2. SCALANIE PĘDZLI
    const mergedBrushMap = new Map<string, SerializedBrushStroke>();

    validBrushStrokes.forEach((stroke) => {
      const key = `${stroke.color}|${stroke.brushSize}`;
      if (!mergedBrushMap.has(key)) {
        mergedBrushMap.set(key, {
          id: `merged-brush-${this.nextStrokeId++}`,
          mode: 'brush',
          color: stroke.color,
          brushSize: stroke.brushSize,
          pathData: [...stroke.pathData],
        });
      } else {
        const existing = mergedBrushMap.get(key)!;
        // Wstawiamy SEPARATOR i 5 zer, żeby oddzielić linie
        existing.pathData.push(STROKE_SEPARATOR, 0, 0, 0, 0, 0);
        existing.pathData.push(...stroke.pathData);
      }
    });

    // 3. SCALANIE POSYPEK
    const mergedSprinklesMap = new Map<string, SerializedSprinkleStroke>();

    validSprinkleStrokes.forEach((stroke) => {
      const key = `${stroke.shape}|${stroke.color}|${stroke.useRandomColors}|${stroke.density}`;
      if (!mergedSprinklesMap.has(key)) {
        mergedSprinklesMap.set(key, {
          id: `merged-sprinkles-${this.nextStrokeId++}`,
          mode: 'sprinkles',
          shape: stroke.shape,
          color: stroke.color,
          useRandomColors: stroke.useRandomColors,
          density: stroke.density,
          pathData: [...stroke.pathData],
        });
      } else {
        const existing = mergedSprinklesMap.get(key)!;
        existing.pathData.push(...stroke.pathData);
      }
    });

    return {
      brushColor: this.brushColor,
      brushStrokes: Array.from(mergedBrushMap.values()),
      sprinkleStrokes: Array.from(mergedSprinklesMap.values()),
    };
  }

  public restorePaintingPreset(preset: SurfacePaintingPreset | undefined | null): void {
    if (!preset) return;

    this.clearPaint();
    this.brushStrokes = [];
    this.sprinkleStrokes = [];
    this.activeStroke = null;
    this.nextStrokeId = 1;

    this.attachCake(this.cakeGroup, false);
    this.brushColor = preset.brushColor ?? this.brushColor;

    preset.brushStrokes?.forEach((stroke) => this.replayBrushStroke(stroke));
    preset.sprinkleStrokes?.forEach((stroke) => this.replaySprinkleStroke(stroke));
  }

  private replayBrushStroke(stroke: SerializedBrushStroke): void {
    if (!this.cakeGroup) return;
    const scene = this.cakeGroup.parent as THREE.Scene;
    if (!scene) return;

    this.mode = 'brush';
    this.brushColor = stroke.color;
    this.brushSize = stroke.brushSize;

    this.startStroke();

    if (this.activeStroke) {
      this.activeStroke.id = stroke.id;
      this.activeStroke.pathData = stroke.pathData;

      const parts = stroke.id.split('-');
      const numericId = Number(parts[parts.length-1]);
      if (!Number.isNaN(numericId)) {
        this.nextStrokeId = Math.max(this.nextStrokeId, numericId + 1);
      }
    }

    const data = stroke.pathData;
    // Iteracja po 6 liczb (x,y,z,nx,ny,nz)
    for (let i = 0; i < data.length; i += 6) {
      const x = data[i];
      const y = data[i + 1];
      const z = data[i + 2];

      // --- FIX NA DUCHY I SEPARATOR ---
      // Jeśli napotkamy separator lub punkt (0,0,0), przerywamy linię
      if (Math.abs(x - STROKE_SEPARATOR) < 1) {
        this.lastBrushPoint = null;
        this.lastStrokeDir = null;
        continue;
      }
      if (Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001 && Math.abs(z) < 0.0001) {
        this.lastBrushPoint = null;
        this.lastStrokeDir = null;
        continue;
      }

      const nx = data[i + 3];
      const ny = data[i + 4];
      const nz = data[i + 5];

      const hit = {
        point: new THREE.Vector3(x, y, z),
        face: { normal: new THREE.Vector3(nx, ny, nz) } as THREE.Face,
        object: this.cakeGroup,
      } as unknown as THREE.Intersection;

      this.paintBrush(hit, scene);
    }
    this.endStroke();
  }

  private replaySprinkleStroke(stroke: SerializedSprinkleStroke): void {
    if (!this.cakeGroup) return;
    const scene = this.cakeGroup.parent as THREE.Scene;
    if (!scene) return;

    this.mode = 'sprinkles';
    this.sprinkleShape = stroke.shape;
    this.sprinkleDensity = stroke.density;
    this.sprinkleUseRandomColors = stroke.useRandomColors;
    this.sprinkleColor = stroke.color;

    this.isReplayingSprinkles = true;
    this.lastSprinklePoint = null;
    this.startStroke();

    if (this.activeStroke) {
      this.activeStroke.id = stroke.id;
      // WAŻNE: Kopiujemy dane, żeby endStroke nie uznał grupy za pustą
      this.activeStroke.pathData = [...stroke.pathData];

      const parts = stroke.id.split('-');
      const numericId = Number(parts[parts.length - 1]);
      if (!Number.isNaN(numericId)) {
        this.nextStrokeId = Math.max(this.nextStrokeId, numericId + 1);
      }
    }

    const data = stroke.pathData;
    for (let i = 0; i < data.length; i += 6) {
      const x = data[i];
      const y = data[i + 1];
      const z = data[i + 2];

      if (Math.abs(x - STROKE_SEPARATOR) < 1) {
        this.lastSprinklePoint = null;
        continue;
      }
      if (Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001 && Math.abs(z) < 0.0001) {
        this.lastSprinklePoint = null;
        continue;
      }

      // Filtr duchów pod spodem (mniej agresywny niż 0.05, ale skuteczny na 0.000)
      if (y < 0.001) {
        this.lastSprinklePoint = null;
        continue;
      }

      const nx = data[i + 3];
      const ny = data[i + 4];
      const nz = data[i + 5];

      const hit = {
        point: new THREE.Vector3(x, y, z),
        face: { normal: new THREE.Vector3(nx, ny, nz) } as THREE.Face,
        object: this.cakeGroup,
      } as unknown as THREE.Intersection;

      this.placeSprinkles(hit, scene);
    }

    // --- KLUCZOWE: Wymuszenie aktualizacji po pętli ---
    if (this.sprinkleStrokeMesh) {
      this.sprinkleStrokeMesh.count = this.sprinkleStrokeIndex;
      this.sprinkleStrokeMesh.instanceMatrix.needsUpdate = true;
      if (this.sprinkleStrokeMesh.instanceColor) {
        this.sprinkleStrokeMesh.instanceColor.needsUpdate = true;
      }
      this.sprinkleStrokeMesh.computeBoundingSphere();
    }
    // -------------------------------------------------

    this.endStroke();
    this.isReplayingSprinkles = false;
  }

  // --- RESZTA LOGIKI (GRADIENTY, CZYSZCZENIE, UTILS) ---

  public applyGradientSettings(): void {
    this.gradientEnabled = true;
    this.updateGradientTexture();
    this.applyPaintingShader();
    this.flagMaterialUpdate();
  }

  public disableGradient(): void {
    this.gradientEnabled = false;
    this.applyPaintingShader();
    this.flagMaterialUpdate();
  }

  public clearPaint(): void {
    this.finalizePreviousBatch();
    this.clearSprinkles();
    this.clearBrushStrokes();
    this.activeStroke = null;
    this.nextStrokeId = 1;
    this.lastRecordedPoint = null;

    // Reset kolejności rysowania warstw
    this.globalRenderOrder = 100;
  }

  public clearSprinkles(): void {
    this.lastSprinklePoint = null;
    this.lastRecordedPoint = null;
    this.activeStroke = null;
    this.sprinkleStrokes = [];
    this.disposeSprinkles();
  }

  public setSprinkleShape(shape: SprinkleShape): void {
    if (this.sprinkleShape === shape) return;
    this.finalizePreviousBatch();
    this.sprinkleShape = shape;
  }

  public setSprinkleColorMode(useRandom: boolean): void {
    this.sprinkleUseRandomColors = useRandom;
  }

  public setSprinkleColor(color: string): void {
    this.finalizePreviousBatch();
    this.sprinkleUseRandomColors = false;
    this.sprinkleColor = this.sanitizeHexColor(color, this.sprinkleColor);
  }

  public clearBrushStrokes(): void {
    this.disposePaintStrokes();
    this.brushStrokes = [];
    this.activeStroke = null;
    this.lastRecordedPoint = null;
  }

  private applyGradientFromHit(hit: THREE.Intersection): void {
    if (!hit.uv) return;
    this.gradientEnabled = true;
    this.updateGradientTexture();
    this.flagMaterialUpdate();
  }

  private ensureCanvases(): void {
    if (this.gradientCanvas) return;
    this.gradientCanvas = document.createElement('canvas');
    this.gradientCanvas.width = 1024;
    this.gradientCanvas.height = 1024;
    this.gradientContext = this.gradientCanvas.getContext('2d');
    this.gradientTexture = new THREE.CanvasTexture(this.gradientCanvas);
    this.gradientTexture.colorSpace = THREE.SRGBColorSpace;
  }

  private round(val: number): number {
    return Math.round(val * 10000) / 10000;
  }

  private applyPaintingShader(): void {
    this.ensureCanvases();
    if (!this.gradientTexture || !this.cakeGroup) return;

    const bbox = new THREE.Box3().setFromObject(this.cakeGroup);
    const gradientHeight = Math.max(0.001, bbox.max.y - bbox.min.y);
    const gradientMinY = bbox.min.y;

    if (!this.shaderUniforms) {
      this.shaderUniforms = {
        gradientMap: { value: this.gradientTexture },
        useGradient: { value: this.gradientEnabled },
        gradientMinY: { value: gradientMinY },
        gradientHeight: { value: gradientHeight },
        gradientFlip: { value: this.gradientFlip ? 1 : 0 },
      };
    } else {
      this.shaderUniforms.gradientMap.value = this.gradientTexture;
      this.shaderUniforms.useGradient.value = this.gradientEnabled;
      this.shaderUniforms.gradientMinY.value = gradientMinY;
      this.shaderUniforms.gradientHeight.value = gradientHeight;
      this.shaderUniforms.gradientFlip.value = this.gradientFlip ? 1 : 0;
    }

    const uniforms = this.shaderUniforms;
    this.paintedMaterials = [];

    this.cakeGroup.traverse((child) => {
      let current: THREE.Object3D | null = child;
      while (current) {
        if (current.userData?.['isCakeGlaze'] || current.userData?.['isCakeWafer']) return;
        current = current.parent ?? null;
      }

      const mesh = child as THREE.Mesh;
      if (!(mesh as any).isMesh || !mesh.material) return;

      const materialArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materialArray.forEach((mat) => {
        if (!(mat as any).userData) (mat as any).userData = {};
        this.patchMaterialForGradient(mat as THREE.Material);
      });
    });
  }

  private reattachPaintEntries(): void {
    const anchor = this.ensurePaintAnchor();
    if (!anchor) return;

    this.paintEntries = this.paintEntries.filter((entry) => !entry.userData?.['removedByUndo']);
    this.sprinkleEntries = this.sprinkleEntries.filter((entry) => !entry.userData?.['removedByUndo']);

    [...this.paintEntries, ...this.sprinkleEntries].forEach((entry) => {
      if (!entry.parent && !entry.userData?.['removedByUndo']) {
        anchor.add(entry);
      }
    });
  }

  private createBrushStrokeContainer(color: string): { group: THREE.Group; mesh: THREE.InstancedMesh } | null {
    const anchor = this.ensurePaintAnchor();
    if (!anchor) return null;

    const normalMap = this.cakeNormalMap ?? undefined;
    const roughnessMap = this.cakeRoughnessMap ?? undefined;
    const brushTexture = this.brushTexture ?? new THREE.Texture();
    const maxInstances = 2000;
    const geometry = new THREE.PlaneGeometry(0.06, 0.06);
    const material = new THREE.MeshStandardMaterial({
      map: brushTexture,
      normalMap,
      roughnessMap,
      color,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = maxInstances;
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    this.brushStrokeCapacity = maxInstances;

    const group = new THREE.Group();
    group.name = 'Malowanie pędzlem';
    group.userData['displayName'] = 'Malowanie pędzlem';
    group.userData['isPaintStroke'] = true;
    group.add(mesh);

    return { group, mesh };
  }

  private ensurePaintAnchor(scene?: THREE.Scene): THREE.Group | null {
    if (this.paintAnchor && this.paintAnchor.parent) {
      return this.paintAnchor;
    }

    const parent = this.cakeGroup ?? null;
    const targetScene = scene ?? (this.cakeGroup?.parent as THREE.Scene) ?? null;
    if (!parent || !targetScene) {
      return null;
    }

    const anchor = this.paintAnchor ?? new THREE.Group();
    anchor.name = 'Cake Paint Anchor';
    anchor.userData['displayName'] = 'Malowanie tortu';
    anchor.userData['isPaintAnchor'] = true;
    parent.add(anchor);
    this.paintAnchor = anchor;
    return anchor;
  }

  private patchMaterialForGradient(mat: THREE.Material): void {
    if (!this.shaderUniforms) return;

    const typed = mat as THREE.MeshStandardMaterial;
    if ((typed as any).__surfacePaintApplied) {
      this.paintedMaterials.push(typed);
      typed.needsUpdate = true;
      return;
    }

    const originalCompile = typed.onBeforeCompile?.bind(typed);
    const uniforms = this.shaderUniforms;

    typed.onBeforeCompile = (shader: any, renderer: THREE.WebGLRenderer) => {
      originalCompile?.(shader, renderer);

      shader.defines = shader.defines ?? {};
      shader.defines['USE_UV'] = '';

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vPaintingUv;',
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n  vPaintingUv = uv;',
      );

      shader.uniforms['gradientMap'] = uniforms.gradientMap;
      shader.uniforms['useGradient'] = uniforms.useGradient;

      shader.fragmentShader =
        'uniform sampler2D gradientMap;\n' +
        'uniform bool useGradient;\n' +
        'varying vec2 vPaintingUv;\n' +
        shader.fragmentShader;

      const overlayChunk = `
      vec4 gradSample = texture2D(gradientMap, vPaintingUv);
      vec3 gradLinear = pow(gradSample.rgb, vec3(2.2));
      if (useGradient) {
        diffuseColor.rgb = mix(diffuseColor.rgb, gradLinear, gradSample.a);
      }
    `;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n' + overlayChunk,
      );
    };

    (typed as any).__surfacePaintApplied = true;
    typed.needsUpdate = true;
    this.paintedMaterials.push(typed);
  }

  private updateGradientTexture(): void {
    if (!this.gradientContext || !this.gradientCanvas) return;
    const ctx = this.gradientContext;
    const { width, height } = this.gradientCanvas;
    ctx.clearRect(0, 0, width, height);
    if (!this.gradientEnabled) {
      if (this.gradientTexture) this.gradientTexture.needsUpdate = true;
      return;
    }
    let gradient: CanvasGradient;
    const startY = this.gradientFlip ? height : 0;
    const endY = this.gradientFlip ? 0 : height;
    gradient = ctx.createLinearGradient(width / 2, startY, width / 2, endY);
    gradient.addColorStop(0, this.gradientStart);
    gradient.addColorStop(1, this.gradientEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (this.gradientTexture) this.gradientTexture.needsUpdate = true;
  }

  // --- RYSOWANIE PĘDZLA ---

  private paintBrush(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!hit.point) return;

    // Jeśli punkt jest blisko (0,0,0) lub pod podłogą, to błąd odczytu/separator – ignorujemy.
    if (hit.point.lengthSq() < 0.001 || hit.point.y < 0.001) return;

    if (!this.brushStrokeGroup || !this.brushStrokeMesh) {
      this.createBrushStroke(scene);
    }
    if (!this.brushStrokeMesh || !this.brushStrokeGroup) return;

    // REZERWACJA ZMIENNYCH 1-3 dla tej funkcji
    const currentPoint = this.tempVec3.copy(hit.point);
    const normal = this.tempVec3_2;

    if (hit.face?.normal) {
      normal.copy(hit.face.normal);
    } else {
      normal.set(0, 1, 0);
    }

    if (hit.object) {
      // Optymalizacja: updateMatrixWorld jest kosztowne.
      // Jeśli tort się nie rusza w trakcie malowania, można to pominąć lub robić rzadziej.
      // Tutaj zostawiamy dla poprawności.
      hit.object.updateMatrixWorld();
      normal.transformDirection(hit.object.matrixWorld).normalize();
    }

    if (normal.lengthSq() < 1e-4) normal.set(0, 1, 0);

    if (this.cakeGroup) {
      // Używamy wektora pomocniczego nr 3
      const cakeCenter = this.tempVec3_3;
      this.cakeGroup.getWorldPosition(cakeCenter);
      // Obliczamy wektor od środka tortu do punktu malowania
      // Możemy tu bezpiecznie użyć tempVec3_4, bo addBrushBlob jeszcze nie wywołane
      const toSurface = this.tempVec3_4.copy(currentPoint).sub(cakeCenter);
      if (normal.dot(toSurface) < 0) {
        normal.negate();
      }
    }

    const rawProgress = this.strokeCurrentLength / this.RAMP_UP_DISTANCE;
    const pressure = Math.min(1.0, Math.max(0.0, rawProgress));
    const easedPressure = pressure * pressure * (3 - 2 * pressure);

    const spacingBase = this.computeBrushWorldSpacing();
    const dynamicSpacing = THREE.MathUtils.lerp(spacingBase * 0.32, spacingBase * 0.22, easedPressure);

    if (this.lastBrushPoint) {
      // Używamy vec3 do kierunku
      const segmentVec = this.tempVec3_3.copy(currentPoint).sub(this.lastBrushPoint);
      const distance = segmentVec.length();

      if (distance >= dynamicSpacing) {
        this.strokeCurrentLength += distance;
        const steps = Math.max(1, Math.floor(distance / dynamicSpacing));

        // Normalizujemy kierunek
        const strokeDir = segmentVec.normalize();
        if (strokeDir.lengthSq() < 0.01 && this.lastStrokeDir) {
          strokeDir.copy(this.lastStrokeDir);
        }

        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          // Interpolacja punktu - używamy vec4 jako tymczasowego punktu dla bloba
          const p = this.tempVec3_4.copy(this.lastBrushPoint).lerp(currentPoint, t);

          const stepTotalLen = this.strokeCurrentLength - distance * (1 - t);
          const stepPressure = Math.min(1.0, Math.max(0.0, stepTotalLen / this.RAMP_UP_DISTANCE));

          // WAŻNE: addBrushBlob używa wewnątrz vec5, vec6, vec7, matrix1, matrix2.
          // Nie nadpisze nam p (vec4), normal (vec2) ani strokeDir (vec3).
          this.addBrushBlob(p, normal, strokeDir, stepPressure);
        }

        this.lastStrokeDir = this.lastStrokeDir ?? new THREE.Vector3();
        this.lastStrokeDir.copy(strokeDir);
      }
    } else {
      // Start stroke
      const defaultDir = this.tempVec3_3.set(0, 1, 0).projectOnPlane(normal);
      if (defaultDir.lengthSq() < 1e-4) defaultDir.set(1, 0, 0).projectOnPlane(normal);
      defaultDir.normalize();

      this.addBrushBlob(currentPoint, normal, defaultDir, 0.0);

      this.lastStrokeDir = this.lastStrokeDir ?? new THREE.Vector3();
      this.lastStrokeDir.copy(defaultDir);
    }

    // UPDATE RAZ NA KLATKĘ
    if (this.brushStrokeMesh) {
      this.brushStrokeMesh.count = this.brushStrokeIndex;
      this.brushStrokeMesh.instanceMatrix.needsUpdate = true;
      // Jeśli mesh rośnie, trzeba zaktualizować bounding sphere, żeby nie znikał pod kątem
      if (this.brushStrokeIndex % 50 === 0) {
        this.brushStrokeMesh.computeBoundingSphere();
      }
    }

    this.lastBrushPoint = this.lastBrushPoint ?? new THREE.Vector3();
    this.lastBrushPoint.copy(currentPoint);
  }

  private loadCakeTextures(): void {
    if (this.cakeNormalMap) return;
    this.textureLoader.load(this.TEXTURE_NORMAL_URL, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      this.cakeNormalMap = tex;
    });
    this.textureLoader.load(this.TEXTURE_ROUGH_URL, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      this.cakeRoughnessMap = tex;
    });
  }

  private getBrushAlphaMask(): THREE.CanvasTexture {
    if (this.brushTexture) return this.brushTexture;

    const w = 128;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, w, h);

    const coreGradient = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w * 0.35);
    coreGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    coreGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = coreGradient;
    ctx.fillRect(0,0,w,h);

    const bristles = 40;
    for(let i=0; i<bristles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 1.5) * (w * 0.38);
      const x = w/2 + Math.cos(angle) * r;
      const y = h/2 + Math.sin(angle) * r;
      const size = 1 + Math.random() * 1.5;

      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + Math.random() * 0.6})`;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'destination-in';
    const gradient = ctx.createRadialGradient(w/2, h/2, w*0.3, w/2, h/2, w*0.45);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0,0,w,h);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.brushTexture = texture;
    return texture;
  }

  private createBrushStroke(scene: THREE.Scene): void {
    const anchor = this.ensurePaintAnchor(scene);
    if (!anchor) return;
    const maxInstances = 10000;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const alphaMask = this.getBrushAlphaMask();

    const normalMap = this.cakeNormalMap ? this.cakeNormalMap.clone() : null;
    if (normalMap) {
      normalMap.wrapS = THREE.RepeatWrapping;
      normalMap.wrapT = THREE.RepeatWrapping;
      normalMap.repeat.set(1, 1);
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.brushColor),
      alphaMap: alphaMask,
      transparent: true,
      opacity: 1.0,
      alphaTest: 0.05,
      depthWrite: false,
      depthTest: true,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(2.5, 2.5),
      roughness: 0.6,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    (mesh as any).raycast = () => {};
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'Malowanie pędzlem';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = this.globalRenderOrder++;

    const group = new THREE.Group();
    group.name = 'Malowanie pędzlem';
    group.userData['displayName'] = 'Malowanie pędzlem';
    group.userData['isPaintDecoration'] = true;
    group.userData['isSurfaceStroke'] = true;
    group.userData['strokeIds'] = [] as string[];
    group.add(mesh);
    anchor.add(group);

    this.brushStrokeGroup = group;
    this.brushStrokeMesh = mesh;
    this.brushStrokeIndex = 0;
    this.brushStrokeCapacity = maxInstances;

    this.paintService.registerDecorationAddition(this.brushStrokeGroup);
    this.paintEntries.push(this.brushStrokeGroup);
  }

  private addBrushBlob(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    direction: THREE.Vector3,
    pressure: number
  ): void {
    if (!this.brushStrokeMesh) return;
    if (this.brushStrokeIndex >= this.brushStrokeCapacity) return;

    const anchorGroup = this.paintAnchor;

    // Obliczamy inverse anchor
    if (anchorGroup) {
      anchorGroup.updateMatrixWorld(true);
      this.tempMatrixInverse.copy(anchorGroup.matrixWorld).invert();
    }

    const radius = this.computeBrushRadius();

    // Obliczanie bazy (worldY, worldX)
    const worldYAxis = this.tempVec3_5.copy(direction).projectOnPlane(normal);
    if (worldYAxis.lengthSq() < 1e-6) worldYAxis.set(1, 0, 0).projectOnPlane(normal);
    worldYAxis.normalize().negate();

    const worldXAxis = this.tempVec3_6.crossVectors(worldYAxis, normal).normalize();

    // Offset + Sortowanie (ważne dla unikania migotania Z-fighting wewnątrz pędzla)
    const baseOffset = 0.0005;
    const sortingOffset = (this.brushStrokeIndex % 100) * 0.000005; // Nieco większy rozrzut

    const positionWorld = this.tempVec3_7
      .copy(point)
      .add(this.tempVec3_4.copy(normal).multiplyScalar(baseOffset + sortingOffset));

    // Tworzenie macierzy świata
    // tempMatrix = World Matrix
    this.tempMatrix.identity().makeBasis(worldXAxis, worldYAxis, normal);
    this.tempMatrix.setPosition(positionWorld);

    // Transformacja do local space (ParentInverse * World)
    // tempMatrix2 = Local Matrix
    if (anchorGroup) {
      this.tempMatrix2.copy(this.tempMatrixInverse).multiply(this.tempMatrix);
    } else {
      this.tempMatrix2.copy(this.tempMatrix);
    }

    // Skalowanie i Jitter
    const widthScale = THREE.MathUtils.lerp(1.1, 0.7, pressure);
    const lengthScale = THREE.MathUtils.lerp(1.2, 3.5, pressure);
    const scaleBase = radius * 2.5;

    // Obrót losowy (Jitter) - robimy to na macierzy lokalnej
    const jitter = (Math.random() - 0.5) * THREE.MathUtils.lerp(0.1, 0.3, pressure);
    // Używamy tempQuat zamiast alokować nową macierz rotacji
    this.tempQuat.setFromAxisAngle(this.tempVec3_4.set(0, 0, 1), jitter);
    // Mnożenie macierzy przez rotację (tempMatrix jako pomocnicza)
    const rotationMatrix = this.tempMatrix.makeRotationFromQuaternion(this.tempQuat);
    this.tempMatrix2.multiply(rotationMatrix);

    // Skalowanie
    this.tempMatrix2.scale(this.tempVec3_4.set(scaleBase * widthScale, scaleBase * lengthScale, 1));

    this.brushStrokeMesh.setMatrixAt(this.brushStrokeIndex, this.tempMatrix2);
    // Zwiększamy licznik, ale aktualizację GPU robimy w paintBrush na końcu (dla wydajności)
    this.brushStrokeIndex++;
  }

  private computeBrushRadius(): number {
    const min = 0.04;
    const max = 0.18;
    const normalized = THREE.MathUtils.clamp(this.brushSize, 0, 150) / 150;
    return THREE.MathUtils.lerp(min, max, normalized);
  }

  private computeBrushWorldSpacing(): number {
    return this.computeBrushRadius() * 0.5;
  }

  // --- RYSOWANIE POSYPKI ---

  private placeSprinkles(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!hit.point) return;
    if (hit.point.lengthSq() < 0.001) return;

    if (!this.sprinkleStrokeMesh || !this.sprinkleStrokeGroup || this.sprinkleStrokeShape !== this.sprinkleShape) {
      this.prepareSprinkleStroke(scene);
    }
    if (!this.sprinkleStrokeMesh || !this.sprinkleStrokeGroup) return;

    const anchorGroup = this.paintAnchor;
    if (anchorGroup) anchorGroup.updateMatrixWorld(true);
    if (anchorGroup) {
      this.tempMatrixInverse.copy(anchorGroup.matrixWorld).invert();
    }

    const anchorPointWorld = this.tempVec3.copy(hit.point);
    const worldNormal = this.tempVec3_2;

    if (this.isReplayingSprinkles) {
      if (hit.face?.normal) worldNormal.copy(hit.face.normal);
      else return;
    } else {
      if (hit.face?.normal) worldNormal.copy(hit.face.normal);
      else worldNormal.set(0, 1, 0);
      if (hit.object) {
        worldNormal.transformDirection(hit.object.matrixWorld).normalize();
      }
    }

    if (worldNormal.lengthSq() < 0.001) return;

    if (this.cakeGroup) {
      const center = this.tempVec3_3;
      this.cakeGroup.getWorldPosition(center);
      const toSurf = this.tempVec3_4.copy(anchorPointWorld).sub(center);
      if (worldNormal.dot(toSurf) < 0) worldNormal.negate();
    }

    const localNormal = this.tempVec3_3.copy(worldNormal);
    if (anchorGroup) localNormal.transformDirection(this.tempMatrixInverse).normalize();

    const tangent = this.tempVec3_4.copy(localNormal).cross(this.tempVec3_5.set(0, 1, 0));
    if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0);
    tangent.normalize();
    const bitangent = this.tempVec3_5.copy(localNormal).cross(tangent).normalize();

    // --- FIX NA LEWITOWANIE: Minimalny odstęp 0.0002 zamiast 0.003 ---
    const liftAmount = 0.0002;
    const anchorPointLocal = this.tempVec3_6.copy(anchorPointWorld)
      .add(this.tempVec3_7.copy(worldNormal).multiplyScalar(liftAmount));
    // -----------------------------------------------------------------

    if (anchorGroup) anchorGroup.worldToLocal(anchorPointLocal);

    const clusterSpacing = 0.16;
    const isFirstCluster = !this.lastSprinklePoint;

    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchorPointWorld) < clusterSpacing) {
      return;
    }

    if (!this.isReplayingSprinkles && !isFirstCluster) {
      const skipChance = THREE.MathUtils.lerp(0, 0.4, this.sprinkleRandomness);
      if (Math.random() < skipChance) return;
    }

    this.lastSprinklePoint = this.lastSprinklePoint ?? new THREE.Vector3();
    this.lastSprinklePoint.copy(anchorPointWorld);

    if (this.activeStroke?.mode === 'sprinkles' && !this.isReplayingSprinkles) {
      this.activeStroke.pathData.push(
        this.round(anchorPointWorld.x), this.round(anchorPointWorld.y), this.round(anchorPointWorld.z),
        this.round(worldNormal.x), this.round(worldNormal.y), this.round(worldNormal.z)
      );
    }

    const count = Math.max(2, Math.round(THREE.MathUtils.lerp(3, 7, this.sprinkleDensity / 20)));
    const startUpdateIndex = this.sprinkleStrokeIndex;

    for (let i = 0; i < count; i++) {
      if (this.sprinkleStrokeIndex >= this.sprinkleStrokeCapacity) break;

      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.12;

      this.tempVec3_7
        .copy(tangent).multiplyScalar(Math.cos(angle) * r)
        .add(this.tempVec3_2.copy(bitangent).multiplyScalar(Math.sin(angle) * r));

      this.tempVec3_7.add(anchorPointLocal)
        .add(this.tempVec3_2.copy(localNormal).multiplyScalar(Math.random() * 0.0005));

      const s = THREE.MathUtils.lerp(this.sprinkleMinScale, this.sprinkleMaxScale, Math.random());
      this.tempScale.set(s, s, s);

      this.tempQuat.setFromUnitVectors(this.tempVec3_2.set(0, 1, 0), localNormal);
      this.tempQuat2.setFromAxisAngle(localNormal, Math.random() * Math.PI * 2);
      const tiltAxis = Math.random() < 0.5 ? tangent : bitangent;
      this.tempQuat3.setFromAxisAngle(tiltAxis, Math.random() - 0.5);
      this.tempQuat.multiply(this.tempQuat3).multiply(this.tempQuat2);

      this.tempMatrix.compose(this.tempVec3_7, this.tempQuat, this.tempScale);
      this.sprinkleStrokeMesh.setMatrixAt(this.sprinkleStrokeIndex, this.tempMatrix);

      let colorHex: string;
      if (this.sprinkleUseRandomColors) {
        colorHex = SPRINKLE_PALETTE[Math.floor(Math.random() * SPRINKLE_PALETTE.length)];
      } else {
        colorHex = this.sprinkleColor;
      }
      this.tempColor.set(colorHex).convertSRGBToLinear();
      this.sprinkleStrokeMesh.setColorAt(this.sprinkleStrokeIndex, this.tempColor);

      this.sprinkleStrokeIndex++;
    }

    // Aktualizacja w trybie Live
    const added = this.sprinkleStrokeIndex - startUpdateIndex;
    if (added > 0 && !this.isReplayingSprinkles) {
      this.sprinkleStrokeMesh.count = this.sprinkleStrokeIndex;
      this.sprinkleStrokeMesh.instanceMatrix.needsUpdate = true;
      this.sprinkleStrokeMesh.instanceMatrix.addUpdateRange(startUpdateIndex * 16, added * 16);
      if (this.sprinkleStrokeMesh.instanceColor) {
        this.sprinkleStrokeMesh.instanceColor.needsUpdate = true;
        this.sprinkleStrokeMesh.instanceColor.addUpdateRange(startUpdateIndex * 3, added * 3);
      }
      if (this.sprinkleStrokeIndex % 100 === 0) {
        this.sprinkleStrokeMesh.computeBoundingSphere();
      }
    }
  }

  private ensureSprinkleResources(): void {
    if (!this.sprinkleGeometryCache) {
      this.sprinkleGeometryCache = {
        stick: new THREE.CapsuleGeometry(0.005, 0.024, 4, 8),
        ball: new THREE.SphereGeometry(0.008, 8, 6),
        star: this.createStarGeometry(),
      };
    }
    if (!this.sprinkleMaterial) {
      this.sprinkleMaterial = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 0.18,
        color: 0xffffff,
        emissive: 0x000000,
        roughnessMap: null,
        metalnessMap: null,
        vertexColors: false,
      });
    }
  }

  private refreshSprinkleMaterialColor(): void {
    // Kolor posypki jest ustawiany per-instancja w placeSprinkles.
  }

  private createStarGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    const spikes = 5;
    const outerRadius = 0.012;
    const innerRadius = 0.0065;
    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (spikes * 2)) * Math.PI * 2;
      points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    const shape = new THREE.Shape(points);
    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: 0.004,
      bevelEnabled: true,
      bevelThickness: 0.002,
      bevelSize: 0.0015,
      bevelSegments: 2,
    });
    extrude.center();
    if (extrude.index) {
      extrude.toNonIndexed();
    }
    return new THREE.BufferGeometry().copy(extrude);
  }

  private prepareSprinkleStroke(scene?: THREE.Scene): void {
    this.ensureSprinkleResources();
    if (this.sprinkleStrokeMesh && this.sprinkleStrokeShape === this.sprinkleShape) return;
    const anchor = this.ensurePaintAnchor(scene);
    if (!anchor) return;

    const capacity = 3000;
    const geometry = this.sprinkleGeometryCache![this.sprinkleShape];
    const material = this.sprinkleMaterial!;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    (mesh as any).raycast = () => {};
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.name = 'Posypka';
    mesh.frustumCulled = false;
    mesh.renderOrder = this.globalRenderOrder++;

    const group = new THREE.Group();
    group.name = 'Posypka';
    group.userData['displayName'] = 'Posypka';
    group.userData['isPaintDecoration'] = true;
    group.userData['isSurfaceStroke'] = true;
    group.userData['strokeIds'] = [] as string[];
    group.add(mesh);
    anchor.add(group);

    this.sprinkleStrokeGroup = group;
    this.sprinkleStrokeMesh = mesh;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = capacity;
    this.sprinkleStrokeShape = this.sprinkleShape;

    this.paintService.registerDecorationAddition(this.sprinkleStrokeGroup);
    this.sprinkleEntries.push(this.sprinkleStrokeGroup);
  }

  private flagMaterialUpdate(): void {
    if (this.shaderUniforms) {
      this.shaderUniforms.useGradient.value = this.gradientEnabled;
      if (this.gradientTexture) this.shaderUniforms.gradientMap.value = this.gradientTexture;
      const bbox = this.cakeGroup ? new THREE.Box3().setFromObject(this.cakeGroup) : null;
      if (bbox) {
        this.shaderUniforms.gradientMinY.value = bbox.min.y;
        this.shaderUniforms.gradientHeight.value = Math.max(0.001, bbox.max.y - bbox.min.y);
      }
      this.shaderUniforms.gradientFlip.value = this.gradientFlip ? 1 : 0;
    }
    this.paintedMaterials.forEach((mat) => (mat.needsUpdate = true));
  }

  private sanitizeHexColor(value: string, fallback: string = DEFAULT_SPRINKLE_COLOR): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return /^#([0-9a-fA-F]{6})$/.test(normalized) ? normalized : fallback;
  }

  private disposeSprinkles(): void {
    const allEntries = [...this.sprinkleEntries];
    if (this.sprinkleStrokeGroup) allEntries.push(this.sprinkleStrokeGroup);
    const sharedGeometries = this.sprinkleGeometryCache
      ? new Set<THREE.BufferGeometry>([
        this.sprinkleGeometryCache.stick,
        this.sprinkleGeometryCache.ball,
        this.sprinkleGeometryCache.star,
      ])
      : null;
    const sharedMaterial = this.sprinkleMaterial ?? null;

    allEntries.forEach((entry) => {
      entry.parent?.remove(entry);
      entry.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as { isMesh?: boolean }).isMesh) {
          const geom = mesh.geometry as THREE.BufferGeometry | undefined;
          if (geom && (!sharedGeometries || !sharedGeometries.has(geom))) geom.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => { if (m && m !== sharedMaterial) m.dispose(); });
          } else if (mesh.material && mesh.material !== sharedMaterial) {
            mesh.material.dispose();
          }
        }
      });
    });
    this.sprinkleEntries = [];
    this.sprinkleStrokeGroup = null;
    this.sprinkleStrokeMesh = null;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = 0;
    this.sprinkleStrokeShape = null;
  }

  private disposePaintStrokes(): void {
    this.paintEntries.forEach((entry) => {
      entry.parent?.remove(entry);
      entry.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as { isMesh?: boolean }).isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
          else mesh.material?.dispose();
        }
      });
    });
    this.paintEntries = [];
    this.brushStrokeGroup = null;
    this.brushStrokeMesh = null;
    this.brushStrokeIndex = 0;
    this.lastBrushPoint = null;
    this.brushStrokeCapacity = 0;
  }
}

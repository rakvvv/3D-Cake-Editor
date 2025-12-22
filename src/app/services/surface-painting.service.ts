import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import {
  SerializedBrushStroke,
  SerializedSprinkleStroke,
  SurfacePaintingPreset,
} from '../models/cake-preset';
import {
  GradientTextureConfig,
  GradientTextureService,
  PaintingShaderUniforms,
} from './gradient-texture.service';
import { SamplingService } from './interaction/sampling/sampling.service';
import { Command, HistoryDomain } from './interaction/types/interaction-types';
import { HistoryService } from './interaction/history/history.service';
import { PresetService } from './interaction/presets/preset.service';
import { PaintMaterialHooksService } from './painting/common/paint-material-hooks.service';
import { SurfaceStrokeRendererService } from './painting/surface/surface-stroke-renderer.service';
import { SurfaceStrokeBuilderService } from './painting/surface/surface-stroke-builder.service';
import { CommandFactoryService } from './interaction/history/command-factory.service';
import { SprinkleStrokeBuilderService } from './painting/surface/sprinkles/sprinkle-stroke-builder.service';
import { SprinkleRendererService } from './painting/surface/sprinkles/sprinkle-renderer.service';

export type PaintingMode = 'brush' | 'gradient' | 'sprinkles';
export type SprinkleShape = 'stick' | 'ball' | 'star';

const SPRINKLE_PALETTE = ['#ff6b81', '#ffd66b', '#6bffb0', '#6bb8ff', '#ffffff'];
const DEFAULT_SPRINKLE_COLOR = SPRINKLE_PALETTE[0];

// --- SEPARATOR ---
// Służy do oddzielania pociągnięć w scalonym pliku JSON
const STROKE_SEPARATOR = 99999;

@Injectable({ providedIn: 'root' })
export class SurfacePaintingService {
  public enabled = false;
  public mode: PaintingMode = 'brush';

  // Parametry pędzla
  public brushSize = 90;
  public brushOpacity = 1.0;
  public brushColor = '#ff6b6b';

  private brushTexture: THREE.CanvasTexture | null = null;
  public get gradientEnabled(): boolean {
    return this.gradientTextureService.gradientEnabled;
  }

  public set gradientEnabled(enabled: boolean) {
    this.gradientTextureService.gradientEnabled = enabled;
  }

  public get gradientFlip(): boolean {
    return this.gradientTextureService.gradientFlip;
  }

  public set gradientFlip(flip: boolean) {
    this.gradientTextureService.gradientFlip = flip;
  }

  public get gradientStart(): string {
    return this.gradientTextureService.gradientStart;
  }

  public set gradientStart(color: string) {
    this.gradientTextureService.gradientStart = color;
  }

  public get gradientEnd(): string {
    return this.gradientTextureService.gradientEnd;
  }

  public set gradientEnd(color: string) {
    this.gradientTextureService.gradientEnd = color;
  }
  public sprinkleDensity = 6;
  public sprinkleShape: SprinkleShape = 'stick';
  public sprinkleMinScale = 0.7;
  public sprinkleMaxScale = 1.2;
  public sprinkleUseRandomColors = true;
  public sprinkleColor = DEFAULT_SPRINKLE_COLOR;
  public sprinkleRandomness = 0.3;

  private readonly historyDomain = HistoryDomain.Surface;
  private readonly isBrowser: boolean;
  private currentProjectId: string | null = null;
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

  // Optymalizacja zapisu (nie zapisujemy punktów gęściej niż co 1.5cm)
  private lastRecordedPoint: THREE.Vector3 | null = null;

  private textureLoader = new THREE.TextureLoader();
  private cakeNormalMap: THREE.Texture | null = null;
  private cakeRoughnessMap: THREE.Texture | null = null;
  private readonly TEXTURE_NORMAL_URL = '/assets/textures/Pink_Cake_Frosting_01-normal.jpg';
  private readonly TEXTURE_ROUGH_URL = '/assets/textures/Pink_Cake_Frosting_01-bump.jpg';
  private lastStrokeDir: THREE.Vector3 | null = null;
  private cakeGroup: THREE.Group | null = null;
  private surfaceRoot: THREE.Group | null = null;
  private paintAnchor: THREE.Group | null = null;
  private paintedMaterials: THREE.Material[] = [];
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
  private suppressHistory = false;
  private historySeededForProject: string | null = null;

  // Tutaj przechowujemy surowe pociągnięcia przed scaleniem
  private brushStrokes: SerializedBrushStroke[] = [];
  private sprinkleStrokes: SerializedSprinkleStroke[] = [];
  private activeStroke: SerializedBrushStroke | SerializedSprinkleStroke | null = null;
  private nextStrokeId = 1;
  private isReplayingSprinkles = false;

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    private readonly gradientTextureService: GradientTextureService,
    private readonly samplingService: SamplingService,
    private readonly historyService: HistoryService,
    private readonly presetService: PresetService,
    private readonly paintHooks: PaintMaterialHooksService,
    private readonly surfaceRenderer: SurfaceStrokeRendererService,
    private readonly surfaceStrokeBuilder: SurfaceStrokeBuilderService,
    private readonly commandFactory: CommandFactoryService,
    private readonly sprinkleBuilder: SprinkleStrokeBuilderService,
    private readonly sprinkleRenderer: SprinkleRendererService,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.gradientTextureService.refreshTexture();
    }
    this.samplingService.getConfig(this.historyDomain);
    this.historyService.registerDomain(this.historyDomain);
  }

  public resetProjectState(projectId: string): void {
    this.suppressHistory = true;
    try {
      this.currentProjectId = projectId;
      this.historyService.resetDomain(this.historyDomain);
      this.historyService.registerDomain(this.historyDomain);
      this.enabled = false;
      this.mode = 'brush';
      this.painting = false;
      this.clearPaintInternal();
      this.brushStrokes = [];
      this.sprinkleStrokes = [];
      this.activeStroke = null;
      this.nextStrokeId = 1;
      this.lastBrushPoint = null;
      this.sprinkleBuilder.resetStrokeState();
      this.lastStrokeDir = null;
      this.lastRecordedPoint = null;
      this.strokeCurrentLength = 0;
      this.globalRenderOrder = 100;
      this.historySeededForProject = null;
      this.cakeGroup = null;
      this.surfaceRoot?.parent?.remove(this.surfaceRoot);
      this.surfaceRoot = null;
      this.paintAnchor?.parent?.remove(this.paintAnchor);
      this.paintAnchor = null;
    } finally {
      this.suppressHistory = false;
    }
  }

  public disposeProjectState(): void {
    this.resetProjectState(`disposed-${Date.now()}`);
    this.currentProjectId = null;
  }

  // --- GŁÓWNE METODY STERUJĄCE ---

  public attachCake(cake: THREE.Group | null, resetPaint = false): void {
    this.loadCakeTextures();
    if (resetPaint) {
      this.sprinkleRenderer.disposeSprinkles(this.getStrokeGroups((entry) => !!entry.userData?.['isPaintDecoration']));
      this.clearPaint();
    }
    this.cakeGroup = cake;
    this.ensureSurfaceRoot();
    this.ensurePaintAnchor();
    this.applyPaintingShader();
    this.reattachPaintEntries();
    this.gradientTextureService.refreshTexture();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.lastBrushPoint = null;
  }

  public isPainting(): boolean {
    return this.painting;
  }

  public undo(): void {
    this.historyService.undo(this.historyDomain);
    this.paintHooks.notifySceneChanged();
  }

  public redo(): void {
    this.historyService.redo(this.historyDomain);
    this.paintHooks.notifySceneChanged();
  }

  public canUndo(): boolean {
    return this.historyService.canUndo(this.historyDomain);
  }

  public canRedo(): boolean {
    return this.historyService.canRedo(this.historyDomain);
  }

  public startStroke(): void {
    this.painting = true;
    this.lastBrushPoint = null;
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
      const canReuse = this.sprinkleRenderer.canReuseStroke(
        this.sprinkleShape,
        this.sprinkleColor,
        this.sprinkleUseRandomColors,
      );
      if (!canReuse) {
        this.finalizePreviousBatch();
        this.sprinkleRenderer.markLastUsed(this.sprinkleShape, this.sprinkleColor);
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
    this.sprinkleRenderer.resetBatchState();
    this.sprinkleBuilder.resetStrokeState();
  }

  public async handlePointer(hit: THREE.Intersection, scene: THREE.Scene): Promise<void> {
    if (!this.isBrowser || !this.painting) return;
    if (!hit.point) return;

    // 1. ZAPIS DANYCH
    if (this.activeStroke) {
      const p = hit.point;
      const decision = this.samplingService.shouldRecordPoint(
        this.lastRecordedPoint,
        p,
        this.samplingService.getConfig(this.historyDomain),
      );

      if (decision.accepted) {
        let normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
        if (hit.object) {
          normal.transformDirection(hit.object.matrixWorld).normalize();
        }

        this.lastRecordedPoint = this.lastRecordedPoint ?? new THREE.Vector3();
        this.lastRecordedPoint.copy(p);

        // Płaski zapis: 6 liczb na jeden punkt
        const brushPath = this.activeStroke.pathData ?? (this.activeStroke.pathData = []);
        brushPath.push(
          this.round(p.x), this.round(p.y), this.round(p.z),
          this.round(normal.x), this.round(normal.y), this.round(normal.z)
        );
      }
    }

    // 2. RYSOWANIE WIZUALNE
    if (this.mode === 'gradient') {
      this.applyGradientFromHit(hit);
      return;
    }
    if (this.mode === 'sprinkles') {
      this.sprinkleBuilder.placeSprinkles({
        hit,
        anchor: this.ensurePaintAnchor(scene),
        cakeGroup: this.cakeGroup ?? null,
        settings: {
          shape: this.sprinkleShape,
          density: this.sprinkleDensity,
          useRandomColors: this.sprinkleUseRandomColors,
          color: this.sprinkleColor,
          randomness: this.sprinkleRandomness,
          minScale: this.sprinkleMinScale,
          maxScale: this.sprinkleMaxScale,
        },
        projectId: this.currentProjectId,
        isReplaying: this.isReplayingSprinkles,
        activeStroke: (this.activeStroke as SerializedSprinkleStroke | null) ?? null,
        nextStrokeId: this.nextStrokeId,
        getRenderOrder: () => this.globalRenderOrder++,
        trackSurfaceAddition: (obj) => this.trackSurfaceAddition(obj),
      });
      return;
    }
    this.paintBrush(hit, scene);
  }

  public endStroke(): void {
    this.painting = false;
    this.lastBrushPoint = null;
    this.sprinkleBuilder.resetStrokeState();
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
          this.brushStrokeGroup.userData['projectId'] = this.currentProjectId ?? undefined;
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

    if (finishedStroke?.mode === 'sprinkles') {
      const strokeSeed = (finishedStroke as SerializedSprinkleStroke | null)?.strokeSeed
        ?? this.sprinkleRenderer.getStrokeSeed();
      const pathData = finishedStroke.pathData ?? [];
      const pathPacked = pathData.length > 0 ? this.sprinkleBuilder.packPathData(pathData) : undefined;
      const finalizedStroke: SerializedSprinkleStroke = {
        ...(finishedStroke as SerializedSprinkleStroke),
        strokeSeed: strokeSeed ?? (finishedStroke as SerializedSprinkleStroke).strokeSeed,
        pathPacked,
        pathData,
      };
      const result = this.sprinkleRenderer.finalizeStroke(
        finalizedStroke,
        this.currentProjectId,
      );
      if (result.accepted) {
        if (pathPacked) {
          finalizedStroke.pathData = [];
        }
        this.sprinkleStrokes.push(finalizedStroke);
      }
    } else {
      this.sprinkleRenderer.finalizeStroke(null, this.currentProjectId);
    }
  }

  // --- EKSPORT I ODTWARZANIE (Z OPTYMALIZACJĄ) ---

  public exportPaintingPreset(): SurfacePaintingPreset {
    // 1. Filtrujemy (usuwamy undo)
    const activeIds = this.collectActiveStrokeIds();

    const validBrushStrokes = this.brushStrokes.filter((stroke) => activeIds.has(stroke.id));

    const validSprinkleStrokes = this.sprinkleStrokes.filter((stroke) => activeIds.has(stroke.id));

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
      const pathData = this.getSprinklePathData(stroke);
      if (!mergedSprinklesMap.has(key)) {
        mergedSprinklesMap.set(key, {
          id: `merged-sprinkles-${this.nextStrokeId++}`,
          mode: 'sprinkles',
          shape: stroke.shape,
          color: stroke.color,
          useRandomColors: stroke.useRandomColors,
          density: stroke.density,
          strokeSeed: stroke.strokeSeed,
          pathData: [...pathData],
        });
      } else {
        const existing = mergedSprinklesMap.get(key)!;
        const existingPath = existing.pathData ?? (existing.pathData = []);
        existingPath.push(...pathData);
      }
    });

    const mergedSprinkles = Array.from(mergedSprinklesMap.values()).map((stroke) => {
      const packed = this.sprinkleBuilder.packPathData(stroke.pathData ?? []);
      return { ...stroke, pathPacked: packed, pathData: [] } as SerializedSprinkleStroke;
    });

    const preset: SurfacePaintingPreset = {
      brushColor: this.brushColor,
      brushStrokes: Array.from(mergedBrushMap.values()),
      sprinkleStrokes: mergedSprinkles,
    };

    return this.presetService.exportPreset(preset).data;
  }

  public restorePaintingPreset(
    preset: SurfacePaintingPreset | undefined | null,
    options?: { skipHistory?: boolean },
  ): void {
    const previous = this.exportPaintingPreset();
    const targetPreset = preset
      ? this.presetService.importPreset<SurfacePaintingPreset>({version: 1, data: preset})
      : null;

    if (options?.skipHistory) {
      this.applyPresetSnapshot(targetPreset);
      return;
    }

    const command: Command<void> = {
      do: () => this.applyPresetSnapshot(targetPreset),
      undo: () => this.applyPresetSnapshot(previous),
      description: 'surface-restore-preset',
    };

    this.historyService.push(this.historyDomain, command);
  }

  private applyPresetSnapshot(preset: SurfacePaintingPreset | undefined | null): void {
    if (!preset) return;

    this.suppressHistory = true;
    try {
      this.clearPaintInternal();
      this.brushStrokes = [];
      this.sprinkleStrokes = [];
      this.activeStroke = null;
      this.nextStrokeId = 1;

      this.attachCake(this.cakeGroup, false);
      this.brushColor = preset.brushColor ?? this.brushColor;

      preset.brushStrokes?.forEach((stroke) => this.replayBrushStroke(stroke));
      preset.sprinkleStrokes?.forEach((stroke) => this.replaySprinkleStroke(stroke));
    } finally {
      this.suppressHistory = false;
    }
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
    this.sprinkleBuilder.resetStrokeState();
    this.startStroke();

    if (this.activeStroke) {
      this.activeStroke.id = stroke.id;
      const replayPath = this.getSprinklePathData(stroke);
      // WAŻNE: Kopiujemy dane, żeby endStroke nie uznał grupy za pustą
      this.activeStroke.pathData = [...replayPath];
      (this.activeStroke as SerializedSprinkleStroke).strokeSeed = stroke.strokeSeed;
      (this.activeStroke as SerializedSprinkleStroke).pathPacked = stroke.pathPacked;

      const parts = stroke.id.split('-');
      const numericId = Number(parts[parts.length - 1]);
      if (!Number.isNaN(numericId)) {
        this.nextStrokeId = Math.max(this.nextStrokeId, numericId + 1);
      }
    }

    const data = this.getSprinklePathData(stroke);
    for (let i = 0; i < data.length; i += 6) {
      const x = data[i];
      const y = data[i + 1];
      const z = data[i + 2];

      if (Math.abs(x - STROKE_SEPARATOR) < 1) {
        this.sprinkleBuilder.resetStrokeState();
        continue;
      }
      if (Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001 && Math.abs(z) < 0.0001) {
        this.sprinkleBuilder.resetStrokeState();
        continue;
      }

      // Filtr duchów pod spodem (mniej agresywny niż 0.05, ale skuteczny na 0.000)
      if (y < 0.001) {
        this.sprinkleBuilder.resetStrokeState();
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

      this.sprinkleBuilder.placeSprinkles({
        hit,
        anchor: this.ensurePaintAnchor(scene),
        cakeGroup: this.cakeGroup ?? null,
        settings: {
          shape: this.sprinkleShape,
          density: this.sprinkleDensity,
          useRandomColors: this.sprinkleUseRandomColors,
          color: this.sprinkleColor,
          randomness: this.sprinkleRandomness,
          minScale: this.sprinkleMinScale,
          maxScale: this.sprinkleMaxScale,
        },
        projectId: this.currentProjectId,
        isReplaying: this.isReplayingSprinkles,
        activeStroke: (this.activeStroke as SerializedSprinkleStroke | null) ?? null,
        nextStrokeId: this.nextStrokeId,
        getRenderOrder: () => this.globalRenderOrder++,
        trackSurfaceAddition: (obj) => this.trackSurfaceAddition(obj),
      });
    }

    this.sprinkleRenderer.syncAfterReplay();
    // -------------------------------------------------

    this.endStroke();
    this.isReplayingSprinkles = false;
  }

  private getSprinklePathData(stroke: SerializedSprinkleStroke): number[] {
    return this.sprinkleBuilder.unpackPathData(stroke.pathPacked, stroke.pathData ?? []);
  }

  // --- RESZTA LOGIKI (GRADIENTY, CZYSZCZENIE, UTILS) ---

  public applyGradientSettings(): void {
    this.gradientTextureService.updateConfig({ enabled: true });
    this.applyPaintingShader();
    this.flagMaterialUpdate();
  }

  public disableGradient(): void {
    this.gradientTextureService.updateConfig({ enabled: false });
    this.applyPaintingShader();
    this.flagMaterialUpdate();
  }

  public clearPaint(): void {
    const previous = this.exportPaintingPreset();
    const command: Command<void> = {
      do: () => this.clearPaintInternal(),
      undo: () => this.applyPresetSnapshot(previous),
      description: 'surface-clear-paint',
    };
    this.historyService.push(this.historyDomain, command);
  }

  public clearSprinkles(): void {
    const previous = this.exportPaintingPreset();
    const command: Command<void> = {
      do: () => this.clearSprinklesInternal(),
      undo: () => this.applyPresetSnapshot(previous),
      description: 'surface-clear-sprinkles',
    };
    this.historyService.push(this.historyDomain, command);
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
    const previous = this.exportPaintingPreset();
    const command: Command<void> = {
      do: () => this.clearBrushStrokesInternal(),
      undo: () => this.applyPresetSnapshot(previous),
      description: 'surface-clear-brush',
    };
    this.historyService.push(this.historyDomain, command);
  }

  private clearPaintInternal(): void {
    this.finalizePreviousBatch();
    this.clearSprinklesInternal();
    this.clearBrushStrokesInternal();
    this.activeStroke = null;
    this.nextStrokeId = 1;
    this.lastRecordedPoint = null;
    this.globalRenderOrder = 100;
  }

  private clearSprinklesInternal(): void {
    this.sprinkleBuilder.resetStrokeState();
    this.lastRecordedPoint = null;
    this.activeStroke = null;
    this.sprinkleStrokes = [];
    this.sprinkleRenderer.disposeSprinkles(this.getStrokeGroups((entry) => !!entry.userData?.['isPaintDecoration']));
  }

  private clearBrushStrokesInternal(): void {
    this.disposePaintStrokes();
    this.brushStrokes = [];
    this.activeStroke = null;
    this.lastRecordedPoint = null;
  }

  private applyGradientFromHit(hit: THREE.Intersection): void {
    if (!hit.uv) return;
    this.gradientTextureService.updateConfig({ enabled: true });
    this.applyPaintingShader();
    this.flagMaterialUpdate();
  }

  private round(val: number): number {
    return SurfacePaintingService.roundValue(val);
  }

  public static roundValue(val: number): number {
    return Math.round(val * 10000) / 10000;
  }

  private applyPaintingShader(): void {
    if (!this.cakeGroup) return;

    const bbox = new THREE.Box3().setFromObject(this.cakeGroup);
    this.shaderUniforms = this.gradientTextureService.updateUniformsFromBounds(
      bbox,
      this.shaderUniforms,
    ) ?? this.shaderUniforms;
    if (!this.shaderUniforms) return;

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
    const surfaceRoot = this.ensureSurfaceRoot();
    if (!anchor || !surfaceRoot) return;

    if (anchor.parent !== surfaceRoot) {
      surfaceRoot.add(anchor);
    }

    this.getStrokeGroups().forEach((entry) => {
      if (!entry.parent && !entry.userData?.['removedByUndo']) {
        anchor.add(entry);
      } else if (entry.userData?.['removedByUndo']) {
        entry.parent?.remove(entry);
      }
    });
  }

  public seedHistoryFromExistingStrokes(): void {
    if (!this.cakeGroup) return;
    const anchor = this.ensurePaintAnchor();
    const parent = this.ensureSurfaceRoot() ?? this.cakeGroup;
    if (!anchor || !parent) return;

    const projectId = this.currentProjectId ?? undefined;
    if (this.historySeededForProject === projectId) {
      return;
    }

    const strokes = this.getStrokeGroups((entry) => !entry.userData?.['removedByUndo']);
    strokes.forEach((entry) => {
      entry.userData['projectId'] = projectId;
      entry.userData['belongsToCakeId'] = this.cakeGroup?.uuid;
      const command = this.createAddRemoveCommand(entry, entry.parent ?? parent);
      this.historyService.seed(this.historyDomain, command);
    });

    this.historySeededForProject = projectId ?? null;
  }

  private getStrokeGroups(filter?: (entry: THREE.Object3D) => boolean): THREE.Object3D[] {
    const anchor = this.paintAnchor;
    if (!anchor) return [];

    const results: THREE.Object3D[] = [];
    anchor.traverse((child) => {
      if (!child.userData?.['isSurfaceStroke'] || child.userData?.['removedByUndo']) return;
      if (!filter || filter(child)) {
        results.push(child);
      }
    });
    return results;
  }

  private collectActiveStrokeIds(): Set<string> {
    const ids = new Set<string>();
    this.getStrokeGroups().forEach((entry) => {
      const strokeIds = entry.userData?.['strokeIds'] as string[] | undefined;
      const strokeId = entry.userData?.['strokeId'] as string | undefined;
      if (strokeIds) strokeIds.forEach((id) => ids.add(id));
      if (strokeId) ids.add(strokeId);
    });
    return ids;
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
    const parent = this.ensureSurfaceRoot();
    const targetScene = scene ?? (this.cakeGroup?.parent as THREE.Scene) ?? null;
    if (!parent || !targetScene) {
      return null;
    }

    const anchor = this.paintAnchor ?? new THREE.Group();
    anchor.name = 'Cake Paint Anchor';
    anchor.userData['displayName'] = 'Malowanie tortu';
    anchor.userData['isPaintAnchor'] = true;
    anchor.userData['projectId'] = this.currentProjectId ?? undefined;
    if (anchor.parent !== parent) {
      parent.add(anchor);
    }

    this.paintAnchor = anchor;
    return anchor;
  }

  private ensureSurfaceRoot(): THREE.Group | null {
    if (!this.cakeGroup) return null;

    const context = {
      projectId: this.currentProjectId,
      cakeRoot: this.cakeGroup,
      scene: null,
      onSceneChanged: () => this.paintHooks.notifySceneChanged(),
    };
    const root = this.surfaceRenderer.ensureSurfaceRoot(context);
    this.surfaceRoot = root;
    return root;
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

  public updateGradientTexture(config: GradientTextureConfig): string | null {
    this.gradientTextureService.updateConfig(config);
    this.applyPaintingShader();
    this.flagMaterialUpdate();
    return this.gradientTextureService.getDataUrl();
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

      const strokeId = (this.activeStroke as any)?.id ?? `brush-${this.nextStrokeId}`;
      const group = this.surfaceStrokeBuilder.createBrushStrokeGroup(
        strokeId,
        this.brushColor,
        this.brushOpacity,
        mesh.renderOrder,
        this.currentProjectId,
      );
      group.add(mesh);
      anchor.add(group);

    this.brushStrokeGroup = group;
    this.brushStrokeMesh = mesh;
    this.brushStrokeIndex = 0;
    this.brushStrokeCapacity = maxInstances;

    this.trackSurfaceAddition(this.brushStrokeGroup);
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

  
  private flagMaterialUpdate(): void {
    if (this.shaderUniforms && this.cakeGroup) {
      const bbox = new THREE.Box3().setFromObject(this.cakeGroup);
      this.shaderUniforms =
        this.gradientTextureService.updateUniformsFromBounds(bbox, this.shaderUniforms) ??
        this.shaderUniforms;
    }
    this.paintedMaterials.forEach((mat) => (mat.needsUpdate = true));
    this.paintHooks.notifySceneChanged();
  }

  private trackSurfaceAddition(object: THREE.Object3D | null): void {
    if (!object || this.suppressHistory) {
      return;
    }

    const parent = object.parent ?? this.cakeGroup ?? null;
    const command = this.createAddRemoveCommand(object, parent);
    this.historyService.push(this.historyDomain, command, {execute: false});
    this.paintHooks.notifySceneChanged();
  }

  private createAddRemoveCommand(
    object: THREE.Object3D,
    parent: THREE.Object3D | null,
  ): Command<THREE.Object3D | null> {
    const targetParent = parent ?? this.cakeGroup ?? null;
    const base = this.commandFactory.createAddRemoveCommand(
      this.historyDomain,
      object,
      targetParent,
      this.currentProjectId,
      () => this.paintHooks.notifySceneChanged(),
    );
    return base;
  }

  private sanitizeHexColor(value: string, fallback: string = DEFAULT_SPRINKLE_COLOR): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return /^#([0-9a-fA-F]{6})$/.test(normalized) ? normalized : fallback;
  }

  private disposePaintStrokes(): void {
    this.getStrokeGroups((entry) => !!entry.userData?.['isPaintStroke']).forEach((entry) => {
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
    this.brushStrokeGroup = null;
    this.brushStrokeMesh = null;
    this.brushStrokeIndex = 0;
    this.lastBrushPoint = null;
    this.brushStrokeCapacity = 0;
  }
}

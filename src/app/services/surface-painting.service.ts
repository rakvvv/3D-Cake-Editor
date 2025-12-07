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

  private readonly isBrowser: boolean;
  private gradientCanvas?: HTMLCanvasElement;
  private gradientContext?: CanvasRenderingContext2D | null;
  private gradientTexture?: THREE.CanvasTexture;
  private painting = false;
  private lastBrushPoint: THREE.Vector3 | null = null;

  // --- LOGIKA CIŚNIENIA ---
  private strokeCurrentLength = 0;
  // Dystans, na którym następuje przejście z "kropy" w "smuge"
  private readonly RAMP_UP_DISTANCE = 0.4;

  private brushStrokeGroup: THREE.Group | null = null;
  private brushStrokeMesh: THREE.InstancedMesh | null = null;
  private brushStrokeIndex = 0;
  private brushStrokeCapacity = 0;
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
  private readonly tempColor = new THREE.Color();
  private brushStrokes: SerializedBrushStroke[] = [];
  private sprinkleStrokes: SerializedSprinkleStroke[] = [];
  private activeStroke: SerializedBrushStroke | SerializedSprinkleStroke | null = null;
  private nextStrokeId = 1;

  constructor(@Inject(PLATFORM_ID) platformId: object, private readonly paintService: PaintService) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.ensureCanvases();
    }
  }

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

    if (this.mode === 'brush') {
      this.activeStroke = {
        id: `brush-${this.nextStrokeId++}`,
        mode: 'brush',
        color: this.brushColor,
        brushSize: this.brushSize,
        points: [],
      };
    } else if (this.mode === 'sprinkles') {
      this.activeStroke = {
        id: `sprinkles-${this.nextStrokeId++}`,
        mode: 'sprinkles',
        shape: this.sprinkleShape,
        density: this.sprinkleDensity,
        useRandomColors: this.sprinkleUseRandomColors,
        color: this.sprinkleColor,
        points: [],
      };
      this.prepareSprinkleStroke();
    }
  }

  public endStroke(): void {
    this.painting = false;
    this.lastBrushPoint = null;
    this.lastSprinklePoint = null;
    this.strokeCurrentLength = 0;
    const finishedStroke = this.activeStroke;
    this.activeStroke = null;

    if (this.brushStrokeGroup && this.brushStrokeMesh && this.brushStrokeIndex > 0) {
      this.paintService.registerDecorationAddition(this.brushStrokeGroup);
      this.paintEntries.push(this.brushStrokeGroup);
      if (finishedStroke?.mode === 'brush' && finishedStroke.points.length > 0) {
        this.brushStrokes.push(finishedStroke);
        this.brushStrokeGroup.userData['strokeId'] = finishedStroke.id;
      }
    }
    this.brushStrokeGroup = null;
    this.brushStrokeMesh = null;
    this.brushStrokeIndex = 0;

    if (this.sprinkleStrokeGroup && this.sprinkleStrokeMesh && this.sprinkleStrokeIndex > 0) {
      this.paintService.registerDecorationAddition(this.sprinkleStrokeGroup);
      this.sprinkleEntries.push(this.sprinkleStrokeGroup);
      if (finishedStroke?.mode === 'sprinkles' && finishedStroke.points.length > 0) {
        this.sprinkleStrokes.push(finishedStroke);
        this.sprinkleStrokeGroup.userData['strokeId'] = finishedStroke.id;
      }
    }
    this.sprinkleStrokeGroup = null;
    this.sprinkleStrokeMesh = null;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = 0;
    this.sprinkleStrokeShape = null;
  }

  public exportPaintingPreset(): SurfacePaintingPreset {
    const brushStrokes = this.brushStrokes.filter((stroke) => {
      const group = this.paintEntries.find((g) => g.userData?.['strokeId'] === stroke.id);
      return !group?.userData?.['removedByUndo'];
    });

    const sprinkleStrokes = this.sprinkleStrokes.filter((stroke) => {
      const group = this.sprinkleEntries.find((g) => g.userData?.['strokeId'] === stroke.id);
      return !group?.userData?.['removedByUndo'];
    });

    return {
      brushColor: this.brushColor,
      brushStrokes,
      sprinkleStrokes,
    };
  }

  public restorePaintingPreset(preset: SurfacePaintingPreset | undefined | null): void {
    if (!preset) {
      return;
    }

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
      const numericId = Number(stroke.id.split('-')[1]);
      if (!Number.isNaN(numericId)) {
        this.nextStrokeId = Math.max(this.nextStrokeId, numericId + 1);
      }
    }
    stroke.points.forEach((p) => {
      this.activeStroke?.points.push({ ...p });
      const hit = { point: new THREE.Vector3(p.x, p.y, p.z) } as THREE.Intersection;
      this.paintBrush(hit, scene);
    });
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

    this.startStroke();
    if (this.activeStroke) {
      this.activeStroke.id = stroke.id;
      const numericId = Number(stroke.id.split('-')[1]);
      if (!Number.isNaN(numericId)) {
        this.nextStrokeId = Math.max(this.nextStrokeId, numericId + 1);
      }
    }
    stroke.points.forEach((p) => {
      this.activeStroke?.points.push({ ...p });
      const hit = { point: new THREE.Vector3(p.x, p.y, p.z) } as THREE.Intersection;
      this.placeSprinkles(hit, scene);
    });
    this.endStroke();
  }

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
    this.clearSprinkles();
    this.clearBrushStrokes();
    this.activeStroke = null;
    this.nextStrokeId = 1;
  }

  public clearSprinkles(): void {
    this.lastSprinklePoint = null;
    this.activeStroke = null;
    this.sprinkleStrokes = [];
    this.disposeSprinkles();
  }

  public setSprinkleShape(shape: SprinkleShape): void {
    if (this.sprinkleShape === shape) return;
    this.finalizeCurrentSprinkleStroke();
    this.sprinkleShape = shape;
    this.prepareSprinkleStroke();
  }

  public setSprinkleColorMode(useRandom: boolean): void {
    this.sprinkleUseRandomColors = useRandom;
    this.refreshSprinkleMaterialColor();
  }

  public setSprinkleColor(color: string): void {
    this.sprinkleUseRandomColors = false;
    this.sprinkleColor = this.sanitizeHexColor(color, this.sprinkleColor);
    this.refreshSprinkleMaterialColor();
  }

  public clearBrushStrokes(): void {
    this.disposePaintStrokes();
    this.brushStrokes = [];
    this.activeStroke = null;
  }

  public async handlePointer(hit: THREE.Intersection, scene: THREE.Scene): Promise<void> {
    if (!this.isBrowser || !this.painting) return;

    if (!hit.point) return;

    if (this.activeStroke) {
      if (this.activeStroke.mode === 'brush') {
        this.activeStroke.points.push({
          x: hit.point.x,
          y: hit.point.y,
          z: hit.point.z,
        });
      } else if (this.activeStroke.mode === 'sprinkles') {
        this.activeStroke.points.push({
          x: hit.point.x,
          y: hit.point.y,
          z: hit.point.z,
        });
      }
    }

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

    // jeśli już spatchowane – tylko odśwież
    if ((typed as any).__surfacePaintApplied) {
      this.paintedMaterials.push(typed);
      typed.needsUpdate = true;
      return;
    }

    const originalCompile = typed.onBeforeCompile?.bind(typed);
    const uniforms = this.shaderUniforms;

    typed.onBeforeCompile = (shader: any, renderer: THREE.WebGLRenderer) => {
      // wywołujemy poprzednią wersję z dwoma argumentami
      originalCompile?.(shader, renderer);

      shader.defines = shader.defines ?? {};
      shader.defines['USE_UV'] = '';

      // --- vertex: dodajemy własne UV do malowania ---
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vPaintingUv;',
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n  vPaintingUv = uv;',
      );

      // --- uniforms gradientu ---
      shader.uniforms['gradientMap'] = uniforms.gradientMap;
      shader.uniforms['useGradient'] = uniforms.useGradient;

      // --- fragment: deklaracje + miksowanie koloru ---
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

  // --- LOGIKA PĘDZLA ---

  private paintBrush(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!hit.point) return;

    if (!this.brushStrokeGroup || !this.brushStrokeMesh) {
      this.createBrushStroke(scene);
    }
    if (!this.brushStrokeMesh || !this.brushStrokeGroup) return;

    const currentPoint = hit.point.clone();
    const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);

    if (hit.object) {
      hit.object.updateMatrixWorld();
      normal.transformDirection(hit.object.matrixWorld).normalize();
    }

    const rawProgress = this.strokeCurrentLength / this.RAMP_UP_DISTANCE;
    const pressure = Math.min(1.0, Math.max(0.0, rawProgress));
    // Easing dla gładkości
    const easedPressure = pressure * pressure * (3 - 2 * pressure);

    // --- POPRAWKA 1: GĘSTOŚĆ (SPACING) ---
    // Start (0.15): BARDZO GĘSTO. Kropki nachodzą na siebie, tworząc litą masę (volume).
    // Koniec (0.1): Nadal gęsto, żeby linia była ciągła.
    // Wcześniej miałeś tu 0.8, dlatego robiły się oddzielne kropy.
    const startSpacing = this.computeBrushWorldSpacing() * 0.15;
    const endSpacing = this.computeBrushWorldSpacing() * 0.1;

    const dynamicSpacing = THREE.MathUtils.lerp(startSpacing, endSpacing, easedPressure);

    if (this.lastBrushPoint) {
      const segmentDir = currentPoint.clone().sub(this.lastBrushPoint);
      const distance = segmentDir.length();

      if (distance >= dynamicSpacing) {
        this.strokeCurrentLength += distance;

        const steps = Math.max(1, Math.floor(distance / dynamicSpacing));

        let strokeDir = segmentDir.clone().normalize();
        if (strokeDir.lengthSq() < 0.01 && this.lastStrokeDir) {
          strokeDir = this.lastStrokeDir;
        }

        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const point = this.lastBrushPoint.clone().lerp(currentPoint, t);

          const stepTotalLen = this.strokeCurrentLength - distance * (1-t);
          const stepProgress = stepTotalLen / this.RAMP_UP_DISTANCE;
          const stepPressure = Math.min(1.0, Math.max(0.0, stepProgress));

          this.addBrushBlob(point, normal, strokeDir, stepPressure);
        }
        this.lastStrokeDir = strokeDir;
      }
    } else {
      let defaultDir = new THREE.Vector3(0,1,0);
      defaultDir.projectOnPlane(normal).normalize();
      this.addBrushBlob(currentPoint, normal, defaultDir, 0.0);
      this.lastStrokeDir = defaultDir;
    }

    this.lastBrushPoint = currentPoint;
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

  // --- TEKSTURA PĘDZLA ---
  private getBrushAlphaMask(): THREE.CanvasTexture {
    if (this.brushTexture) return this.brushTexture;

    const w = 128;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, w, h);

    // --- POPRAWKA 2: WYPEŁNIENIE ŚRODKA ---
    // Najpierw rysujemy miękki środek, żeby dół pociągnięcia (gdzie kropki są gęsto) był pełny.
    const coreGradient = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w * 0.35);
    coreGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
    coreGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = coreGradient;
    ctx.fillRect(0,0,w,h);

    // Potem dodajemy Twoje "bristles" (włosie) dla efektu dry brush na brzegach i na górze
    const bristles = 150;
    for(let i=0; i<bristles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (w * 0.45);
      const x = w/2 + Math.cos(angle) * r;
      const y = h/2 + Math.sin(angle) * r;
      const size = 1 + Math.random() * 2;

      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + Math.random() * 0.6})`;
      ctx.fill();
    }

    // Wygładzanie krawędzi
    ctx.globalCompositeOperation = 'destination-in';
    const gradient = ctx.createRadialGradient(w/2, h/2, w*0.3, w/2, h/2, w*0.5);
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
    const maxInstances = 20000;
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
      alphaTest: 0.4, // Twój parametr, który daje ostre krawędzie
      depthWrite: false,
      depthTest: true,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(2.5, 2.5), // Podbiłem normal mapę dla lepszego volume
      roughness: 0.6,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'Malowanie pędzlem';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    const group = new THREE.Group();
    group.name = 'Malowanie pędzlem';
    group.userData['displayName'] = 'Malowanie pędzlem';
    group.userData['isPaintStroke'] = true;
    group.add(mesh);
    anchor.add(group);

    this.brushStrokeGroup = group;
    this.brushStrokeMesh = mesh;
    this.brushStrokeIndex = 0;
    this.brushStrokeCapacity = maxInstances;
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
    if (anchorGroup) anchorGroup.updateMatrixWorld(true);
    const anchorInverse = anchorGroup
      ? this.tempMatrixInverse.copy(anchorGroup.matrixWorld).invert()
      : null;

    const radius = this.computeBrushRadius();

    const worldNormal = normal.clone();
    const worldDirection = direction.clone();
    const zAxis = anchorInverse
      ? worldNormal.transformDirection(anchorInverse).normalize()
      : worldNormal;
    const yAxis = (anchorInverse
      ? worldDirection.transformDirection(anchorInverse)
      : worldDirection
    )
      .projectOnPlane(zAxis)
      .normalize();
    yAxis.negate();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();

    const matrix = this.tempMatrix.identity().makeBasis(xAxis, yAxis, zAxis);

    // Stały, minimalny offset (bez lewitowania)
    const baseOffset = 0.0015;
    const sortingOffset = (this.brushStrokeIndex * 0.000002);
    const positionWorld = point.clone().add(worldNormal.clone().multiplyScalar(baseOffset + sortingOffset));
    const positionLocal = anchorGroup
      ? anchorGroup.worldToLocal(positionWorld)
      : positionWorld;
    matrix.setPosition(positionLocal);

    // --- POPRAWKA 3: KSZTAŁT ---

    // SZEROKOŚĆ (Width):
    // Start (Pressure 0): 1.1 -> Szeroko (to daje volume na dole).
    // Koniec (Pressure 1): 0.7 -> Węższy ślad (rozmazanie).
    // (W Twoim kodzie było odwrotnie: 0.3 -> 1.0, dlatego góra była gruba, a dół chudy)
    const widthScale = THREE.MathUtils.lerp(1.1, 0.7, pressure);

    // DŁUGOŚĆ (Length / ScaleY):
    // Start: 1.2 -> W miarę okrągły/krótki kleks.
    // Koniec: 3.5 -> Bardzo długie rozciągnięcie (tworzy efekt smug pędzla na górze).
    const lengthScale = THREE.MathUtils.lerp(1.2, 3.5, pressure);

    const scaleBase = radius * 2.5;
    const scaleX = scaleBase * widthScale;
    const scaleY = scaleBase * lengthScale;

    // Jitter (Losowość obrotu):
    // Start: Mały (0.1) -> żeby dół był stabilną, ładną kropą.
    // Koniec: Większy (0.3) -> żeby góra była "brudna" i artystyczna.
    const jitterAmount = THREE.MathUtils.lerp(0.1, 0.3, pressure);
    const jitter = (Math.random() - 0.5) * jitterAmount;
    const rotMatrix = new THREE.Matrix4().makeRotationZ(jitter);
    matrix.multiply(rotMatrix);

    const scaleVec = new THREE.Vector3(scaleX, scaleY, 1);
    matrix.scale(scaleVec);

    this.brushStrokeMesh.setMatrixAt(this.brushStrokeIndex, matrix);
    this.brushStrokeIndex++;
    this.brushStrokeMesh.count = Math.max(this.brushStrokeMesh.count, this.brushStrokeIndex);
    this.brushStrokeMesh.instanceMatrix.needsUpdate = true;
  }

  private computeBrushRadius(): number {
    const min = 0.04;
    const max = 0.12;
    const normalized = THREE.MathUtils.clamp(this.brushSize, 0, 150) / 150;
    return THREE.MathUtils.lerp(min, max, normalized);
  }

  private computeBrushWorldSpacing(): number {
    return this.computeBrushRadius() * 0.5;
  }
  // --- SPRINKLES (BEZ ZMIAN) ---
  private placeSprinkles(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!hit.point) return;
    if (!this.sprinkleStrokeMesh || !this.sprinkleStrokeGroup || this.sprinkleStrokeShape !== this.sprinkleShape) {
      this.prepareSprinkleStroke(scene);
    }
    if (!this.sprinkleStrokeMesh || !this.sprinkleStrokeGroup) return;
    this.refreshSprinkleMaterialColor();

    const anchorGroup = this.paintAnchor;
    if (anchorGroup) anchorGroup.updateMatrixWorld(true);
    const anchorInverse = anchorGroup
      ? this.tempMatrixInverse.copy(anchorGroup.matrixWorld).invert()
      : null;

    const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
    if (hit.object) {
      hit.object.updateMatrixWorld();
      normal.transformDirection(hit.object.matrixWorld).normalize();
    }
    const tangent = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
    if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const anchorPoint = hit.point.clone();
    const clusterSpacing = 0.12;
    const isFirstCluster = !this.lastSprinklePoint;
    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchorPoint) < clusterSpacing) return;
    if (!isFirstCluster && Math.random() < 0.4) return;
    this.lastSprinklePoint = anchorPoint.clone();

    const densityFactor = THREE.MathUtils.clamp(this.sprinkleDensity / 20, 0, 1);
    const count = Math.max(2, Math.round(THREE.MathUtils.lerp(3, 7, densityFactor)));
    const scatterRadius = THREE.MathUtils.lerp(0.08, 0.16, densityFactor);

    for (let i = 0; i < count; i++) {
      if (this.sprinkleStrokeIndex >= this.sprinkleStrokeCapacity) break;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * scatterRadius;
      const offset = tangent.clone().multiplyScalar(Math.cos(angle) * radius).add(
        bitangent.clone().multiplyScalar(Math.sin(angle) * radius),
      );
      const position = anchorPoint.clone().add(offset).add(normal.clone().multiplyScalar(0.006));
      const scale = THREE.MathUtils.lerp(this.sprinkleMinScale, this.sprinkleMaxScale + 0.4, Math.random());

      const baseQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const twist = new THREE.Quaternion().setFromAxisAngle(normal, Math.random() * Math.PI * 2);
      const tiltAxis = Math.random() < 0.5 ? tangent : bitangent;
      const tiltAmount = THREE.MathUtils.degToRad(20 + Math.random() * 50);
      const tilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, tiltAmount);
      baseQuat.multiply(tilt).multiply(twist);

      const matrixWorld = new THREE.Matrix4().compose(position, baseQuat, new THREE.Vector3(scale, scale, scale));
      const matrix = anchorInverse ? matrixWorld.premultiply(anchorInverse) : matrixWorld;
      this.sprinkleStrokeMesh.setMatrixAt(this.sprinkleStrokeIndex, matrix);
      const colorValue = this.sprinkleUseRandomColors
        ? SPRINKLE_PALETTE[Math.floor(Math.random() * SPRINKLE_PALETTE.length)]
        : this.sprinkleColor;
      this.tempColor.set(colorValue).convertSRGBToLinear();
      this.sprinkleStrokeMesh.setColorAt(this.sprinkleStrokeIndex, this.tempColor);
      this.sprinkleStrokeIndex++;
    }
    this.sprinkleStrokeMesh.count = Math.max(this.sprinkleStrokeMesh.count, this.sprinkleStrokeIndex);
    this.sprinkleStrokeMesh.instanceMatrix.needsUpdate = true;
    this.sprinkleStrokeMesh.instanceColor!.needsUpdate = true;
  }

  private ensureSprinkleResources(): void {
    if (!this.sprinkleGeometryCache) {
      this.sprinkleGeometryCache = {
        stick: new THREE.CapsuleGeometry(0.005, 0.024, 4, 10),
        ball: new THREE.SphereGeometry(0.008, 14, 12),
        star: this.createStarGeometry(),
      };
    }
    if (!this.sprinkleMaterial) {
      this.sprinkleMaterial = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 0.18,
        vertexColors: true,
        color: '#ffffff',
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.1,
        toneMapped: false,
        flatShading: true,
        envMapIntensity: 0.4,
      });
      this.refreshSprinkleMaterialColor();
    }
  }

  private refreshSprinkleMaterialColor(): void {
    if (!this.sprinkleMaterial) return;
    const emissiveHex = this.sprinkleUseRandomColors ? '#ffffff' : this.sprinkleColor;
    this.tempColor.set(emissiveHex).convertSRGBToLinear();
    this.sprinkleMaterial.emissive.copy(this.tempColor).multiplyScalar(0.35);
    this.sprinkleMaterial.emissiveIntensity = 1.0;
    this.sprinkleMaterial.color.set('#ffffff');
    this.sprinkleMaterial.needsUpdate = true;
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
    if (this.sprinkleStrokeGroup) this.sprinkleStrokeGroup.parent?.remove(this.sprinkleStrokeGroup);

    const capacity = 5000;
    const geometry = this.sprinkleGeometryCache![this.sprinkleShape];
    const material = this.sprinkleMaterial!;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.name = 'Posypka';
    mesh.frustumCulled = false;

    const group = new THREE.Group();
    group.name = 'Posypka';
    group.userData['displayName'] = 'Posypka';
    group.userData['isPaintDecoration'] = true;
    group.userData['isPaintStroke'] = true;
    group.add(mesh);
    anchor.add(group);

    this.sprinkleStrokeGroup = group;
    this.sprinkleStrokeMesh = mesh;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = capacity;
    this.sprinkleStrokeShape = this.sprinkleShape;
  }

  private finalizeCurrentSprinkleStroke(): void {
    if (this.sprinkleStrokeGroup && this.sprinkleStrokeMesh) {
      if (this.sprinkleStrokeIndex > 0) {
        this.paintService.registerDecorationAddition(this.sprinkleStrokeGroup);
        this.sprinkleEntries.push(this.sprinkleStrokeGroup);
      } else {
        this.sprinkleStrokeGroup.parent?.remove(this.sprinkleStrokeGroup);
      }
    }
    this.sprinkleStrokeGroup = null;
    this.sprinkleStrokeMesh = null;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = 0;
    this.sprinkleStrokeShape = null;
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

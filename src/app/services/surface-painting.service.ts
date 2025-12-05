import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';

export type PaintingMode = 'brush' | 'gradient' | 'sprinkles';
export type GradientDirection = 'vertical' | 'horizontal' | 'diag1' | 'diag2' | 'radial';
export type BrushKind = 'soft' | 'cream';
export type SprinkleShape = 'stick' | 'ball';

const BRUSH_TEXTURES: Record<BrushKind, string> = {
  soft: '/assets/brush/brush_1.png',
  cream: '/assets/brush/brush_2.png',
};

const SPRINKLE_PALETTE = ['#ff6b81', '#ffd66b', '#6bffb0', '#6bb8ff', '#ffffff'];

const SPRINKLE_MAX_COUNT = 2000;

interface SprinklesState {
  mesh: THREE.InstancedMesh | null;
  count: number;
}

interface PaintingShaderUniforms {
  paintMap: { value: THREE.Texture };
  gradientMap: { value: THREE.Texture };
  useGradient: { value: boolean };
}

@Injectable({ providedIn: 'root' })
export class SurfacePaintingService {
  public enabled = false;
  public mode: PaintingMode = 'brush';
  public brushKind: BrushKind = 'soft';
  public brushSize = 90;
  public brushOpacity = 0.8;
  public brushColor = '#ff6b6b';
  public gradientEnabled = false;
  public gradientDirection: GradientDirection = 'vertical';
  public gradientStart = '#ffffff';
  public gradientEnd = '#ffe3f3';
  public sprinkleDensity = 6;
  public sprinkleShape: SprinkleShape = 'stick';
  public sprinkleMinScale = 0.7;
  public sprinkleMaxScale = 1.2;

  private readonly isBrowser: boolean;
  private paintCanvas?: HTMLCanvasElement;
  private gradientCanvas?: HTMLCanvasElement;
  private paintContext?: CanvasRenderingContext2D | null;
  private gradientContext?: CanvasRenderingContext2D | null;
  private paintTexture?: THREE.CanvasTexture;
  private gradientTexture?: THREE.CanvasTexture;
  private brushImages = new Map<BrushKind, HTMLImageElement>();
  private lastUv: THREE.Vector2 | null = null;
  private painting = false;
  private sprinklesState: SprinklesState = { mesh: null, count: 0 };
  private shaderUniforms: PaintingShaderUniforms | null = null;
  private cakeMaterial: THREE.MeshStandardMaterial | null = null;
  private cakeGroup: THREE.Group | null = null;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.ensureCanvases();
      this.loadBrushes();
    }
  }

  public attachCake(cake: THREE.Group | null): void {
    if (this.sprinklesState.mesh) {
      this.sprinklesState.mesh.parent?.remove(this.sprinklesState.mesh);
      this.sprinklesState.mesh.geometry.dispose();
      if (Array.isArray(this.sprinklesState.mesh.material)) {
        this.sprinklesState.mesh.material.forEach((m) => m.dispose());
      } else {
        this.sprinklesState.mesh.material.dispose();
      }
      this.sprinklesState = { mesh: null, count: 0 };
    }
    this.cakeGroup = cake;
    const targetMaterial = this.extractCakeMaterial(cake);
    if (!targetMaterial) {
      return;
    }
    this.cakeMaterial = targetMaterial;
    this.setupMaterialShader(targetMaterial);
    this.updateGradientTexture();
    this.clearPaint();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.lastUv = null;
  }

  public isPainting(): boolean {
    return this.painting;
  }

  public startStroke(): void {
    this.painting = true;
    this.lastUv = null;
  }

  public endStroke(): void {
    this.painting = false;
    this.lastUv = null;
  }

  public applyGradientSettings(): void {
    this.gradientEnabled = true;
    this.updateGradientTexture();
    this.flagMaterialUpdate();
  }

  public disableGradient(): void {
    this.gradientEnabled = false;
    this.flagMaterialUpdate();
  }

  public clearPaint(): void {
    if (!this.paintContext || !this.paintCanvas) {
      return;
    }
    this.paintContext.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
    if (this.paintTexture) {
      this.paintTexture.needsUpdate = true;
    }
    this.sprinklesState.count = 0;
    if (this.sprinklesState.mesh) {
      this.sprinklesState.mesh.parent?.remove(this.sprinklesState.mesh);
      this.sprinklesState.mesh.geometry.dispose();
      if (Array.isArray(this.sprinklesState.mesh.material)) {
        this.sprinklesState.mesh.material.forEach((m) => m.dispose());
      } else {
        this.sprinklesState.mesh.material.dispose();
      }
      this.sprinklesState = { mesh: null, count: 0 };
    }
  }

  public async handlePointer(hit: THREE.Intersection, scene: THREE.Scene): Promise<void> {
    if (!this.isBrowser || !this.painting || !this.paintTexture) {
      return;
    }

    if (this.mode === 'gradient') {
      return;
    }

    if (this.mode === 'sprinkles') {
      this.placeSprinkles(hit, scene);
      return;
    }

    if (!hit.uv || !this.paintCanvas || !this.paintContext) {
      return;
    }

    const currentUv = hit.uv.clone();
    const brushImage = this.brushImages.get(this.brushKind);
    if (!brushImage || !brushImage.complete) {
      return;
    }

    const stamps = this.interpolateStamps(this.lastUv, currentUv);
    stamps.forEach((uv) => this.stampBrush(uv, brushImage));
    this.paintTexture.needsUpdate = true;
    this.lastUv = currentUv;
  }

  private ensureCanvases(): void {
    if (this.paintCanvas && this.gradientCanvas) {
      return;
    }
    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = 1024;
    this.paintCanvas.height = 1024;
    this.paintContext = this.paintCanvas.getContext('2d');
    this.paintTexture = new THREE.CanvasTexture(this.paintCanvas);
    this.paintTexture.colorSpace = THREE.SRGBColorSpace;

    this.gradientCanvas = document.createElement('canvas');
    this.gradientCanvas.width = 1024;
    this.gradientCanvas.height = 1024;
    this.gradientContext = this.gradientCanvas.getContext('2d');
    this.gradientTexture = new THREE.CanvasTexture(this.gradientCanvas);
    this.gradientTexture.colorSpace = THREE.SRGBColorSpace;
  }

  private loadBrushes(): void {
    Object.entries(BRUSH_TEXTURES).forEach(([key, path]) => {
      const image = new Image();
      image.src = path;
      this.brushImages.set(key as BrushKind, image);
    });
  }

  private extractCakeMaterial(group: THREE.Group | null): THREE.MeshStandardMaterial | null {
    if (!group) {
      return null;
    }
    const targetMesh = group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh | undefined;
    if (!targetMesh) {
      return null;
    }
    const material = targetMesh.material;
    if (Array.isArray(material)) {
      return material.find((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial) ?? null;
    }
    return material instanceof THREE.MeshStandardMaterial ? material : null;
  }

  private setupMaterialShader(material: THREE.MeshStandardMaterial): void {
    if (!this.paintTexture || !this.gradientTexture) {
      return;
    }
    const uniforms: PaintingShaderUniforms = {
      paintMap: { value: this.paintTexture },
      gradientMap: { value: this.gradientTexture },
      useGradient: { value: this.gradientEnabled },
    };
    material.onBeforeCompile = (shader) => {
      shader.uniforms['paintMap'] = uniforms.paintMap;
      shader.uniforms['gradientMap'] = uniforms.gradientMap;
      shader.uniforms['useGradient'] = uniforms.useGradient;
      shader.fragmentShader = `uniform sampler2D paintMap;\nuniform sampler2D gradientMap;\nuniform bool useGradient;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec4 baseLayerColor = vec4(diffuseColor.rgb, 1.0);\n      #ifdef USE_MAP\n        vec4 sampled = texture2D(map, vMapUv);\n        sampled.rgb = SRGBToLinear(sampled.rgb);\n        baseLayerColor.rgb *= sampled.rgb;\n      #endif\n      if(useGradient){\n        vec4 gradSample = texture2D(gradientMap, vMapUv);\n        gradSample.rgb = SRGBToLinear(gradSample.rgb);\n        baseLayerColor.rgb = mix(baseLayerColor.rgb, gradSample.rgb, gradSample.a);\n      }\n      vec4 paintSample = texture2D(paintMap, vMapUv);\n      paintSample.rgb = SRGBToLinear(paintSample.rgb);\n      baseLayerColor.rgb = mix(baseLayerColor.rgb, paintSample.rgb, paintSample.a);\n      diffuseColor = vec4(baseLayerColor.rgb, diffuseColor.a);`,
      );
    };
    material.needsUpdate = true;
    this.shaderUniforms = uniforms;
  }

  private updateGradientTexture(): void {
    if (!this.gradientContext || !this.gradientCanvas) {
      return;
    }
    const ctx = this.gradientContext;
    const { width, height } = this.gradientCanvas;
    ctx.clearRect(0, 0, width, height);
    if (!this.gradientEnabled) {
      if (this.gradientTexture) {
        this.gradientTexture.needsUpdate = true;
      }
      return;
    }

    let gradient: CanvasGradient;
    switch (this.gradientDirection) {
      case 'horizontal':
        gradient = ctx.createLinearGradient(0, height / 2, width, height / 2);
        break;
      case 'diag1':
        gradient = ctx.createLinearGradient(0, 0, width, height);
        break;
      case 'diag2':
        gradient = ctx.createLinearGradient(width, 0, 0, height);
        break;
      case 'radial':
        gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2);
        break;
      case 'vertical':
      default:
        gradient = ctx.createLinearGradient(width / 2, 0, width / 2, height);
        break;
    }
    gradient.addColorStop(0, this.gradientStart);
    gradient.addColorStop(1, this.gradientEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (this.gradientTexture) {
      this.gradientTexture.needsUpdate = true;
    }
  }

  private stampBrush(uv: THREE.Vector2, brush: HTMLImageElement): void {
    if (!this.paintCanvas || !this.paintContext) {
      return;
    }
    const sizePx = (this.brushSize / 100) * this.paintCanvas.width;
    const x = uv.x * this.paintCanvas.width - sizePx / 2;
    const y = (1 - uv.y) * this.paintCanvas.height - sizePx / 2;
    this.paintContext.save();
    this.paintContext.globalAlpha = this.brushOpacity;
    this.paintContext.fillStyle = this.brushColor;
    this.paintContext.globalCompositeOperation = 'source-over';
    this.paintContext.drawImage(brush, x, y, sizePx, sizePx);
    if (this.brushOpacity < 1) {
      this.paintContext.globalCompositeOperation = 'source-in';
      this.paintContext.fillRect(x, y, sizePx, sizePx);
    } else {
      this.paintContext.globalCompositeOperation = 'source-in';
      this.paintContext.fillRect(x, y, sizePx, sizePx);
    }
    this.paintContext.restore();
  }

  private interpolateStamps(prev: THREE.Vector2 | null, current: THREE.Vector2): THREE.Vector2[] {
    if (!prev) {
      return [current];
    }
    const distance = prev.distanceTo(current);
    const step = 0.01 * (this.brushSize / 50);
    if (distance < step) {
      return [current];
    }
    const count = Math.floor(distance / step);
    const result: THREE.Vector2[] = [];
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      result.push(prev.clone().lerp(current, t));
    }
    result.push(current);
    return result;
  }

  private placeSprinkles(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!this.sprinklesState.mesh) {
      this.createSprinklesMesh(scene);
    }
    const mesh = this.sprinklesState.mesh;
    if (!mesh || this.sprinklesState.count >= SPRINKLE_MAX_COUNT) {
      return;
    }

    const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
    if (hit.object) {
      hit.object.updateMatrixWorld();
      normal.transformDirection(hit.object.matrixWorld).normalize();
    }
    const tangent = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
    if (tangent.lengthSq() < 0.0001) {
      tangent.set(1, 0, 0);
    }
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const densityCount = Math.max(1, Math.round(this.sprinkleDensity));
    for (let i = 0; i < densityCount && this.sprinklesState.count < SPRINKLE_MAX_COUNT; i++) {
      const uvJitter = (Math.random() - 0.5) * 0.01;
      const offset = tangent.clone().multiplyScalar(uvJitter * 2).add(bitangent.clone().multiplyScalar(uvJitter * 2));
      const position = hit.point.clone().add(offset).add(normal.clone().multiplyScalar(0.003));
      const scale = THREE.MathUtils.lerp(this.sprinkleMinScale, this.sprinkleMaxScale, Math.random());
      const shapeMatrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const randomTwist = new THREE.Quaternion().setFromAxisAngle(normal, Math.random() * Math.PI * 2);
      quat.multiply(randomTwist);
      shapeMatrix.compose(position, quat, new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(this.sprinklesState.count, shapeMatrix);
      const color = new THREE.Color(SPRINKLE_PALETTE[Math.floor(Math.random() * SPRINKLE_PALETTE.length)]);
      mesh.setColorAt(this.sprinklesState.count, color);
      this.sprinklesState.count++;
    }
    mesh.count = this.sprinklesState.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }

  private createSprinklesMesh(scene: THREE.Scene): void {
    const geometry = this.sprinkleShape === 'ball'
      ? new THREE.SphereGeometry(0.005, 12, 12)
      : new THREE.CapsuleGeometry(0.004, 0.018, 4, 8);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.05, roughness: 0.3 });
    const mesh = new THREE.InstancedMesh(geometry, material, SPRINKLE_MAX_COUNT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'Sprinkles';
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPRINKLE_MAX_COUNT * 3), 3);
    this.sprinklesState = { mesh, count: 0 };
    scene.add(mesh);
  }

  private flagMaterialUpdate(): void {
    if (this.shaderUniforms) {
      this.shaderUniforms.useGradient.value = this.gradientEnabled;
    }
    if (this.cakeMaterial) {
      this.cakeMaterial.needsUpdate = true;
    }
  }
}

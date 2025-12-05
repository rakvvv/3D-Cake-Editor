import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';

export type PaintingMode = 'brush' | 'gradient' | 'sprinkles';
export type GradientDirection = 'vertical' | 'horizontal' | 'diag1' | 'diag2' | 'radial';
export type SprinkleShape = 'stick' | 'ball';

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
  public brushSize = 50;
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
  private brushMaskCanvas?: HTMLCanvasElement;
  private brushMaskContext?: CanvasRenderingContext2D | null;
  private lastUv: THREE.Vector2 | null = null;
  private painting = false;
  private sprinklesState: SprinklesState = { mesh: null, count: 0 };
  private nextSprinkleIndex = 0;
  private shaderUniforms: PaintingShaderUniforms | null = null;
  private cakeMaterial: THREE.MeshStandardMaterial | null = null;
  private cakeGroup: THREE.Group | null = null;
  private lastSprinklePoint: THREE.Vector3 | null = null;
  private gradientAnchorStart: THREE.Vector2 | null = null;
  private gradientAnchorEnd: THREE.Vector2 | null = null;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.ensureCanvases();
      this.ensureBrushMask();
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
    this.lastSprinklePoint = null;
    if (this.mode === 'gradient') {
      this.gradientAnchorStart = null;
      this.gradientAnchorEnd = null;
    }
  }

  public endStroke(): void {
    this.painting = false;
    this.lastUv = null;
    this.lastSprinklePoint = null;
  }

  public applyGradientSettings(): void {
    this.gradientEnabled = true;
    this.gradientAnchorStart = null;
    this.gradientAnchorEnd = null;
    this.updateGradientTexture();
    this.flagMaterialUpdate();
  }

  public disableGradient(): void {
    this.gradientEnabled = false;
    this.gradientAnchorStart = null;
    this.gradientAnchorEnd = null;
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
    this.nextSprinkleIndex = 0;
    this.lastSprinklePoint = null;
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
      this.applyGradientFromHit(hit);
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

    const stamps = this.interpolateStamps(this.lastUv, currentUv);
    stamps.forEach((uv) => this.stampBrush(uv));
    this.paintTexture.needsUpdate = true;
    this.lastUv = currentUv;
  }

  private applyGradientFromHit(hit: THREE.Intersection): void {
    if (!hit.uv) {
      return;
    }

    const uv = hit.uv.clone();
    if (!this.gradientAnchorStart) {
      this.gradientAnchorStart = uv.clone();
    }
    this.gradientAnchorEnd = uv;

    // Avoid degenerate gradients by nudging the end slightly when identical
    if (this.gradientAnchorStart.distanceTo(this.gradientAnchorEnd) < 0.001) {
      this.gradientAnchorEnd = this.gradientAnchorEnd.clone().addScalar(0.01).clamp(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1));
    }

    this.gradientEnabled = true;
    this.updateGradientTexture();
    this.flagMaterialUpdate();
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

  private ensureBrushMask(): void {
    if (this.brushMaskCanvas) {
      return;
    }
    this.brushMaskCanvas = document.createElement('canvas');
    this.brushMaskCanvas.width = 128;
    this.brushMaskCanvas.height = 128;
    this.brushMaskContext = this.brushMaskCanvas.getContext('2d');
    this.regenerateBrushMask();
  }

  private regenerateBrushMask(): void {
    if (!this.brushMaskContext || !this.brushMaskCanvas) {
      return;
    }
    const ctx = this.brushMaskContext;
    const { width, height } = this.brushMaskCanvas;
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
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
      shader.defines = shader.defines ?? {};
      shader.defines.USE_UV = '';
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vPaintingUv;',
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n  vPaintingUv = (uv);',
      );
      shader.uniforms['paintMap'] = uniforms.paintMap;
      shader.uniforms['gradientMap'] = uniforms.gradientMap;
      shader.uniforms['useGradient'] = uniforms.useGradient;

      shader.fragmentShader =
        `uniform sampler2D paintMap;\n` +
        `uniform sampler2D gradientMap;\n` +
        `uniform bool useGradient;\n` +
        `varying vec2 vPaintingUv;\n` +
        shader.fragmentShader;

      const overlayChunk = `
      vec2 paintingUv = vPaintingUv;
      vec4 paintSample = texture2D(paintMap, paintingUv);
      vec3 paintLinear = pow(paintSample.rgb, vec3(2.2));
      if (useGradient) {
        vec4 gradSample = texture2D(gradientMap, paintingUv);
        vec3 gradLinear = pow(gradSample.rgb, vec3(2.2));
        diffuseColor.rgb = mix(diffuseColor.rgb, gradLinear, gradSample.a);
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, paintLinear, paintSample.a);
    `;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n${overlayChunk}`,
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
    if (this.gradientAnchorStart && this.gradientAnchorEnd) {
      const startPx = new THREE.Vector2(
        this.gradientAnchorStart.x * width,
        (1 - this.gradientAnchorStart.y) * height,
      );
      const endPx = new THREE.Vector2(
        this.gradientAnchorEnd.x * width,
        (1 - this.gradientAnchorEnd.y) * height,
      );
      gradient = ctx.createLinearGradient(startPx.x, startPx.y, endPx.x, endPx.y);
    } else {
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
    }
    gradient.addColorStop(0, this.gradientStart);
    gradient.addColorStop(1, this.gradientEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    this.softWrapGradientSeams();
    if (this.gradientTexture) {
      this.gradientTexture.needsUpdate = true;
    }
  }

  /**
   * Softly blends the left/right and top/bottom edges of the gradient canvas to reduce
   * visible seams on cylindrical UVs when using non-vertical directions.
   */
  private softWrapGradientSeams(): void {
    if (!this.gradientCanvas || !this.gradientContext) {
      return;
    }
    if (this.gradientDirection === 'vertical' || this.gradientDirection === 'radial') {
      return;
    }
    const { width, height } = this.gradientCanvas;
    const ctx = this.gradientContext;
    const bleed = 8;
    const temp = document.createElement('canvas');
    temp.width = bleed;
    temp.height = height;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) {
      return;
    }
    // Copy left edge to the temp canvas then paste onto the right edge
    tempCtx.clearRect(0, 0, bleed, height);
    tempCtx.drawImage(this.gradientCanvas, 0, 0, bleed, height, 0, 0, bleed, height);
    ctx.drawImage(temp, width - bleed, 0);
    // Copy right edge back onto the left to soften the wrap
    tempCtx.clearRect(0, 0, bleed, height);
    tempCtx.drawImage(this.gradientCanvas, width - bleed, 0, bleed, height, 0, 0, bleed, height);
    ctx.drawImage(temp, 0, 0);
  }

  private stampBrush(uv: THREE.Vector2): void {
    if (!this.paintCanvas || !this.paintContext || !this.brushMaskCanvas) {
      return;
    }
    const sizePx = this.computeBrushSizePx();
    const x = uv.x * this.paintCanvas.width - sizePx / 2;
    const y = (1 - uv.y) * this.paintCanvas.height - sizePx / 2;
    this.paintContext.save();
    this.paintContext.globalAlpha = this.brushOpacity;
    this.paintContext.globalCompositeOperation = 'source-over';
    this.paintContext.drawImage(this.brushMaskCanvas, x, y, sizePx, sizePx);
    this.paintContext.globalCompositeOperation = 'source-in';
    this.paintContext.fillStyle = this.brushColor;
    this.paintContext.fillRect(x, y, sizePx, sizePx);
    this.paintContext.restore();
  }

  private interpolateStamps(prev: THREE.Vector2 | null, current: THREE.Vector2): THREE.Vector2[] {
    if (!this.paintCanvas) {
      return [current];
    }
    const spacing = this.computeStampSpacing();
    if (!prev) {
      return [current];
    }
    if (Math.abs(prev.x - current.x) > 0.25 || Math.abs(prev.y - current.y) > 0.25) {
      return [current];
    }
    const distance = prev.distanceTo(current);
    if (distance < spacing) {
      return [current];
    }
    const count = Math.floor(distance / spacing);
    const result: THREE.Vector2[] = [];
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      result.push(prev.clone().lerp(current, t));
    }
    result.push(current);
    return result;
  }

  private computeBrushSizePx(): number {
    if (!this.paintCanvas) {
      return 0;
    }
    const minSize = 10;
    const maxSize = 180;
    const normalized = THREE.MathUtils.clamp(this.brushSize, 0, 100) / 100;
    return THREE.MathUtils.lerp(minSize, maxSize, normalized);
  }

  private computeStampSpacing(): number {
    if (!this.paintCanvas) {
      return 0.01;
    }
    const sizePx = this.computeBrushSizePx();
    const diameter = sizePx;
    const spacingPx = diameter * 0.25;
    return spacingPx / this.paintCanvas.width;
  }

  private placeSprinkles(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!this.sprinklesState.mesh) {
      this.createSprinklesMesh(scene);
    }
    const mesh = this.sprinklesState.mesh;
    if (!mesh) {
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

    const anchor = hit.point.clone();
    const clusterSpacing = 0.05;
    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchor) < clusterSpacing) {
      return;
    }
    if (Math.random() < 0.15) {
      return;
    }
    this.lastSprinklePoint = anchor.clone();

    const densityFactor = THREE.MathUtils.clamp(this.sprinkleDensity / 20, 0, 1);
    const count = Math.max(3, Math.round(THREE.MathUtils.lerp(4, 14, densityFactor)));
    const scatterRadius = THREE.MathUtils.lerp(0.03, 0.09, densityFactor);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * scatterRadius;
      const offset = tangent.clone().multiplyScalar(Math.cos(angle) * radius).add(
        bitangent.clone().multiplyScalar(Math.sin(angle) * radius),
      );
      const position = anchor.clone().add(offset).add(normal.clone().multiplyScalar(0.003));
      const scale = THREE.MathUtils.lerp(this.sprinkleMinScale, this.sprinkleMaxScale, Math.random());
      const shapeMatrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const randomTwist = new THREE.Quaternion().setFromAxisAngle(normal, Math.random() * Math.PI * 2);
      quat.multiply(randomTwist);
      shapeMatrix.compose(position, quat, new THREE.Vector3(scale, scale, scale));
      const targetIndex = this.nextSprinkleIndex % SPRINKLE_MAX_COUNT;
      mesh.setMatrixAt(targetIndex, shapeMatrix);
      const color = new THREE.Color(SPRINKLE_PALETTE[Math.floor(Math.random() * SPRINKLE_PALETTE.length)]);
      mesh.setColorAt(targetIndex, color);
      this.nextSprinkleIndex++;
      this.sprinklesState.count = Math.min(this.sprinklesState.count + 1, SPRINKLE_MAX_COUNT);
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
    this.nextSprinkleIndex = 0;
    this.lastSprinklePoint = null;
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

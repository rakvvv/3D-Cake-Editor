import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';

export type PaintingMode = 'brush' | 'gradient' | 'sprinkles';
export type GradientDirection = 'vertical';
export type SprinkleShape = 'stick' | 'ball';

const SPRINKLE_PALETTE = ['#ff6b81', '#ffd66b', '#6bffb0', '#6bb8ff', '#ffffff'];

const SPRINKLE_MAX_COUNT = 8000;

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
  public gradientFlip = false;
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
  private cakeGroup: THREE.Group | null = null;
  private lastSprinklePoint: THREE.Vector3 | null = null;
  private paintedMaterials: THREE.Material[] = [];

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.ensureCanvases();
      this.ensureBrushMask();
    }
  }

  public attachCake(cake: THREE.Group | null): void {
    this.disposeSprinkles();
    this.cakeGroup = cake;
    this.applyPaintingShader();
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
  }

  public endStroke(): void {
    this.painting = false;
    this.lastUv = null;
    this.lastSprinklePoint = null;
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
    this.nextSprinkleIndex = 0;
    this.lastSprinklePoint = null;
    this.disposeSprinkles();
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

  private applyPaintingShader(): void {
    if (!this.paintTexture || !this.gradientTexture || !this.cakeGroup) {
      return;
    }

    const uniforms: PaintingShaderUniforms = {
      paintMap: { value: this.paintTexture },
      gradientMap: { value: this.gradientTexture },
      useGradient: { value: this.gradientEnabled },
    };

    this.paintedMaterials = [];
    this.cakeGroup.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh || !mesh.material) {
        return;
      }
      const materialArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materialArray.forEach((mat) => {
        if ((mat as { __surfacePaintApplied?: boolean }).__surfacePaintApplied) {
          this.paintedMaterials.push(mat);
          return;
        }
        mat.onBeforeCompile = (shader) => {
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
      vec4 gradSample = texture2D(gradientMap, paintingUv);
      vec3 gradLinear = pow(gradSample.rgb, vec3(2.2));
      vec3 overlayColor = paintLinear;
      float overlayAlpha = paintSample.a;
      if (useGradient) {
        overlayColor = mix(gradLinear, overlayColor, overlayAlpha);
        overlayAlpha = max(overlayAlpha, gradSample.a);
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, overlayColor, overlayAlpha);
    `;

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>\n${overlayChunk}`,
          );
        };
        (mat as { __surfacePaintApplied?: boolean }).__surfacePaintApplied = true;
        mat.needsUpdate = true;
        this.paintedMaterials.push(mat);
      });
    });
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
    const startY = this.gradientFlip ? height : 0;
    const endY = this.gradientFlip ? 0 : height;
    gradient = ctx.createLinearGradient(width / 2, startY, width / 2, endY);
    gradient.addColorStop(0, this.gradientStart);
    gradient.addColorStop(1, this.gradientEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (this.gradientTexture) {
      this.gradientTexture.needsUpdate = true;
    }
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
    const minSize = 12;
    const maxSize = 160;
    const normalized = THREE.MathUtils.clamp(this.brushSize, 0, 100) / 100;
    return THREE.MathUtils.lerp(minSize, maxSize, normalized);
  }

  private computeStampSpacing(): number {
    if (!this.paintCanvas) {
      return 0.01;
    }
    const sizePx = this.computeBrushSizePx();
    const diameter = sizePx;
    const spacingPx = diameter * 0.18;
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
    const clusterSpacing = 0.12;
    const firstCluster = !this.lastSprinklePoint;
    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchor) < clusterSpacing) {
      return;
    }
    if (!firstCluster && Math.random() < 0.4) {
      return;
    }
    this.lastSprinklePoint = anchor.clone();

    const densityFactor = THREE.MathUtils.clamp(this.sprinkleDensity / 20, 0, 1);
    const baseCount = firstCluster
      ? THREE.MathUtils.lerp(5, 12, densityFactor)
      : THREE.MathUtils.lerp(3, 7, densityFactor);
    const count = Math.max(3, Math.round(baseCount));
    const scatterRadius = firstCluster
      ? THREE.MathUtils.lerp(0.08, 0.15, densityFactor)
      : THREE.MathUtils.lerp(0.08, 0.12, densityFactor);

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
    this.paintedMaterials.forEach((mat) => (mat.needsUpdate = true));
  }

  private disposeSprinkles(): void {
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
}

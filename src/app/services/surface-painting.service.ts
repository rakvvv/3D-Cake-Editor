import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { PaintService } from './paint.service';

export type PaintingMode = 'brush' | 'gradient' | 'sprinkles';
export type GradientDirection = 'vertical';
export type SprinkleShape = 'stick' | 'ball';

const SPRINKLE_PALETTE = ['#ff6b81', '#ffd66b', '#6bffb0', '#6bb8ff', '#ffffff'];

interface PaintingShaderUniforms {
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
  private gradientCanvas?: HTMLCanvasElement;
  private gradientContext?: CanvasRenderingContext2D | null;
  private gradientTexture?: THREE.CanvasTexture;
  private painting = false;
  private lastBrushPoint: THREE.Vector3 | null = null;
  private brushStrokeGroup: THREE.Group | null = null;
  private brushStrokeMesh: THREE.InstancedMesh | null = null;
  private brushStrokeIndex = 0;
  private brushStrokeCapacity = 0;
  private cakeGroup: THREE.Group | null = null;
  private lastSprinklePoint: THREE.Vector3 | null = null;
  private paintedMaterials: THREE.Material[] = [];
  private sprinkleGeometryCache: { stick: THREE.BufferGeometry; ball: THREE.BufferGeometry } | null = null;
  private sprinkleMaterial: THREE.MeshStandardMaterial | null = null;
  private sprinkleEntries: THREE.Object3D[] = [];
  private paintEntries: THREE.Object3D[] = [];
  private shaderUniforms?: PaintingShaderUniforms;

  constructor(@Inject(PLATFORM_ID) platformId: object, private readonly paintService: PaintService) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.ensureCanvases();
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
    this.lastBrushPoint = null;
  }

  public isPainting(): boolean {
    return this.painting;
  }

  public startStroke(): void {
    this.painting = true;
    this.lastBrushPoint = null;
    this.lastSprinklePoint = null;
  }

  public endStroke(): void {
    this.painting = false;
    this.lastBrushPoint = null;
    this.lastSprinklePoint = null;

    if (this.brushStrokeGroup && this.brushStrokeMesh && this.brushStrokeIndex > 0) {
      this.paintService.registerDecorationAddition(this.brushStrokeGroup);
      this.paintEntries.push(this.brushStrokeGroup);
    }
    this.brushStrokeGroup = null;
    this.brushStrokeMesh = null;
    this.brushStrokeIndex = 0;
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
    this.lastSprinklePoint = null;
    this.disposeSprinkles();
    this.disposePaintStrokes();
  }

  public async handlePointer(hit: THREE.Intersection, scene: THREE.Scene): Promise<void> {
    if (!this.isBrowser || !this.painting) {
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
    this.paintBrush(hit, scene);
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
    if (this.gradientCanvas) {
      return;
    }

    this.gradientCanvas = document.createElement('canvas');
    this.gradientCanvas.width = 1024;
    this.gradientCanvas.height = 1024;
    this.gradientContext = this.gradientCanvas.getContext('2d');
    this.gradientTexture = new THREE.CanvasTexture(this.gradientCanvas);
    this.gradientTexture.colorSpace = THREE.SRGBColorSpace;
  }

  private applyPaintingShader(): void {
    if (!this.gradientTexture || !this.cakeGroup) {
      return;
    }

    const uniforms: PaintingShaderUniforms = {
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
          shader.uniforms['gradientMap'] = uniforms.gradientMap;
          shader.uniforms['useGradient'] = uniforms.useGradient;

          shader.fragmentShader =
            `uniform sampler2D gradientMap;\n` +
            `uniform bool useGradient;\n` +
            `varying vec2 vPaintingUv;\n` +
            shader.fragmentShader;

          const overlayChunk = `
      vec2 paintingUv = vPaintingUv;
      vec4 gradSample = texture2D(gradientMap, paintingUv);
      vec3 gradLinear = pow(gradSample.rgb, vec3(2.2));
      if (useGradient) {
        diffuseColor.rgb = mix(diffuseColor.rgb, gradLinear, gradSample.a);
      }
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

  private paintBrush(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!hit.point) {
      return;
    }

    if (!this.brushStrokeGroup || !this.brushStrokeMesh) {
      this.createBrushStroke(scene);
    }
    if (!this.brushStrokeMesh || !this.brushStrokeGroup) {
      return;
    }

    const currentPoint = hit.point.clone();
    const normal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
    if (hit.object) {
      hit.object.updateMatrixWorld();
      normal.transformDirection(hit.object.matrixWorld).normalize();
    }

    const spacing = this.computeBrushWorldSpacing();
    if (this.lastBrushPoint) {
      const distance = this.lastBrushPoint.distanceTo(currentPoint);
      if (distance >= spacing) {
        const steps = Math.max(1, Math.floor(distance / spacing));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const point = this.lastBrushPoint.clone().lerp(currentPoint, t);
          this.addBrushBlob(point, normal);
        }
      }
    } else {
      this.addBrushBlob(currentPoint, normal);
    }

    this.lastBrushPoint = currentPoint;
  }

  private createBrushStroke(scene: THREE.Scene): void {
    const maxInstances = 6000;
    const geometry = new THREE.SphereGeometry(0.012, 18, 14);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.brushColor),
      metalness: 0.05,
      roughness: 0.25,
      transparent: true,
      opacity: this.brushOpacity,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'Malowanie pędzlem';
    mesh.count = 0;
    const group = new THREE.Group();
    group.name = 'Malowanie pędzlem';
    group.userData['displayName'] = 'Malowanie pędzlem';
    group.userData['isPaintStroke'] = true;
    group.add(mesh);
    scene.add(group);

    this.brushStrokeGroup = group;
    this.brushStrokeMesh = mesh;
    this.brushStrokeIndex = 0;
    this.brushStrokeCapacity = maxInstances;
  }

  private addBrushBlob(point: THREE.Vector3, normal: THREE.Vector3): void {
    if (!this.brushStrokeMesh) {
      return;
    }
    if (this.brushStrokeIndex >= this.brushStrokeCapacity) {
      return;
    }

    const radius = this.computeBrushRadius();
    const spacingOffset = normal.clone().multiplyScalar(radius * 0.8);
    const position = point.clone().add(spacingOffset);

    const tangent = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
    if (tangent.lengthSq() < 0.0001) {
      tangent.set(1, 0, 0);
    }
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const baseQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const twist = new THREE.Quaternion().setFromAxisAngle(normal, Math.random() * Math.PI * 2);
    const tiltAxis = Math.random() < 0.5 ? tangent : bitangent;
    const tilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, THREE.MathUtils.degToRad(10 + Math.random() * 25));
    baseQuat.multiply(tilt).multiply(twist);

    const scale = new THREE.Vector3(radius, radius * 0.75, radius);
    const matrix = new THREE.Matrix4();
    matrix.compose(position, baseQuat, scale);

    this.brushStrokeMesh.setMatrixAt(this.brushStrokeIndex, matrix);
    this.brushStrokeMesh.instanceMatrix.needsUpdate = true;
    this.brushStrokeIndex++;
    this.brushStrokeMesh.count = Math.max(this.brushStrokeMesh.count, this.brushStrokeIndex);
    (this.brushStrokeMesh.material as THREE.MeshStandardMaterial).color.set(this.brushColor);
    (this.brushStrokeMesh.material as THREE.MeshStandardMaterial).opacity = this.brushOpacity;
  }

  private computeBrushRadius(): number {
    const min = 0.01;
    const max = 0.07;
    const normalized = THREE.MathUtils.clamp(this.brushSize, 0, 100) / 100;
    return THREE.MathUtils.lerp(min, max, normalized);
  }

  private computeBrushWorldSpacing(): number {
    const radius = this.computeBrushRadius();
    return radius * 0.55;
  }

  private placeSprinkles(hit: THREE.Intersection, scene: THREE.Scene): void {
    if (!hit.point) {
      return;
    }

    this.ensureSprinkleResources();

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
    const clusterSpacing = 0.14;
    const isFirstCluster = !this.lastSprinklePoint;
    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchor) < clusterSpacing) {
      return;
    }
    if (!isFirstCluster && Math.random() < 0.5) {
      return;
    }
    this.lastSprinklePoint = anchor.clone();

    const densityFactor = THREE.MathUtils.clamp(this.sprinkleDensity / 20, 0, 1);
    const count = Math.max(3, Math.round(THREE.MathUtils.lerp(5, 12, densityFactor)));
    const scatterRadius = THREE.MathUtils.lerp(0.08, 0.16, densityFactor);

    const geometry = this.sprinkleGeometryCache![this.sprinkleShape];
    const material = this.sprinkleMaterial!;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'Posypka';
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * scatterRadius;
      const offset = tangent.clone().multiplyScalar(Math.cos(angle) * radius).add(
        bitangent.clone().multiplyScalar(Math.sin(angle) * radius),
      );
      const position = anchor.clone().add(offset).add(normal.clone().multiplyScalar(0.004));
      const scale = THREE.MathUtils.lerp(this.sprinkleMinScale, this.sprinkleMaxScale + 0.3, Math.random());

      const baseQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const twist = new THREE.Quaternion().setFromAxisAngle(normal, Math.random() * Math.PI * 2);
      const tiltAxis = Math.random() < 0.5 ? tangent : bitangent;
      const tiltAmount = THREE.MathUtils.degToRad(15 + Math.random() * 40);
      const tilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, tiltAmount);
      baseQuat.multiply(tilt).multiply(twist);

      const matrix = new THREE.Matrix4().compose(position, baseQuat, new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, new THREE.Color(SPRINKLE_PALETTE[Math.floor(Math.random() * SPRINKLE_PALETTE.length)]));
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;

    const holder = new THREE.Group();
    holder.name = 'Posypka';
    holder.userData['displayName'] = 'Posypka';
    holder.userData['isPaintDecoration'] = true;
    holder.userData['isPaintStroke'] = true;
    holder.add(mesh);
    scene.add(holder);
    this.sprinkleEntries.push(holder);
    this.paintService.registerDecorationAddition(holder);
  }

  private ensureSprinkleResources(): void {
    if (!this.sprinkleGeometryCache) {
      this.sprinkleGeometryCache = {
        stick: new THREE.CapsuleGeometry(0.004, 0.02, 4, 8),
        ball: new THREE.SphereGeometry(0.006, 14, 12),
      };
    }
    if (!this.sprinkleMaterial) {
      this.sprinkleMaterial = new THREE.MeshStandardMaterial({ metalness: 0.08, roughness: 0.32 });
    }
  }

  private flagMaterialUpdate(): void {
    if (this.shaderUniforms) {
      this.shaderUniforms.useGradient.value = this.gradientEnabled;
    }
    this.paintedMaterials.forEach((mat) => (mat.needsUpdate = true));
  }

  private disposeSprinkles(): void {
    this.sprinkleEntries.forEach((entry) => {
      entry.parent?.remove(entry);
      entry.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as { isMesh?: boolean }).isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });
    });
    this.sprinkleEntries = [];
  }

  private disposePaintStrokes(): void {
    this.paintEntries.forEach((entry) => {
      entry.parent?.remove(entry);
      entry.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as { isMesh?: boolean }).isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
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

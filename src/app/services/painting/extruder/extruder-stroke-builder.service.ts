import {Inject, Injectable, PLATFORM_ID} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import * as THREE from 'three';
import {environment} from '../../../../environments/environment';
import {firstValueFrom} from 'rxjs';
import {DecorationFactory} from '../../../factories/decoration.factory';
import {ExtruderVariantInfo} from '../../../models/extruderVariantInfo';
import {CreamPathNode, CreamRingPreset, normalizePresetAngles} from '../../../models/cream-presets';
import {CakeMetadata, LayerMetadata} from '../../../factories/three-objects.factory';

export type ExtruderVariantData = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: THREE.Vector3;
  name: string;
  sourceId: string;
  scaleMultiplier?: number;
  thumbnailUrl?: string;
  description?: string;
};

@Injectable({ providedIn: 'root' })
export class ExtruderStrokeBuilderService {
  private readonly extruderTargetWidth = 0.12;
  private readonly extruderBaseRotation = new THREE.Euler(0, 0, 0);
  private extruderBrushId = 'cream_dot.glb';
  private extruderVariants: ExtruderVariantData[] | null = null;
  private extruderVariantsPromise: Promise<ExtruderVariantData[]> | null = null;
  private extruderVariantThumbnails = new Map<string, string>();

  private get apiBaseUrl(): string {
    return environment.apiBaseUrl;
  }

  constructor(
    private readonly http: HttpClient,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {}

  public setBrushId(brushId: string): void {
    if (this.extruderBrushId === brushId) {
      return;
    }
    this.extruderBrushId = brushId;
    this.resetCache();
  }

  public resetCache(): void {
    this.extruderVariants = null;
    this.extruderVariantsPromise = null;
    this.extruderVariantThumbnails.clear();
  }

  public async getExtruderVariants(): Promise<ExtruderVariantData[]> {
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

  public getExtruderSurfaceOffset(variants: ExtruderVariantData[], scaleMultiplier = 1): number {
    if (!variants.length) {
      return 0;
    }

    const variantIndex = Math.min(variants.length - 1, Math.max(0, variants.length - 1));
    const variant = variants[variantIndex];
    const width = this.getExtruderVariantWidth(variant);
    return Math.max(0.003, width * this.getExtruderScale(variant) * scaleMultiplier * 0.25);
  }

  public getExtruderAverageSpacing(variants: ExtruderVariantData[], scaleMultiplier = 1): number {
    if (!variants.length) {
      return 0.02;
    }

    const sizes = variants.map((variant) => this.getExtruderVariantWidth(variant));
    const average = sizes.reduce((sum, value) => sum + value, 0) / Math.max(1, sizes.length);
    return Math.max(0.012, (average * this.getExtruderScale(variants[0]) * scaleMultiplier) / 1.2);
  }

  public getExtruderSpacing(
    variants: ExtruderVariantData[],
    variantIndex: number,
    scaleMultiplier = 1,
  ): number {
    const variant = variants[variantIndex];
    const width = this.getExtruderVariantWidth(variant);
    return Math.max(0.003, width * this.getExtruderScale(variant) * scaleMultiplier);
  }

  public getExtruderScale(variant: ExtruderVariantData): number {
    const width = this.getExtruderVariantWidth(variant);
    if (width <= 1e-6) {
      return 1;
    }

    return (this.extruderTargetWidth * (variant.scaleMultiplier ?? 1)) / width;
  }

  public buildExtruderMatrix(
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

  public buildExtruderPath(
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

  public getExtruderVariantThumbnail(variantIndex: number, variant: ExtruderVariantData): string | null {
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

    ctx.fillStyle = '#f0f7ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maxDimension = Math.max(variant.size.x || 1, variant.size.y || 1, variant.size.z || 1);
    const scale = (canvas.width * 0.55) / Math.max(maxDimension, 1e-3);
    const drawWidth = Math.max(8, variant.size.x * scale);
    const drawHeight = Math.max(8, variant.size.z * scale || variant.size.y * scale);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(drawWidth, drawHeight) * 0.15;

    ctx.fillStyle = '#e6f3ff';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight, radius);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#bfdbfe';
    ctx.fillRect(centerX - drawWidth * 0.35, centerY - drawHeight * 0.1, drawWidth * 0.7, drawHeight * 0.2);
    ctx.fillStyle = '#93c5fd';
    ctx.fillRect(centerX - drawWidth * 0.2, centerY - drawHeight * 0.25, drawWidth * 0.4, drawHeight * 0.15);

    const dataUrl = canvas.toDataURL();
    this.extruderVariantThumbnails.set(cacheKey, dataUrl);
    return dataUrl;
  }

  private async loadExtruderVariants(): Promise<ExtruderVariantData[]> {
    if (!isPlatformBrowser(this.platformId)) {
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
    if (!isPlatformBrowser(this.platformId)) {
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
    if (!isPlatformBrowser(this.platformId)) {
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
      name: source.name || mesh.name || source.id,
      sourceId: modelId,
      scaleMultiplier: source.scaleMultiplier,
      thumbnailUrl: source.thumbnailUrl,
      description: source.description,
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
    const unwrappedAngles = this.unwrapNodeAngles(nodes);
    const points: { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] = [];
    let lastPosition: THREE.Vector3 | null = null;
    let segmentsLeft = totalSegments;

    nodes.forEach((node, index) => {
      if (index === nodes.length - 1) {
        return;
      }

      const next = nodes[index + 1];
      const steps = Math.max(1, Math.round(segmentsLeft / (nodes.length - 1 - index)));
      const startAngle = THREE.MathUtils.degToRad(unwrappedAngles[index]);
      const endAngle = THREE.MathUtils.degToRad(unwrappedAngles[index + 1]);
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

  private unwrapNodeAngles(nodes: CreamPathNode[]): number[] {
    if (!nodes.length) {
      return [];
    }

    const angles = [nodes[0].angleDeg];
    for (let i = 1; i < nodes.length; i++) {
      const prev = angles[i - 1];
      const raw = nodes[i].angleDeg;
      const options = [raw, raw + 360, raw - 360];
      const best = options.reduce((closest, current) => {
        const currentDiff = Math.abs(current - prev);
        const closestDiff = Math.abs(closest - prev);
        return currentDiff < closestDiff ? current : closest;
      });
      angles.push(best);
    }

    return angles;
  }

  private normalizeNodes(preset: CreamRingPreset): CreamPathNode[] {
    const fallbackNodes: CreamPathNode[] = [
      { angleDeg: preset.startAngleDeg ?? 0, heightNorm: preset.heightNorm, enabled: true },
      { angleDeg: preset.endAngleDeg ?? (preset.startAngleDeg ?? 0) + 180, heightNorm: preset.heightNorm, enabled: true },
    ];
    const base = preset.nodes && preset.nodes.length >= 2 ? preset.nodes : fallbackNodes;

    return base
      .filter((node) => node.enabled !== false)
      .map((node) => ({
        angleDeg: THREE.MathUtils.euclideanModulo(node.angleDeg, 360),
        heightNorm:
          node.heightNorm ??
          preset.heightNorm ??
          (preset.position === 'TOP_EDGE' ? 1 : preset.position === 'BOTTOM_EDGE' ? 0 : 0.5),
        enabled: node.enabled !== false,
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

  private getExtruderVariantWidth(variant: ExtruderVariantData): number {
    return Math.max(variant.size.x, variant.size.z);
  }
}

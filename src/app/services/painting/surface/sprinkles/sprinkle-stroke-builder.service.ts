import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SprinkleShape, SurfacePaintingService } from '../../../surface-painting.service';
import { SprinkleRendererService } from './sprinkle-renderer.service';

const SPRINKLE_PALETTE = ['#ff6b81', '#ffd66b', '#6bffb0', '#6bb8ff', '#ffffff'];

export interface SprinkleSettings {
  shape: SprinkleShape;
  density: number;
  useRandomColors: boolean;
  color: string;
  randomness: number;
  minScale: number;
  maxScale: number;
}

interface SprinklePlaceParams {
  hit: THREE.Intersection;
  anchor: THREE.Group | null;
  cakeGroup: THREE.Group | null;
  settings: SprinkleSettings;
  projectId: string | null;
  isReplaying: boolean;
  activeStroke: { id: string; mode: string; pathData?: number[]; pathPacked?: string; strokeSeed?: number } | null;
  nextStrokeId: number;
  getRenderOrder: () => number;
  trackSurfaceAddition: (obj: THREE.Object3D | null) => void;
}

@Injectable({ providedIn: 'root' })
export class SprinkleStrokeBuilderService {
  private lastSprinklePoint: THREE.Vector3 | null = null;
  private rng: (() => number) | null = null;
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
  private readonly tempVec3_8 = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempQuat2 = new THREE.Quaternion();
  private readonly tempQuat3 = new THREE.Quaternion();
  private readonly tempScale = new THREE.Vector3();

  private static readonly POS_SCALE = 4096; // ~0.00024 resolution up to ~8 units range
  private static readonly NORMAL_SCALE = 16384; // preserves unit normals with good fidelity

  constructor(private readonly sprinkleRenderer: SprinkleRendererService) {}

  public resetStrokeState(): void {
    this.lastSprinklePoint = null;
    this.rng = null;
  }

  public placeSprinkles(params: SprinklePlaceParams): void {
    if (!params.hit.point) return;
    if (params.hit.point.lengthSq() < 0.001) return;

    const anchorGroup = params.anchor;
    if (anchorGroup) anchorGroup.updateMatrixWorld(true);
    if (anchorGroup) {
      this.tempMatrixInverse.copy(anchorGroup.matrixWorld).invert();
    }

    const strokeId = params.activeStroke?.id ?? `sprinkle-${params.nextStrokeId}`;
    const { state, created, strokeSeed } = this.sprinkleRenderer.ensureSprinkleStroke(anchorGroup, {
      strokeId,
      shape: params.settings.shape,
      color: params.settings.color,
      useRandomColors: params.settings.useRandomColors,
      projectId: params.projectId,
      getRenderOrder: params.getRenderOrder,
      strokeSeed: params.activeStroke?.strokeSeed,
    });
    if (created) {
      params.trackSurfaceAddition(state.group);
      this.resetStrokeState();
    }
    if (!state.mesh || !state.group) return;
    if (state.shape !== params.settings.shape) return;

    const effectiveSeed = params.activeStroke?.strokeSeed ?? strokeSeed;
    if (effectiveSeed && !this.rng) {
      this.rng = this.createRng(effectiveSeed);
      if (params.activeStroke) {
        params.activeStroke.strokeSeed = effectiveSeed;
      }
    }
    const rng = this.rng ?? Math.random;

    const anchorPointWorld = this.tempVec3.copy(params.hit.point);
    const worldNormal = this.tempVec3_2;

    if (params.isReplaying) {
      if (params.hit.face?.normal) worldNormal.copy(params.hit.face.normal);
      else return;
    } else {
      if (params.hit.face?.normal) worldNormal.copy(params.hit.face.normal);
      else worldNormal.set(0, 1, 0);
      if (params.hit.object) {
        worldNormal.transformDirection(params.hit.object.matrixWorld).normalize();
      }
    }

    if (worldNormal.lengthSq() < 0.001) return;

    if (params.cakeGroup) {
      const center = this.tempVec3_3;
      params.cakeGroup.getWorldPosition(center);
      const toSurf = this.tempVec3_4.copy(anchorPointWorld).sub(center);
      if (worldNormal.dot(toSurf) < 0) worldNormal.negate();
    }

    const localNormal = this.tempVec3_3.copy(worldNormal);
    if (anchorGroup) localNormal.transformDirection(this.tempMatrixInverse).normalize();

    const tangent = this.tempVec3_4.copy(localNormal).cross(this.tempVec3_5.set(0, 1, 0));
    if (tangent.lengthSq() < 0.001) tangent.set(1, 0, 0);
    tangent.normalize();
    const bitangent = this.tempVec3_5.copy(localNormal).cross(tangent).normalize();

    const liftAmount = 0.0002;
    const anchorPointLocal = this.tempVec3_6.copy(anchorPointWorld)
      .add(this.tempVec3_7.copy(worldNormal).multiplyScalar(liftAmount));
    if (anchorGroup) anchorGroup.worldToLocal(anchorPointLocal);

    const density01 = THREE.MathUtils.clamp(params.settings.density / 20, 0, 1);
    const clusterSpacing = THREE.MathUtils.lerp(0.12, 0.05, density01);
    const isFirstCluster = !this.lastSprinklePoint;

    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchorPointWorld) < clusterSpacing) {
      return;
    }

    if (!params.isReplaying && !isFirstCluster) {
      const skipChance = THREE.MathUtils.lerp(0, 0.1, params.settings.randomness);
      if (rng() < skipChance) return;
    }

    this.lastSprinklePoint = this.lastSprinklePoint ?? new THREE.Vector3();
    this.lastSprinklePoint.copy(anchorPointWorld);

    if (params.activeStroke?.mode === 'sprinkles' && !params.isReplaying) {
      const targetPath = params.activeStroke.pathData ?? (params.activeStroke.pathData = []);
      targetPath.push(
        this.round(anchorPointWorld.x), this.round(anchorPointWorld.y), this.round(anchorPointWorld.z),
        this.round(worldNormal.x), this.round(worldNormal.y), this.round(worldNormal.z)
      );
    }

    const count = Math.max(1, Math.round(THREE.MathUtils.lerp(10, 45, density01)));
    const startUpdateIndex = this.sprinkleRenderer.getStrokeIndex();

    for (let i = 0; i < count; i++) {
      if (this.sprinkleRenderer.getStrokeIndex() >= this.sprinkleRenderer.getStrokeCapacity()) break;

      const baseSpread = THREE.MathUtils.lerp(0.04, 0.12, density01);
      const spread = THREE.MathUtils.lerp(baseSpread, baseSpread * 1.6, params.settings.randomness);
      const tiltAmount = THREE.MathUtils.lerp(0.0, 0.35, params.settings.randomness);
      const dirOffset = (rng() - 0.5) * 0.3;
      const s = THREE.MathUtils.lerp(params.settings.minScale, params.settings.maxScale, rng());
      const randomOffsetTangent = (rng() - 0.5) * spread;
      const randomOffsetBitangent = (rng() - 0.5) * spread;

      const phi = rng() * Math.PI * 2;
      const tangentDir = this.tempVec3_7
        .copy(tangent)
        .multiplyScalar(Math.cos(phi))
        .add(this.tempVec3_8.copy(bitangent).multiplyScalar(Math.sin(phi)))
        .normalize();

      const dir = this.tempVec3_8
        .copy(tangentDir)
        .addScaledVector(localNormal, (rng() - 0.5) * tiltAmount)
        .normalize();

      this.tempVec3_7
        .copy(anchorPointLocal)
        .addScaledVector(tangent, randomOffsetTangent)
        .addScaledVector(bitangent, randomOffsetBitangent)
        .addScaledVector(localNormal, dirOffset * 0.02);

      if (params.settings.shape === 'stick' || params.settings.shape === 'star') {
        this.tempQuat.setFromUnitVectors(this.tempVec3_2.set(0, 1, 0), dir);
      } else {
        this.tempQuat.identity();
      }

      this.tempMatrix.compose(this.tempVec3_7, this.tempQuat, this.tempScale.setScalar(s));
      state.mesh.setMatrixAt(this.sprinkleRenderer.getStrokeIndex(), this.tempMatrix);

      let colorHex: string;
      if (params.settings.useRandomColors) {
        colorHex = SPRINKLE_PALETTE[Math.floor(rng() * SPRINKLE_PALETTE.length)];
      } else {
        colorHex = params.settings.color;
      }
      this.tempColor.set(colorHex).convertSRGBToLinear();
      state.mesh.setColorAt(this.sprinkleRenderer.getStrokeIndex(), this.tempColor);

      this.sprinkleRenderer.incrementStrokeIndex();
    }

    const added = this.sprinkleRenderer.getStrokeIndex() - startUpdateIndex;
    this.sprinkleRenderer.updateAfterAdd(startUpdateIndex, added, params.isReplaying);
  }

  public packPathData(pathData: number[]): string {
    const buffer = new Int16Array(pathData.length);
    for (let i = 0; i < pathData.length; i += 6) {
      buffer[i] = this.quantize(pathData[i], SprinkleStrokeBuilderService.POS_SCALE);
      buffer[i + 1] = this.quantize(pathData[i + 1], SprinkleStrokeBuilderService.POS_SCALE);
      buffer[i + 2] = this.quantize(pathData[i + 2], SprinkleStrokeBuilderService.POS_SCALE);
      buffer[i + 3] = this.quantize(pathData[i + 3], SprinkleStrokeBuilderService.NORMAL_SCALE);
      buffer[i + 4] = this.quantize(pathData[i + 4], SprinkleStrokeBuilderService.NORMAL_SCALE);
      buffer[i + 5] = this.quantize(pathData[i + 5], SprinkleStrokeBuilderService.NORMAL_SCALE);
    }
    return this.base64FromBytes(new Uint8Array(buffer.buffer));
  }

  public unpackPathData(packed: string | undefined, fallback: number[] | undefined): number[] {
    if (!packed) return fallback ? [...fallback] : [];
    const bytes = this.bytesFromBase64(packed);
    const view = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const path: number[] = new Array(view.length);
    for (let i = 0; i < view.length; i += 6) {
      path[i] = view[i] / SprinkleStrokeBuilderService.POS_SCALE;
      path[i + 1] = view[i + 1] / SprinkleStrokeBuilderService.POS_SCALE;
      path[i + 2] = view[i + 2] / SprinkleStrokeBuilderService.POS_SCALE;
      path[i + 3] = view[i + 3] / SprinkleStrokeBuilderService.NORMAL_SCALE;
      path[i + 4] = view[i + 4] / SprinkleStrokeBuilderService.NORMAL_SCALE;
      path[i + 5] = view[i + 5] / SprinkleStrokeBuilderService.NORMAL_SCALE;
    }
    return path;
  }

  public generateStrokeSeed(): number {
    const timeSeed = Date.now() & 0xffffffff;
    const randSeed = Math.floor(Math.random() * 0xffffffff);
    const seed = timeSeed ^ randSeed;
    return seed === 0 ? 1 : seed;
  }

  private quantize(value: number, scale: number): number {
    const scaled = Math.round(value * scale);
    return Math.max(-32768, Math.min(32767, scaled));
  }

  private createRng(seed: number): () => number {
    let state = seed >>> 0;
    if (state === 0) state = 1;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 0xffffffff);
    };
  }

  private base64FromBytes(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    if (typeof btoa !== 'undefined') {
      return btoa(binary);
    }
    const globalBuffer = (globalThis as any)?.Buffer;
    if (globalBuffer) {
      return globalBuffer.from(bytes).toString('base64');
    }
    return '';
  }

  private bytesFromBase64(encoded: string): Uint8Array {
    if (typeof atob !== 'undefined') {
      const binary = atob(encoded);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    const globalBuffer = (globalThis as any)?.Buffer;
    return globalBuffer ? new Uint8Array(globalBuffer.from(encoded, 'base64')) : new Uint8Array();
  }

  private round(val: number): number {
    return SurfacePaintingService.roundValue(val);
  }
}

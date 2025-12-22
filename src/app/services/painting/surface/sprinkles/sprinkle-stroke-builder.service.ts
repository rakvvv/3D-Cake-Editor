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
  activeStroke: { id: string; mode: string; pathData: number[] } | null;
  nextStrokeId: number;
  getRenderOrder: () => number;
  trackSurfaceAddition: (obj: THREE.Object3D | null) => void;
}

@Injectable({ providedIn: 'root' })
export class SprinkleStrokeBuilderService {
  private lastSprinklePoint: THREE.Vector3 | null = null;
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

  constructor(private readonly sprinkleRenderer: SprinkleRendererService) {}

  public resetStrokeState(): void {
    this.lastSprinklePoint = null;
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
    const { state, created } = this.sprinkleRenderer.ensureSprinkleStroke(anchorGroup, {
      strokeId,
      shape: params.settings.shape,
      color: params.settings.color,
      useRandomColors: params.settings.useRandomColors,
      projectId: params.projectId,
      getRenderOrder: params.getRenderOrder,
    });
    if (created) {
      params.trackSurfaceAddition(state.group);
      this.resetStrokeState();
    }
    if (!state.mesh || !state.group) return;
    if (state.shape !== params.settings.shape) return;

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

    const clusterSpacing = 0.16;
    const isFirstCluster = !this.lastSprinklePoint;

    if (this.lastSprinklePoint && this.lastSprinklePoint.distanceTo(anchorPointWorld) < clusterSpacing) {
      return;
    }

    if (!params.isReplaying && !isFirstCluster) {
      const skipChance = THREE.MathUtils.lerp(0, 0.4, params.settings.randomness);
      if (Math.random() < skipChance) return;
    }

    this.lastSprinklePoint = this.lastSprinklePoint ?? new THREE.Vector3();
    this.lastSprinklePoint.copy(anchorPointWorld);

    if (params.activeStroke?.mode === 'sprinkles' && !params.isReplaying) {
      params.activeStroke.pathData.push(
        this.round(anchorPointWorld.x), this.round(anchorPointWorld.y), this.round(anchorPointWorld.z),
        this.round(worldNormal.x), this.round(worldNormal.y), this.round(worldNormal.z)
      );
    }

    const count = Math.max(2, Math.round(THREE.MathUtils.lerp(3, 7, params.settings.density / 20)));
    const startUpdateIndex = this.sprinkleRenderer.getStrokeIndex();

    for (let i = 0; i < count; i++) {
      if (this.sprinkleRenderer.getStrokeIndex() >= this.sprinkleRenderer.getStrokeCapacity()) break;

      const randomRotation = (Math.random() - 0.5) * THREE.MathUtils.lerp(0.2, 0.6, params.settings.randomness);
      const tilt = (Math.random() - 0.5) * 0.1;
      const s = THREE.MathUtils.lerp(params.settings.minScale, params.settings.maxScale, Math.random());
      const dir = (Math.random() - 0.5) * 0.3;
      const spread = THREE.MathUtils.lerp(0.05, 0.12, params.settings.randomness);

      this.tempVec3_7
        .copy(anchorPointLocal)
        .add(tangent.clone().multiplyScalar((Math.random() - 0.5) * spread))
        .add(bitangent.clone().multiplyScalar((Math.random() - 0.5) * spread))
        .add(localNormal.clone().multiplyScalar(dir * 0.02));

      this.tempQuat.setFromUnitVectors(this.tempVec3_2.set(0, 0, 1), localNormal);
      this.tempQuat2.setFromAxisAngle(localNormal, randomRotation);
      this.tempQuat3.setFromAxisAngle(localNormal, tilt);
      this.tempQuat.multiply(this.tempQuat3).multiply(this.tempQuat2);

      this.tempMatrix.compose(this.tempVec3_7, this.tempQuat, this.tempScale.setScalar(s));
      state.mesh.setMatrixAt(this.sprinkleRenderer.getStrokeIndex(), this.tempMatrix);

      let colorHex: string;
      if (params.settings.useRandomColors) {
        colorHex = SPRINKLE_PALETTE[Math.floor(Math.random() * SPRINKLE_PALETTE.length)];
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

  private round(val: number): number {
    return SurfacePaintingService.roundValue(val);
  }
}

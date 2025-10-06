import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { ClosestPointInfo } from '../models/cake.points';
import { CakeMetadata } from '../factories/three-objects.factory';
import { DecorationPlacementType } from '../models/decorationInfo';
import { DecorationValidationIssue } from '../models/decoration-validation';

interface ScaledLayerInfo {
  index: number;
  bottom: number;
  top: number;
  radius?: number;
  halfWidth?: number;
  halfDepth?: number;
}

@Injectable({
  providedIn: 'root',
})
export class SnapService {
  private readonly attachmentTolerance = 0.75;

  private cakeBase: THREE.Object3D | null = null;

  private getScaledLayers(metadata: CakeMetadata): ScaledLayerInfo[] {
    const scale = this.cakeBase?.scale ?? new THREE.Vector3(1, 1, 1);

    return metadata.layerDimensions.map((layer) => ({
      index: layer.index,
      bottom: layer.bottomY * scale.y,
      top: layer.topY * scale.y,
      radius: layer.radius !== undefined ? layer.radius * scale.x : undefined,
      halfWidth: layer.width !== undefined ? (layer.width / 2) * scale.x : undefined,
      halfDepth: layer.depth !== undefined ? (layer.depth / 2) * scale.z : undefined,
    }));
  }

  private getCakeMetadata(): CakeMetadata | undefined {
    return this.cakeBase?.userData['metadata'] as CakeMetadata | undefined;
  }

  public setCakeBase(cake: THREE.Object3D | null): void {
    this.cakeBase = cake;
  }

  public getCakeBase(): THREE.Object3D | null {
    return this.cakeBase;
  }

  public validateDecorations(objects: THREE.Object3D[]): DecorationValidationIssue[] {
    const issues: DecorationValidationIssue[] = [];

    for (const object of objects) {
      const issue = this.validateDecoration(object);
      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }

  public validateDecoration(object: THREE.Object3D): DecorationValidationIssue | null {
    const decorationType = object.userData['decorationType'] as DecorationPlacementType | undefined;
    const expectedSurfaces = this.mapPlacementTypeToSurfaces(decorationType);

    if (!this.cakeBase) {
      return {
        object,
        decorationType,
        surfaceType: 'NONE',
        expectedSurfaces,
        distance: Infinity,
        reason: 'NO_CAKE',
      };
    }

    const closestPointInfo = this.getClosestPointOnCake(object.getWorldPosition(new THREE.Vector3()));

    if (closestPointInfo.surfaceType === 'NONE' || !isFinite(closestPointInfo.distance)) {
      return {
        object,
        decorationType,
        surfaceType: closestPointInfo.surfaceType,
        expectedSurfaces,
        distance: closestPointInfo.distance,
        reason: 'OUTSIDE',
      };
    }

    if (closestPointInfo.distance > this.attachmentTolerance) {
      return {
        object,
        decorationType,
        surfaceType: closestPointInfo.surfaceType,
        expectedSurfaces,
        distance: closestPointInfo.distance,
        reason: 'OUTSIDE',
      };
    }

    if (expectedSurfaces.length > 0 && !expectedSurfaces.includes(closestPointInfo.surfaceType)) {
      return {
        object,
        decorationType,
        surfaceType: closestPointInfo.surfaceType,
        expectedSurfaces,
        distance: closestPointInfo.distance,
        reason: 'TYPE_MISMATCH',
      };
    }

    return null;
  }

  public getClosestPointOnCake(worldPoint: THREE.Vector3): ClosestPointInfo {
    const defaultResult: ClosestPointInfo = {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      distance: Infinity,
      surfaceType: 'NONE',
    };

    if (!this.cakeBase) {
      return defaultResult;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return defaultResult;
    }

    const localPoint = this.cakeBase.worldToLocal(worldPoint.clone());
    const scale = this.cakeBase.scale;
    const halfHeight = (metadata.totalHeight * scale.y) / 2;
    const scaledLayers = this.getScaledLayers(metadata);

    let closestPointLocal = new THREE.Vector3();
    let normalLocal = new THREE.Vector3(0, 1, 0);
    let distanceSq = Infinity;
    let surfaceType: 'TOP' | 'SIDE' | 'NONE' = 'NONE';

    if (scaledLayers.length === 0) {
      scaledLayers.push({
        index: 0,
        bottom: -halfHeight,
        top: halfHeight,
        radius: metadata.radius ? metadata.radius * scale.x : undefined,
        halfWidth: metadata.width ? (metadata.width / 2) * scale.x : undefined,
        halfDepth: metadata.depth ? (metadata.depth / 2) * scale.z : undefined,
      });
    }

    for (const layer of scaledLayers) {
      if (metadata.shape === 'cylinder') {
        const radius = layer.radius ?? (metadata.maxRadius ?? metadata.radius ?? 1) * scale.x;
        const topY = layer.top;
        const bottomY = layer.bottom;

        const horizontal = new THREE.Vector3(localPoint.x, 0, localPoint.z);
        if (horizontal.lengthSq() > radius * radius) {
          horizontal.setLength(radius);
        }

        const topPoint = new THREE.Vector3(horizontal.x, topY, horizontal.z);
        const topDistanceSq = localPoint.distanceToSquared(topPoint);
        if (topDistanceSq < distanceSq) {
          distanceSq = topDistanceSq;
          closestPointLocal.copy(topPoint);
          normalLocal.set(0, 1, 0);
          surfaceType = 'TOP';
        }

        const sideHorizontal = new THREE.Vector3(localPoint.x, 0, localPoint.z);
        const clampedY = THREE.MathUtils.clamp(localPoint.y, bottomY, topY);

        if (sideHorizontal.lengthSq() > 1e-6) {
          const sidePoint = sideHorizontal.clone().setLength(radius);
          sidePoint.y = clampedY;
          const dSq = localPoint.distanceToSquared(sidePoint);

          if (dSq < distanceSq) {
            distanceSq = dSq;
            closestPointLocal.copy(sidePoint);
            normalLocal.set(sidePoint.x, 0, sidePoint.z).normalize();
            surfaceType = 'SIDE';
          }
        } else {
          const sidePoint = new THREE.Vector3(radius, clampedY, 0);
          const dSq = localPoint.distanceToSquared(sidePoint);
          if (dSq < distanceSq) {
            distanceSq = dSq;
            closestPointLocal.copy(sidePoint);
            normalLocal.set(1, 0, 0);
            surfaceType = 'SIDE';
          }
        }
      } else {
        const halfWidth = layer.halfWidth ?? ((metadata.width ?? 1) / 2) * scale.x;
        const halfDepth = layer.halfDepth ?? ((metadata.depth ?? 1) / 2) * scale.z;
        const topY = layer.top;
        const bottomY = layer.bottom;

        const clampedX = THREE.MathUtils.clamp(localPoint.x, -halfWidth, halfWidth);
        const clampedZ = THREE.MathUtils.clamp(localPoint.z, -halfDepth, halfDepth);
        const topPoint = new THREE.Vector3(clampedX, topY, clampedZ);
        const topDistanceSq = localPoint.distanceToSquared(topPoint);

        if (topDistanceSq < distanceSq) {
          distanceSq = topDistanceSq;
          closestPointLocal.copy(topPoint);
          normalLocal.set(0, 1, 0);
          surfaceType = 'TOP';
        }

        const clampedY = THREE.MathUtils.clamp(localPoint.y, bottomY, topY);
        const sideCandidates: Array<{ point: THREE.Vector3; normal: THREE.Vector3 }> = [
          { point: new THREE.Vector3(halfWidth, clampedY, clampedZ), normal: new THREE.Vector3(1, 0, 0) },
          { point: new THREE.Vector3(-halfWidth, clampedY, clampedZ), normal: new THREE.Vector3(-1, 0, 0) },
          { point: new THREE.Vector3(clampedX, clampedY, halfDepth), normal: new THREE.Vector3(0, 0, 1) },
          { point: new THREE.Vector3(clampedX, clampedY, -halfDepth), normal: new THREE.Vector3(0, 0, -1) },
        ];

        for (const candidate of sideCandidates) {
          const dSq = localPoint.distanceToSquared(candidate.point);
          if (dSq < distanceSq) {
            distanceSq = dSq;
            closestPointLocal.copy(candidate.point);
            normalLocal.copy(candidate.normal);
            surfaceType = 'SIDE';
          }
        }
      }
    }

    if (distanceSq === Infinity) {
      return defaultResult;
    }

    return {
      point: closestPointLocal,
      normal: normalLocal,
      distance: Math.sqrt(distanceSq),
      surfaceType,
    };
  }

  private mapPlacementTypeToSurfaces(type?: DecorationPlacementType): Array<'TOP' | 'SIDE'> {
    switch (type) {
      case 'TOP':
        return ['TOP'];
      case 'SIDE':
        return ['SIDE'];
      case 'BOTH':
      case undefined:
        return ['TOP', 'SIDE'];
    }
  }
}

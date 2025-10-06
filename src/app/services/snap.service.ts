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

export interface SnapInfoSnapshot {
  layerIndex: number;
  surfaceType: 'TOP' | 'SIDE';
  normal: [number, number, number];
  offset: number;
  roll: number;
}

interface SnapUserData extends SnapInfoSnapshot {}

export interface SnappedDecorationState {
  object: THREE.Object3D;
  info: SnapInfoSnapshot;
}

@Injectable({
  providedIn: 'root',
})
export class SnapService {
  private readonly attachmentTolerance = 0.75;

  private cakeBase: THREE.Object3D | null = null;

  public snapDecorationToCake(object: THREE.Object3D): {
    success: boolean;
    surfaceType: 'TOP' | 'SIDE' | 'NONE';
    message: string;
  } {
    if (!this.cakeBase) {
      return {
        success: false,
        surfaceType: 'NONE',
        message: 'Brak tortu do przypięcia dekoracji.',
      };
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return {
        success: false,
        surfaceType: 'NONE',
        message: 'Brak danych tortu – nie można obliczyć pozycji przyczepienia.',
      };
    }

    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const closest = this.getClosestPointOnCake(worldPosition);

    if (closest.surfaceType === 'NONE' || !isFinite(closest.distance)) {
      return {
        success: false,
        surfaceType: 'NONE',
        message: 'Dekoracja znajduje się zbyt daleko od tortu.',
      };
    }

    const surfaceLocalPoint = closest.point.clone();
    const surfaceWorldPosition = this.cakeBase.localToWorld(surfaceLocalPoint.clone());
    const surfaceWorldNormal = this.getWorldNormal(closest.normal.clone());

    this.applyOrientationForSurface(object, surfaceWorldNormal, closest.surfaceType, 0);
    object.updateMatrixWorld(true);

    const offset = this.computeOffsetDistance(object, surfaceWorldNormal);
    const finalWorldPosition = surfaceWorldPosition
      .clone()
      .add(surfaceWorldNormal.clone().multiplyScalar(offset));

    if (object.parent !== this.cakeBase) {
      this.cakeBase.attach(object);
    }

    const finalLocalPosition = this.cakeBase.worldToLocal(finalWorldPosition.clone());
    object.position.copy(finalLocalPosition);
    object.updateMatrixWorld(true);
    object.userData['isSnapped'] = true;

    const localNormal = closest.normal.clone().normalize();
    const offsetDistance = Math.max(0, finalLocalPosition.clone().sub(surfaceLocalPoint).dot(localNormal));
    this.writeSnapInfo(object, {
      layerIndex: closest.layerIndex,
      surfaceType: closest.surfaceType,
      normal: localNormal.toArray(),
      offset: offsetDistance,
      roll: 0,
    });

    return {
      success: true,
      surfaceType: closest.surfaceType,
      message:
        closest.surfaceType === 'TOP'
          ? 'Dekoracja umieszczona na górnej powierzchni tortu.'
          : 'Dekoracja umieszczona na boku tortu.',
    };
  }

  public alignDecorationToSurface(object: THREE.Object3D): {
    success: boolean;
    message: string;
  } {
    if (!this.cakeBase) {
      return {
        success: false,
        message: 'Brak tortu – nie można ustawić orientacji dekoracji.',
      };
    }

    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const closest = this.getClosestPointOnCake(worldPosition);

    if (closest.surfaceType === 'NONE' || closest.distance > this.attachmentTolerance * 3) {
      return {
        success: false,
        message: 'Dekoracja jest zbyt daleko od tortu, aby wyrównać orientację.',
      };
    }

    const surfaceWorldNormal = this.getWorldNormal(closest.normal.clone());
    this.applyOrientationForSurface(object, surfaceWorldNormal, closest.surfaceType);
    object.updateMatrixWorld(true);

    if (object.userData['isSnapped'] && this.cakeBase && object.parent === this.cakeBase) {
      const info = this.readSnapInfo(object);
      if (info) {
        const updatedInfo: SnapUserData = {
          layerIndex: closest.layerIndex >= 0 ? closest.layerIndex : info.layerIndex,
          surfaceType: closest.surfaceType,
          normal: closest.normal.clone().normalize().toArray(),
          offset: info.offset,
          roll: 0,
        };
        this.writeSnapInfo(object, updatedInfo);
        this.enforceSnappedPosition(object);
      }
    }

    return {
      success: true,
      message: 'Dekoracja została wyrównana do powierzchni tortu.',
    };
  }

  private getScaledLayers(metadata: CakeMetadata): ScaledLayerInfo[] {
    return metadata.layerDimensions.map((layer) => ({
      index: layer.index,
      bottom: layer.bottomY,
      top: layer.topY,
      radius: layer.radius,
      halfWidth: layer.width !== undefined ? layer.width / 2 : undefined,
      halfDepth: layer.depth !== undefined ? layer.depth / 2 : undefined,
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
      layerIndex: -1,
    };

    if (!this.cakeBase) {
      return defaultResult;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return defaultResult;
    }

    const localPoint = this.cakeBase.worldToLocal(worldPoint.clone());
    const halfHeight = metadata.totalHeight / 2;
    const scaledLayers = this.getScaledLayers(metadata);

    let closestPointLocal = new THREE.Vector3();
    let normalLocal = new THREE.Vector3(0, 1, 0);
    let distanceSq = Infinity;
    let surfaceType: 'TOP' | 'SIDE' | 'NONE' = 'NONE';
    let closestLayerIndex = -1;

    if (scaledLayers.length === 0) {
      scaledLayers.push({
        index: 0,
        bottom: -halfHeight,
        top: halfHeight,
        radius: metadata.maxRadius ?? metadata.radius,
        halfWidth: metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : undefined,
        halfDepth: metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : undefined,
      });
    }

    for (const layer of scaledLayers) {
      if (metadata.shape === 'cylinder') {
        const radius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
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
          closestLayerIndex = layer.index;
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
            closestLayerIndex = layer.index;
          }
        } else {
          const sidePoint = new THREE.Vector3(radius, clampedY, 0);
          const dSq = localPoint.distanceToSquared(sidePoint);
          if (dSq < distanceSq) {
            distanceSq = dSq;
            closestPointLocal.copy(sidePoint);
            normalLocal.set(1, 0, 0);
            surfaceType = 'SIDE';
            closestLayerIndex = layer.index;
          }
        }
      } else {
        const halfWidth = layer.halfWidth ??
          (metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : 0.5);
        const halfDepth = layer.halfDepth ??
          (metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : 0.5);
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
          closestLayerIndex = layer.index;
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
            closestLayerIndex = layer.index;
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
      layerIndex: closestLayerIndex,
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

  public enforceSnappedPosition(object: THREE.Object3D): void {
    if (!object.userData['isSnapped']) {
      return;
    }

    if (!this.cakeBase || object.parent !== this.cakeBase) {
      return;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return;
    }

    let snapInfo = this.readSnapInfo(object);
    if (!snapInfo) {
      return;
    }

    snapInfo = this.normalizeSnapInfo(snapInfo, metadata);
    this.writeSnapInfo(object, snapInfo);

    const localNormal = new THREE.Vector3().fromArray(snapInfo.normal).normalize();
    const layers = this.getScaledLayers(metadata);
    const layer = this.findLayerInfo(layers, snapInfo.layerIndex);

    const desiredWorldPosition = object.getWorldPosition(new THREE.Vector3());
    const desiredLocalPosition = this.cakeBase.worldToLocal(desiredWorldPosition.clone());

    const projection =
      snapInfo.surfaceType === 'TOP'
        ? this.projectPointToTopSurface(desiredLocalPosition, layer, metadata, localNormal, snapInfo.offset)
        : this.projectPointToSideSurface(desiredLocalPosition, layer, metadata, localNormal, snapInfo.offset);

    object.position.copy(projection.position);
    object.updateMatrixWorld(true);

    const worldNormal = this.getWorldNormal(projection.normal.clone());
    const updatedInfo: SnapUserData = {
      ...snapInfo,
      normal: projection.normal.clone().normalize().toArray(),
    };
    this.writeSnapInfo(object, updatedInfo);
    this.applyOrientationForSurface(object, worldNormal, snapInfo.surfaceType, updatedInfo.roll ?? 0);
    object.updateMatrixWorld(true);
  }

  public rotateDecorationQuarter(object: THREE.Object3D, direction: 1 | -1 = 1): {
    success: boolean;
    message: string;
  } {
    const angle = (Math.PI / 2) * direction;
    const message = direction === 1 ? 'Dekoracja została obrócona o 90° w prawo.' : 'Dekoracja została obrócona o 90° w lewo.';
    return this.rotateDecorationByAngle(object, angle, message);
  }

  public rotateDecorationHalf(object: THREE.Object3D): { success: boolean; message: string } {
    return this.rotateDecorationByAngle(object, Math.PI, 'Dekoracja została obrócona o 180°.');
  }

  private rotateDecorationByAngle(
    object: THREE.Object3D,
    angle: number,
    message: string,
  ): { success: boolean; message: string } {
    const snapInfo = this.readSnapInfo(object);
    if (snapInfo && object.userData['isSnapped'] && this.cakeBase) {
      const updatedInfo: SnapUserData = {
        ...snapInfo,
        roll: this.normalizeRoll((snapInfo.roll ?? 0) + angle),
      };
      this.writeSnapInfo(object, updatedInfo);

      const normal = new THREE.Vector3().fromArray(updatedInfo.normal).normalize();
      const worldNormal = this.getWorldNormal(normal.clone());
      this.applyOrientationForSurface(object, worldNormal, updatedInfo.surfaceType, updatedInfo.roll);
      object.updateMatrixWorld(true);
      this.enforceSnappedPosition(object);

      return {
        success: true,
        message,
      };
    }

    const axis = new THREE.Vector3(0, 1, 0);
    object.rotateOnWorldAxis(axis, angle);
    object.updateMatrixWorld(true);

    return { success: true, message };
  }

  public resetDecorationOrientation(object: THREE.Object3D): void {
    if (!object.userData['isSnapped'] || !this.cakeBase) {
      object.rotation.set(0, object.rotation.y, 0);
      object.updateMatrixWorld(true);
      return;
    }

    const snapInfo = this.readSnapInfo(object);
    if (!snapInfo) {
      object.rotation.set(0, object.rotation.y, 0);
      object.updateMatrixWorld(true);
      return;
    }

    const updatedInfo: SnapUserData = {
      ...snapInfo,
      roll: 0,
    };
    this.writeSnapInfo(object, updatedInfo);

    const normal = new THREE.Vector3().fromArray(updatedInfo.normal).normalize();
    const worldNormal = this.getWorldNormal(normal.clone());
    this.applyOrientationForSurface(object, worldNormal, updatedInfo.surfaceType, 0);
    object.updateMatrixWorld(true);
    this.enforceSnappedPosition(object);
  }

  public captureSnappedOrientation(object: THREE.Object3D): void {
    if (!object.userData['isSnapped'] || !this.cakeBase) {
      return;
    }

    const snapInfo = this.readSnapInfo(object);
    if (!snapInfo) {
      return;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return;
    }

    const normalizedInfo = this.normalizeSnapInfo(snapInfo, metadata);
    const localNormal = new THREE.Vector3().fromArray(normalizedInfo.normal).normalize();
    const worldNormal = this.getWorldNormal(localNormal.clone());
    const baseQuaternion = this.buildOrientationQuaternion(worldNormal, normalizedInfo.surfaceType);
    const currentQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
    const relative = baseQuaternion.clone().invert().multiply(currentQuaternion);

    const sinHalf = Math.sqrt(relative.x * relative.x + relative.y * relative.y + relative.z * relative.z);

    if (sinHalf < 1e-6) {
      const updatedInfo: SnapUserData = { ...normalizedInfo, roll: 0 };
      this.writeSnapInfo(object, updatedInfo);
      this.applyOrientationForSurface(object, worldNormal, updatedInfo.surfaceType, 0);
      this.enforceSnappedPosition(object);
      return;
    }

    let angle = 2 * Math.atan2(sinHalf, relative.w);
    const axis = new THREE.Vector3(relative.x, relative.y, relative.z).normalize();
    const allowedAxis = normalizedInfo.surfaceType === 'SIDE'
      ? worldNormal.clone().normalize()
      : new THREE.Vector3(0, 1, 0);

    if (axis.dot(allowedAxis) < 0) {
      angle = -angle;
    }

    const updatedInfo: SnapUserData = {
      ...normalizedInfo,
      roll: this.normalizeRoll(angle),
    };

    this.writeSnapInfo(object, updatedInfo);
    this.applyOrientationForSurface(object, worldNormal, updatedInfo.surfaceType, updatedInfo.roll);
    object.updateMatrixWorld(true);
    this.enforceSnappedPosition(object);
  }

  public captureSnappedDecorations(objects: THREE.Object3D[]): SnappedDecorationState[] {
    const states: SnappedDecorationState[] = [];

    for (const object of objects) {
      if (!object.userData['isSnapped']) {
        continue;
      }

      const info = this.readSnapInfo(object);
      if (!info) {
        continue;
      }

      states.push({
        object,
        info: {
          ...info,
          normal: [...info.normal] as [number, number, number],
        },
      });
    }

    return states;
  }

  public restoreSnappedDecorations(states: SnappedDecorationState[]): void {
    if (!this.cakeBase) {
      return;
    }

    const metadata = this.getCakeMetadata();

    for (const state of states) {
      const object = state.object;
      const snapshot = { ...state.info } as SnapUserData;

      if (metadata) {
        snapshot.layerIndex = this.clampLayerIndex(snapshot.layerIndex, metadata);
      }

      object.userData['isSnapped'] = true;
      this.writeSnapInfo(object, snapshot);
      this.cakeBase.attach(object);
      this.enforceSnappedPosition(object);
    }
  }

  public clearSnapInfo(object: THREE.Object3D): void {
    delete object.userData['snapInfo'];
    object.userData['isSnapped'] = false;
  }

  private writeSnapInfo(object: THREE.Object3D, info: SnapUserData): void {
    object.userData['snapInfo'] = {
      ...info,
      normal: [...info.normal] as [number, number, number],
    };
  }

  private readSnapInfo(object: THREE.Object3D): SnapUserData | null {
    const data = object.userData['snapInfo'];
    if (!data) {
      return null;
    }

    const { layerIndex, surfaceType, normal, offset, roll } = data as Partial<SnapUserData>;
    if (
      typeof layerIndex !== 'number' ||
      (surfaceType !== 'TOP' && surfaceType !== 'SIDE') ||
      !Array.isArray(normal) ||
      normal.length !== 3 ||
      typeof offset !== 'number'
    ) {
      return null;
    }

    return {
      layerIndex,
      surfaceType,
      normal: [normal[0], normal[1], normal[2]],
      offset,
      roll: typeof roll === 'number' ? roll : 0,
    };
  }

  private findLayerInfo(layers: ScaledLayerInfo[], index: number): ScaledLayerInfo {
    const found = layers.find((layer) => layer.index === index);
    return (
      found ??
      layers[layers.length - 1] ?? {
        index: 0,
        bottom: -1,
        top: 1,
        radius: 1,
        halfWidth: 0.5,
        halfDepth: 0.5,
      }
    );
  }

  private normalizeRoll(angle: number): number {
    return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
  }

  private clampLayerIndex(index: number, metadata: CakeMetadata): number {
    const totalLayers = metadata.layerDimensions.length;
    if (totalLayers <= 0) {
      return 0;
    }

    const maxIndex = totalLayers - 1;
    return THREE.MathUtils.clamp(Math.round(index), 0, maxIndex);
  }

  private normalizeSnapInfo(info: SnapUserData, metadata: CakeMetadata): SnapUserData {
    const layerIndex = this.clampLayerIndex(info.layerIndex, metadata);
    const normal = new THREE.Vector3().fromArray(info.normal).normalize();
    const offset = Math.max(0, info.offset);
    const roll = this.normalizeRoll(info.roll ?? 0);

    return {
      layerIndex,
      surfaceType: info.surfaceType,
      normal: normal.toArray() as [number, number, number],
      offset,
      roll,
    };
  }

  private buildOrientationQuaternion(
    surfaceWorldNormal: THREE.Vector3,
    surfaceType: 'TOP' | 'SIDE',
  ): THREE.Quaternion {
    const forward = surfaceWorldNormal.clone();

    if (surfaceType === 'TOP') {
      forward.set(surfaceWorldNormal.x, 0, surfaceWorldNormal.z);
    }

    if (forward.lengthSq() < 1e-6) {
      forward.set(0, 0, 1);
    }

    forward.normalize();

    const up = new THREE.Vector3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(up, forward);

    if (right.lengthSq() < 1e-6) {
      right = new THREE.Vector3(1, 0, 0);
    }

    right.normalize();
    const adjustedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, adjustedUp, forward);
    return new THREE.Quaternion().setFromRotationMatrix(basis);
  }

  private projectPointToTopSurface(
    localPosition: THREE.Vector3,
    layer: ScaledLayerInfo,
    metadata: CakeMetadata,
    localNormal: THREE.Vector3,
    offset: number,
  ): { position: THREE.Vector3; normal: THREE.Vector3 } {
    if (metadata.shape === 'cylinder') {
      const radius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      const horizontal = new THREE.Vector3(localPosition.x, 0, localPosition.z);
      if (horizontal.lengthSq() > radius * radius && horizontal.lengthSq() > 1e-6) {
        horizontal.setLength(radius);
      }
      const basePoint = new THREE.Vector3(horizontal.x, layer.top, horizontal.z);
      const normal = new THREE.Vector3(0, 1, 0);
      const position = basePoint.add(normal.clone().multiplyScalar(offset));
      return { position, normal };
    }

    const halfWidth = layer.halfWidth ??
      (metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : 0.5);
    const halfDepth = layer.halfDepth ??
      (metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : 0.5);

    const clampedX = THREE.MathUtils.clamp(localPosition.x, -halfWidth, halfWidth);
    const clampedZ = THREE.MathUtils.clamp(localPosition.z, -halfDepth, halfDepth);
    const basePoint = new THREE.Vector3(clampedX, layer.top, clampedZ);
    const normal = new THREE.Vector3(0, 1, 0);
    const position = basePoint.add(normal.clone().multiplyScalar(offset));
    return { position, normal };
  }

  private projectPointToSideSurface(
    localPosition: THREE.Vector3,
    layer: ScaledLayerInfo,
    metadata: CakeMetadata,
    localNormal: THREE.Vector3,
    offset: number,
  ): { position: THREE.Vector3; normal: THREE.Vector3 } {
    let normal = localNormal.clone().normalize();
    const clampedY = THREE.MathUtils.clamp(localPosition.y, layer.bottom, layer.top);

    if (metadata.shape === 'cylinder') {
      const radius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      let direction = new THREE.Vector3(localPosition.x, 0, localPosition.z);
      if (direction.lengthSq() < 1e-6) {
        direction = new THREE.Vector3(normal.x, 0, normal.z);
      }
      if (direction.lengthSq() < 1e-6) {
        direction = new THREE.Vector3(1, 0, 0);
      }
      normal = direction.clone().normalize();
      const basePoint = new THREE.Vector3(normal.x * radius, clampedY, normal.z * radius);
      const position = basePoint.add(normal.clone().multiplyScalar(offset));
      return { position, normal };
    }

    const halfWidth = layer.halfWidth ??
      (metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : 0.5);
    const halfDepth = layer.halfDepth ??
      (metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : 0.5);

    const absNormalX = Math.abs(normal.x);
    const absNormalZ = Math.abs(normal.z);

    if (absNormalX >= absNormalZ) {
      const sign = normal.x >= 0 ? 1 : -1;
      normal = new THREE.Vector3(sign, 0, 0);
      const x = sign * halfWidth;
      const clampedZ = THREE.MathUtils.clamp(localPosition.z, -halfDepth, halfDepth);
      const basePoint = new THREE.Vector3(x, clampedY, clampedZ);
      const position = basePoint.add(normal.clone().multiplyScalar(offset));
      return { position, normal };
    }

    const sign = normal.z >= 0 ? 1 : -1;
    normal = new THREE.Vector3(0, 0, sign);
    const z = sign * halfDepth;
    const clampedX = THREE.MathUtils.clamp(localPosition.x, -halfWidth, halfWidth);
    const basePoint = new THREE.Vector3(clampedX, clampedY, z);
    const position = basePoint.add(normal.clone().multiplyScalar(offset));
    return { position, normal };
  }

  private applyOrientationForSurface(
    object: THREE.Object3D,
    surfaceWorldNormal: THREE.Vector3,
    surfaceType: 'TOP' | 'SIDE' | 'NONE',
    roll = 0,
  ): void {
    if (surfaceType === 'NONE') {
      return;
    }

    const quaternion = this.buildOrientationQuaternion(surfaceWorldNormal.clone(), surfaceType);
    object.quaternion.copy(quaternion);

    if (Math.abs(roll) > 1e-6) {
      const rollAxis = surfaceType === 'SIDE'
        ? surfaceWorldNormal.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      object.rotateOnWorldAxis(rollAxis, roll);
    }
  }

  private computeOffsetDistance(object: THREE.Object3D, normalWorld: THREE.Vector3): number {
    const boundingBox = new THREE.Box3().setFromObject(object);
    const center = boundingBox.getCenter(new THREE.Vector3());

    const vertices = [
      new THREE.Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
      new THREE.Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.max.z),
      new THREE.Vector3(boundingBox.min.x, boundingBox.max.y, boundingBox.min.z),
      new THREE.Vector3(boundingBox.min.x, boundingBox.max.y, boundingBox.max.z),
      new THREE.Vector3(boundingBox.max.x, boundingBox.min.y, boundingBox.min.z),
      new THREE.Vector3(boundingBox.max.x, boundingBox.min.y, boundingBox.max.z),
      new THREE.Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.min.z),
      new THREE.Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z),
    ];

    const normal = normalWorld.clone().normalize();
    let minProjection = Infinity;

    for (const vertex of vertices) {
      const projection = normal.dot(vertex.clone().sub(center));
      if (projection < minProjection) {
        minProjection = projection;
      }
    }

    if (!isFinite(minProjection)) {
      return 0.2;
    }

    return Math.max(0.1, -minProjection + 0.01);
  }

  private getWorldNormal(normalLocal: THREE.Vector3): THREE.Vector3 {
    if (!this.cakeBase) {
      return normalLocal.normalize();
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.cakeBase.matrixWorld);
    return normalLocal.applyMatrix3(normalMatrix).normalize();
  }
}

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SelectionService } from './selection.service';
import { ClosestPointInfo } from '../models/cake.points';
import { CakeMetadata } from '../factories/three-objects.factory';

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
  private readonly snapDistanceThreshold = 1.5;
  private readonly detachDistanceThreshold = 2.0;
  private readonly cakeSurfaceOffset = 0.05;

  private cakeBase: THREE.Object3D | null = null;
  private scene: THREE.Scene | null = null;

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

  private findLayerForY(layers: ScaledLayerInfo[], y: number): ScaledLayerInfo | null {
    if (!layers.length) {
      return null;
    }

    const epsilon = 1e-3;
    for (const layer of layers) {
      if (y >= layer.bottom - epsilon && y <= layer.top + epsilon) {
        return layer;
      }
    }

    return y < layers[0].bottom ? layers[0] : layers[layers.length - 1];
  }

  private getCakeMetadata(): CakeMetadata | undefined {
    return this.cakeBase?.userData['metadata'] as CakeMetadata | undefined;
  }

  constructor(private readonly selectionService: SelectionService) {}

  public setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  public setCakeBase(cake: THREE.Object3D | null): void {
    this.cakeBase = cake;
  }

  public getCakeBase(): THREE.Object3D | null {
    return this.cakeBase;
  }

  public checkProximityAndPotentialSnap(): void {
    const selectedObject = this.selectionService.getSelectedObject();

    if (!selectedObject || !this.cakeBase) {
      return;
    }

    const objectWorldPosition = selectedObject.getWorldPosition(new THREE.Vector3());
    const closestPointInfo = this.getClosestPointOnCake(objectWorldPosition);

    if (closestPointInfo.distance < this.snapDistanceThreshold) {
      // Placeholder for future visual feedback.
    }
  }

  public attemptSnapSelectionToCake(): void {
    const selectedObject = this.selectionService.getSelectedObject();

    if (!selectedObject || !this.cakeBase || selectedObject.userData['isSnapped']) {
      console.log('Nie można przyczepić:', {
        selected: !!selectedObject,
        cake: !!this.cakeBase,
        snapped: selectedObject?.userData['isSnapped'],
      });
      return;
    }

    const objectWorldPosition = selectedObject.getWorldPosition(new THREE.Vector3());
    const closestPointInfo = this.getClosestPointOnCake(objectWorldPosition);

    console.log('Próba przyczepienia, dystans:', closestPointInfo.distance, 'threshold:', this.snapDistanceThreshold);

    if (closestPointInfo.distance < this.snapDistanceThreshold && closestPointInfo.surfaceType !== 'NONE') {
      const decorationType = selectedObject.userData['decorationType'];

      if (
        (decorationType === 'TOP' && closestPointInfo.surfaceType === 'TOP') ||
        (decorationType === 'SIDE' && closestPointInfo.surfaceType === 'SIDE')
      ) {
        console.log(`Przyczepianie typu ${decorationType} do powierzchni ${closestPointInfo.surfaceType}`);
        this.snapObject(selectedObject, closestPointInfo);
      } else {
        console.log(
          `Typ dekoracji (${decorationType}) nie pasuje do typu powierzchni tortu (${closestPointInfo.surfaceType})`,
        );
      }
    } else {
      console.log('Za daleko od tortu lub nie znaleziono powierzchni.');
    }
  }

  public constrainMovement(): void {
    const selectedObject = this.selectionService.getSelectedObject();

    if (!selectedObject || !this.cakeBase || selectedObject.parent !== this.cakeBase) {
      return;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return;
    }

    const scale = this.cakeBase.scale;
    const halfHeight = (metadata.totalHeight * scale.y) / 2;
    const currentLocalPos = selectedObject.position;
    const maxPenetrationDepth = 0.5;
    const maxLiftOffDistance = 0.1;
    const scaledLayers = this.getScaledLayers(metadata);
    const topLayer = scaledLayers[scaledLayers.length - 1];
    const overallBottom = scaledLayers[0]?.bottom ?? -halfHeight;
    const overallTop = topLayer?.top ?? halfHeight;

    if (selectedObject.userData['decorationType'] === 'TOP') {
      if (metadata.shape === 'cylinder') {
        const cakeRadius = topLayer?.radius ?? (metadata.maxRadius ?? metadata.radius ?? 1) * scale.x;
        const distanceToCenter = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);

        if (distanceToCenter > cakeRadius) {
          const scaleFactor = cakeRadius / distanceToCenter;
          currentLocalPos.x *= scaleFactor;
          currentLocalPos.z *= scaleFactor;
        }

        currentLocalPos.y = THREE.MathUtils.clamp(
          currentLocalPos.y,
          (topLayer?.top ?? halfHeight) - maxPenetrationDepth,
          (topLayer?.top ?? halfHeight) + maxLiftOffDistance,
        );
      } else {
        const halfWidth = topLayer?.halfWidth ?? ((metadata.width ?? 1) / 2) * scale.x;
        const halfDepth = topLayer?.halfDepth ?? ((metadata.depth ?? 1) / 2) * scale.z;

        currentLocalPos.x = THREE.MathUtils.clamp(currentLocalPos.x, -halfWidth, halfWidth);
        currentLocalPos.z = THREE.MathUtils.clamp(currentLocalPos.z, -halfDepth, halfDepth);
        currentLocalPos.y = THREE.MathUtils.clamp(
          currentLocalPos.y,
          (topLayer?.top ?? halfHeight) - maxPenetrationDepth,
          (topLayer?.top ?? halfHeight) + maxLiftOffDistance,
        );
      }
    } else {
      if (metadata.shape === 'cylinder') {
        const activeLayer = this.findLayerForY(scaledLayers, currentLocalPos.y) ?? topLayer;
        const cakeRadius = activeLayer?.radius ?? (metadata.maxRadius ?? metadata.radius ?? 1) * scale.x;
        const currentObjectLocalRadius = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);
        const clampedRadius = THREE.MathUtils.clamp(
          currentObjectLocalRadius,
          cakeRadius - maxPenetrationDepth,
          cakeRadius + maxLiftOffDistance,
        );

        if (Math.abs(currentObjectLocalRadius - clampedRadius) > 0.001 && currentObjectLocalRadius > 0.001) {
          const radialScaleFactor = clampedRadius / currentObjectLocalRadius;
          currentLocalPos.x *= radialScaleFactor;
          currentLocalPos.z *= radialScaleFactor;
        }

        currentLocalPos.y = THREE.MathUtils.clamp(
          currentLocalPos.y,
          overallBottom + this.cakeSurfaceOffset,
          overallTop - this.cakeSurfaceOffset,
        );

        const normal = new THREE.Vector3(currentLocalPos.x, 0, currentLocalPos.z).normalize();
        if (normal.lengthSq() === 0) {
          normal.set(1, 0, 0);
        }

        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();
        const correctedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
        const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, normal);
        const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);
        const offsetQuaternion = selectedObject.userData['snapOffsetQuaternion'] || new THREE.Quaternion();
        selectedObject.quaternion.copy(baseQuaternion).multiply(offsetQuaternion);
      } else {
        const activeLayer = this.findLayerForY(scaledLayers, currentLocalPos.y) ?? topLayer;
        const halfWidth = activeLayer?.halfWidth ?? ((metadata.width ?? 1) / 2) * scale.x;
        const halfDepth = activeLayer?.halfDepth ?? ((metadata.depth ?? 1) / 2) * scale.z;
        const absX = Math.abs(currentLocalPos.x);
        const absZ = Math.abs(currentLocalPos.z);
        const normal = new THREE.Vector3();
        const normalizedX = halfWidth > 0 ? absX / halfWidth : 0;
        const normalizedZ = halfDepth > 0 ? absZ / halfDepth : 0;

        if (normalizedX >= normalizedZ) {
          const sign = absX < 1e-5 ? 1 : Math.sign(currentLocalPos.x);
          currentLocalPos.x = sign * halfWidth;
          currentLocalPos.z = THREE.MathUtils.clamp(currentLocalPos.z, -halfDepth, halfDepth);
          normal.set(sign, 0, 0);
        } else {
          const sign = absZ < 1e-5 ? 1 : Math.sign(currentLocalPos.z);
          currentLocalPos.z = sign * halfDepth;
          currentLocalPos.x = THREE.MathUtils.clamp(currentLocalPos.x, -halfWidth, halfWidth);
          normal.set(0, 0, sign);
        }

        currentLocalPos.y = THREE.MathUtils.clamp(
          currentLocalPos.y,
          overallBottom + this.cakeSurfaceOffset,
          overallTop - this.cakeSurfaceOffset,
        );

        if (normal.lengthSq() === 0) {
          normal.set(1, 0, 0);
        }

        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, normal).normalize();
        const correctedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
        const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, normal);
        const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);
        const offsetQuaternion = selectedObject.userData['snapOffsetQuaternion'] || new THREE.Quaternion();
        selectedObject.quaternion.copy(baseQuaternion).multiply(offsetQuaternion);
      }
    }
  }


  public checkDetachment(): void {
    const selectedObject = this.selectionService.getSelectedObject();

    if (!selectedObject || !this.cakeBase || !selectedObject.userData['isSnapped']) {
      return;
    }

    const currentWorldPos = selectedObject.getWorldPosition(new THREE.Vector3());
    const closestPointInfo = this.getClosestPointOnCake(currentWorldPos);

    if (closestPointInfo.distance > this.detachDistanceThreshold) {
      console.log('Odczepianie obiektu, dystans:', closestPointInfo.distance);
      this.detachObject(selectedObject);
    }
  }

  public detachObject(object: THREE.Object3D): void {
    if (!this.scene || object.parent !== this.cakeBase) {
      return;
    }

    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());

    this.scene.attach(object);
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);

    object.userData['isSnapped'] = false;
    console.log('Obiekt odczepiony:', object.name);
  }

  public updateSnapRotationOffset(object: THREE.Object3D): void {
    if (!object || !this.cakeBase || !object.userData['isSnapped'] || object.userData['decorationType'] !== 'SIDE') {
      return;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return;
    }

    const localPos = object.position;
    const objectQuaternion = object.quaternion;

    let baseNormal: THREE.Vector3;
    if (metadata.shape === 'cylinder') {
      baseNormal = new THREE.Vector3(localPos.x, 0, localPos.z).normalize();
      if (baseNormal.lengthSq() === 0) {
        baseNormal.set(1, 0, 0);
      }
    } else {
      const scale = this.cakeBase.scale;
      const scaledLayers = this.getScaledLayers(metadata);
      const activeLayer = this.findLayerForY(scaledLayers, localPos.y) ?? scaledLayers[scaledLayers.length - 1];
      const halfWidth = activeLayer?.halfWidth ?? ((metadata.width ?? 1) / 2) * scale.x;
      const halfDepth = activeLayer?.halfDepth ?? ((metadata.depth ?? 1) / 2) * scale.z;
      const absX = Math.abs(localPos.x);
      const absZ = Math.abs(localPos.z);
      const normalizedX = halfWidth > 0 ? absX / halfWidth : 0;
      const normalizedZ = halfDepth > 0 ? absZ / halfDepth : 0;

      if (normalizedX >= normalizedZ) {
        const sign = absX < 1e-5 ? 1 : Math.sign(localPos.x);
        baseNormal = new THREE.Vector3(sign, 0, 0);
      } else {
        const sign = absZ < 1e-5 ? 1 : Math.sign(localPos.z);
        baseNormal = new THREE.Vector3(0, 0, sign);
      }
    }

    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, baseNormal).normalize();
    const correctedUp = new THREE.Vector3().crossVectors(baseNormal, right).normalize();
    const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, baseNormal);
    const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);

    const offsetQuaternion = baseQuaternion.clone().invert().multiply(objectQuaternion);
    object.userData['snapOffsetQuaternion'] = offsetQuaternion;
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


  private snapObject(object: THREE.Object3D, closestPointInfo: ClosestPointInfo): void {
    if (!this.cakeBase) {
      return;
    }

    const { point, normal, surfaceType } = closestPointInfo;

    this.cakeBase.attach(object);

    const targetLocalPosition = point.clone();
    targetLocalPosition.addScaledVector(normal, this.cakeSurfaceOffset);
    object.position.copy(targetLocalPosition);

    const decorationType = object.userData['decorationType'];

    if (decorationType === 'SIDE') {
      const objectsOriginalQuaternion = object.quaternion.clone();
      const baseNormal = new THREE.Vector3(targetLocalPosition.x, 0, targetLocalPosition.z).normalize();
      if (baseNormal.lengthSq() === 0) {
        baseNormal.set(1, 0, 0);
      }
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, baseNormal).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(baseNormal, right).normalize();
      const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, baseNormal);
      const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);
      const offsetQuaternion = baseQuaternion.clone().invert().multiply(objectsOriginalQuaternion);
      object.userData['snapOffsetQuaternion'] = offsetQuaternion;
      object.quaternion.copy(baseQuaternion).multiply(offsetQuaternion);
    } else {
      object.userData['snapOffsetQuaternion'] = new THREE.Quaternion();
    }

    object.userData['isSnapped'] = true;
    object.userData['surfaceType'] = surfaceType;
    console.log('Obiekt przyczepiony, offset rotacji zapisany.', object.userData);
  }
}

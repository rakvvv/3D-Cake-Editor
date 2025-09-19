import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SelectionService } from './selection.service';
import { ClosestPointInfo } from '../models/cake.points';

@Injectable({
  providedIn: 'root',
})
export class SnapService {
  private readonly snapDistanceThreshold = 1.5;
  private readonly detachDistanceThreshold = 2.0;
  private readonly cakeSurfaceOffset = 0.05;

  private cakeBase: THREE.Object3D | null = null;
  private scene: THREE.Scene | null = null;

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

    const mesh = this.cakeBase as THREE.Mesh;
    const cakeParams = (mesh.geometry as THREE.CylinderGeometry).parameters;
    const cakeRadius = cakeParams.radiusTop;
    const cakeHeight = cakeParams.height;
    const halfHeight = cakeHeight / 2;

    const currentLocalPos = selectedObject.position;
    const maxPenetrationDepth = 0.5;
    const maxLiftOffDistance = 0.1;

    if (selectedObject.userData['decorationType'] === 'TOP') {
      const distanceToCenter = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);

      if (distanceToCenter > cakeRadius) {
        const scaleFactor = cakeRadius / distanceToCenter;
        currentLocalPos.x *= scaleFactor;
        currentLocalPos.z *= scaleFactor;
      }

      const cakeTopSurfaceY = cakeHeight / 2;
      currentLocalPos.y = THREE.MathUtils.clamp(
        currentLocalPos.y,
        cakeTopSurfaceY - maxPenetrationDepth,
        cakeTopSurfaceY + maxLiftOffDistance,
      );
    } else {
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

      const cakeMinY = -cakeHeight / 2;
      const cakeMaxY = cakeHeight / 2;
      currentLocalPos.y = THREE.MathUtils.clamp(
        currentLocalPos.y,
        cakeMinY + this.cakeSurfaceOffset,
        cakeMaxY - this.cakeSurfaceOffset,
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
    }

    selectedObject.position.copy(currentLocalPos);
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

    const localPos = object.position;
    const objectQuaternion = object.quaternion;

    const baseNormal = new THREE.Vector3(localPos.x, 0, localPos.z).normalize();
    if (baseNormal.lengthSq() === 0) {
      baseNormal.set(1, 0, 0);
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

    const localPoint = this.cakeBase.worldToLocal(worldPoint.clone());

    const mesh = this.cakeBase as THREE.Mesh;
    const cakeParams = (mesh.geometry as THREE.CylinderGeometry).parameters;

    const radius = cakeParams.radiusTop * this.cakeBase.scale.x;
    const height = cakeParams.height * this.cakeBase.scale.y;
    const halfHeight = height / 2;

    let closestPointLocal = new THREE.Vector3();
    let normalLocal = new THREE.Vector3();
    let distanceSq = Infinity;
    let surfaceType: 'TOP' | 'SIDE' | 'NONE' = 'NONE';

    const pointOnTopPlane = new THREE.Vector3(localPoint.x, halfHeight, localPoint.z);
    const distToCenterSq = pointOnTopPlane.x * pointOnTopPlane.x + pointOnTopPlane.z * pointOnTopPlane.z;
    if (distToCenterSq <= radius * radius) {
      const dSq = localPoint.distanceToSquared(pointOnTopPlane);
      if (dSq < distanceSq) {
        distanceSq = dSq;
        closestPointLocal.copy(pointOnTopPlane);
        normalLocal.set(0, 1, 0);
        surfaceType = 'TOP';
      }
    } else {
      const scaleFactor = radius / Math.sqrt(distToCenterSq);
      const edgePoint = new THREE.Vector3(localPoint.x * scaleFactor, halfHeight, localPoint.z * scaleFactor);
      const dSq = localPoint.distanceToSquared(edgePoint);
      if (dSq < distanceSq) {
        distanceSq = dSq;
        closestPointLocal.copy(edgePoint);
        normalLocal.set(edgePoint.x, 0, edgePoint.z).normalize();
        surfaceType = 'SIDE';
      }
    }

    const pointOnAxis = new THREE.Vector3(0, THREE.MathUtils.clamp(localPoint.y, -halfHeight, halfHeight), 0);
    const horizontalVec = new THREE.Vector3(localPoint.x, 0, localPoint.z);
    const distToAxis = horizontalVec.length();

    if (distToAxis > 0) {
      const pointOnSide = horizontalVec.setLength(radius).add(pointOnAxis);
      const dSq = localPoint.distanceToSquared(pointOnSide);

      if (dSq < distanceSq) {
        if (localPoint.y >= -halfHeight && localPoint.y <= halfHeight) {
          distanceSq = dSq;
          closestPointLocal.copy(pointOnSide);
          normalLocal.set(localPoint.x, 0, localPoint.z).normalize();
          surfaceType = 'SIDE';
        }
      }
    } else {
      const closestY = THREE.MathUtils.clamp(localPoint.y, -halfHeight, halfHeight);
      const pointOnSideIfAxis = new THREE.Vector3(radius, closestY, 0);
      const dSq = localPoint.distanceToSquared(pointOnSideIfAxis);
      if (dSq < distanceSq) {
        distanceSq = dSq;
        closestPointLocal.copy(pointOnSideIfAxis);
        normalLocal.set(1, 0, 0);
        surfaceType = 'SIDE';
      }
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

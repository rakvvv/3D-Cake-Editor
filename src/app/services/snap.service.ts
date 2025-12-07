import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { ClosestPointInfo } from '../models/cake.points';
import { CakeMetadata } from '../factories/three-objects.factory';
import { DecorationPlacementType } from '../models/decorationInfo';
import { DecorationValidationIssue } from '../models/decoration-validation';
import { AnchorPoint, AnchorSurfaceCoordinates } from '../models/anchors';

interface ScaledLayerInfo {
  index: number;
  bottom: number;
  top: number;
  radius?: number;
  halfWidth?: number;
  halfDepth?: number;
  topOffset?: number;
}

export interface SnapInfoSnapshot {
  layerIndex: number;
  surfaceType: 'TOP' | 'SIDE';
  normal: [number, number, number];
  offset: number;
  roll: number;
  rotation?: [number, number, number, number];
  coords?: SurfaceCoordinates;
}

export type SurfaceCoordinates = AnchorSurfaceCoordinates;

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
  private readonly maxEmbeddingDepth = Number.POSITIVE_INFINITY;

  private cakeBase: THREE.Object3D | null = null;
  private readonly identityRotation: [number, number, number, number] = [0, 0, 0, 1];

  public snapDecorationToCake(
    object: THREE.Object3D,
    preferredSurface?: 'TOP' | 'SIDE',
  ): {
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

    const allowedSurfaces = preferredSurface ? [preferredSurface] : undefined;
    const closestCandidate = this.getClosestPointForObject(object, allowedSurfaces);
    const closest = closestCandidate.info;

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

    object.updateMatrixWorld(true);

    const worldBounds = this.computeWorldBoundingBox(object);
    const pivotWorld = object.getWorldPosition(new THREE.Vector3());
    const anchorWorld = this.getAnchorPointForNormal(worldBounds, surfaceWorldNormal, object, pivotWorld);
    const anchorOffsetAlongNormal = surfaceWorldNormal.dot(anchorWorld.clone().sub(surfaceWorldPosition));
    const effectiveOffset = Math.max(0, -anchorOffsetAlongNormal);
    const anchorDelta = anchorWorld.clone().sub(pivotWorld);
    const finalWorldPosition = surfaceWorldPosition
      .clone()
      .add(surfaceWorldNormal.clone().multiplyScalar(effectiveOffset))
      .sub(anchorDelta);

    if (object.parent !== this.cakeBase) {
      this.cakeBase.attach(object);
    }

    const finalLocalPosition = this.cakeBase.worldToLocal(finalWorldPosition.clone());
    object.position.copy(finalLocalPosition);
    object.updateMatrixWorld(true);
    object.userData['isSnapped'] = true;

    const localNormal = closest.normal.clone().normalize();
    const rawOffsetDistance = finalLocalPosition.clone().sub(surfaceLocalPoint).dot(localNormal);
    const offsetDistance = Math.max(0, rawOffsetDistance);
    const layers = this.getScaledLayers(metadata);
    const layer = this.findLayerInfo(layers, closest.layerIndex);
    const coords = this.computeSurfaceCoordinates(surfaceLocalPoint, closest.surfaceType, layer, metadata);
    this.writeSnapInfo(object, {
      layerIndex: closest.layerIndex,
      surfaceType: closest.surfaceType,
      normal: localNormal.toArray(),
      offset: offsetDistance,
      roll: 0,
      rotation: [...this.identityRotation],
      coords,
    });

    if (!this.isPaintStroke(object)) {
      this.captureSnappedOrientation(object);
    }

    return {
      success: true,
      surfaceType: closest.surfaceType,
      message:
        closest.surfaceType === 'TOP'
          ? 'Dekoracja umieszczona na górnej powierzchni tortu.'
          : 'Dekoracja umieszczona na boku tortu.',
    };
  }

  public attachDecorationToAnchor(
    object: THREE.Object3D,
    anchor: AnchorPoint,
  ): void {
    if (!this.cakeBase) {
      console.warn('Brak tortu - nie można przypiąć do anchora.');
      return;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) return;

    // 1. Oblicz pozycję 3D (Lokalną względem tortu) na podstawie danych Anchora
    const projection = this.projectAnchor(anchor, metadata);

    if (!projection) {
      console.warn('Nie udało się obliczyć pozycji anchora.');
      return;
    }

    // 2. Dołącz obiekt do tortu (parenting), aby współrzędne lokalne działały poprawnie
    if (object.parent !== this.cakeBase) {
      this.cakeBase.attach(object);
    }

    // 3. Ustaw pozycję obiektu w wyliczonym miejscu
    object.position.copy(projection.position);
    object.updateMatrixWorld(true);

    // 4. WAŻNE: Zapisz dane SnapInfo "na sztywno" na podstawie Anchora.
    // Dzięki temu pomijamy zgadywanie "gdzie jest najbliżej".
    this.writeSnapInfo(object, {
      layerIndex: anchor.layerIndex,
      surfaceType: anchor.surface,
      normal: projection.normal.toArray(), // Normalna zwrócona z projekcji
      offset: 0, // Domyślnie na powierzchni (0 offsetu)
      roll: 0,
      rotation: [...this.identityRotation],
      coords: anchor.coordinates, // Przypisujemy dokładne koordynaty z anchora
    });

    object.userData['isSnapped'] = true;

    // 5. Ustaw orientację (obrót) dekoracji, aby przylegała do powierzchni
    // Używamy normalnej wyliczonej z Anchora, a nie szukanej raycastem
    const worldNormal = this.getWorldNormal(projection.normal);
    this.applyOrientationForSurface(object, worldNormal, anchor.surface);

    // Opcjonalnie: zastosuj domyślny obrót z anchora jeśli istnieje
    if (anchor.defaultRotationDeg) {
      this.rotateDecorationByDegrees(object, anchor.defaultRotationDeg);
    }
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

    const closestCandidate = this.getClosestPointForObject(object);
    const closest = closestCandidate.info;

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
          rotation: [...this.identityRotation],
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
    return metadata.layerDimensions.map((layer, index, all) => ({
      index: layer.index,
      bottom: layer.bottomY,
      top: layer.topY,
      topOffset: index === all.length - 1 ? metadata.glazeTopOffset ?? 0 : 0,
      radius: layer.radius,
      halfWidth: layer.width !== undefined ? layer.width / 2 : undefined,
      halfDepth: layer.depth !== undefined ? layer.depth / 2 : undefined,
    }));
  }

  private getCakeMetadata(): CakeMetadata | undefined {
    return this.cakeBase?.userData['metadata'] as CakeMetadata | undefined;
  }

  private isPaintStroke(object: THREE.Object3D): boolean {
    return object.userData['isPaintStroke'] === true;
  }

  public setCakeBase(cake: THREE.Object3D | null): void {
    this.cakeBase = cake;
  }

  public getCakeBase(): THREE.Object3D | null {
    return this.cakeBase;
  }

  public getCakeMetadataSnapshot(): CakeMetadata | null {
    return this.getCakeMetadata() ?? null;
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

  public projectAnchor(
    anchor: AnchorPoint,
    metadata: CakeMetadata,
  ): { position: THREE.Vector3; normal: THREE.Vector3 } | null {
    const layers = this.getScaledLayers(metadata);
    const layer = this.findLayerInfo(layers, anchor.layerIndex);
    const coords = this.normalizeSurfaceCoordinates(anchor.coordinates, metadata) ?? anchor.coordinates;
    const safeAngle = coords.angleRad ?? 0;
    const layerIndex = this.clampLayerIndex(anchor.layerIndex, metadata);

    const localNormal = anchor.surface === 'TOP'
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(Math.cos(safeAngle), 0, Math.sin(safeAngle)).normalize();

    const projection = this.buildProjectionFromSnap(
      {
        layerIndex,
        surfaceType: anchor.surface,
        normal: localNormal.toArray() as [number, number, number],
        offset: 0,
        roll: 0,
        coords,
      },
      layer,
      metadata,
      localNormal,
    );

    if (!projection) {
      return null;
    }

    return { position: projection.position, normal: projection.normal };
  }

  public buildAnchorFromDecoration(
    object: THREE.Object3D,
    metadata: CakeMetadata,
    id: string,
    label?: string,
  ): AnchorPoint | null {
    if (!object.userData['isSnapped']) {
      return null;
    }

    const snapInfo = this.readSnapInfo(object);
    if (!snapInfo) {
      return null;
    }

    const normalized = this.normalizeSnapInfo(snapInfo, metadata);
    const layers = this.getScaledLayers(metadata);
    const layer = this.findLayerInfo(layers, normalized.layerIndex);

    const localNormal = new THREE.Vector3().fromArray(normalized.normal).normalize();
    const projection = this.buildProjectionFromSnap(normalized, layer, metadata, localNormal);

    const derivedCoords = projection
      ? this.computeSurfaceCoordinates(projection.position, normalized.surfaceType, layer, metadata)
      : undefined;
    const baseCoords = normalized.coords ?? derivedCoords;
    const coords = baseCoords && derivedCoords ? { ...derivedCoords, ...baseCoords } : baseCoords;

    const rotationDeg = Math.round(THREE.MathUtils.radToDeg(normalized.roll) * 1000) / 1000;
    const averageScale = (object.scale.x + object.scale.y + object.scale.z) / 3;
    const decorationId = (object.userData['modelFileName'] as string | undefined) ?? undefined;

    return {
      id,
      label,
      surface: normalized.surfaceType,
      layerIndex: normalized.layerIndex,
      coordinates: coords ?? { angleRad: 0 },
      defaultRotationDeg: rotationDeg,
      defaultScale: Math.round(averageScale * 1000) / 1000,
      allowedDecorationIds: decorationId ? [decorationId] : undefined,
    };
  }

  private getClosestPointForObject(
    object: THREE.Object3D,
    allowedSurfaces?: Array<'TOP' | 'SIDE'>,
  ): { info: ClosestPointInfo; worldPoint: THREE.Vector3 } {
    const pivotWorld = object.getWorldPosition(new THREE.Vector3());
    let bestInfo = this.getClosestPointOnCake(pivotWorld);
    if (allowedSurfaces && bestInfo.surfaceType !== 'NONE' && !allowedSurfaces.includes(bestInfo.surfaceType)) {
      bestInfo = { ...bestInfo, surfaceType: 'NONE' };
    }
    let bestWorldPoint = pivotWorld.clone();

    const snapPoints = this.extractSnapPoints(object);
    for (const snapPoint of snapPoints) {
      const info = this.getClosestPointOnCake(snapPoint);
      if (allowedSurfaces && info.surfaceType !== 'NONE' && !allowedSurfaces.includes(info.surfaceType)) {
        continue;
      }
      if (info.surfaceType !== 'NONE' && info.distance < bestInfo.distance) {
        bestInfo = info;
        bestWorldPoint = snapPoint.clone();
      }
    }

    const box = this.computeWorldBoundingBox(object);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const corners = this.getBoxCorners(box);
      const candidates = [...corners, center];

      for (const candidate of candidates) {
        const info = this.getClosestPointOnCake(candidate);
        if (allowedSurfaces && info.surfaceType !== 'NONE' && !allowedSurfaces.includes(info.surfaceType)) {
          continue;
        }
        if (info.surfaceType !== 'NONE' && info.distance < bestInfo.distance) {
          bestInfo = info;
          bestWorldPoint = candidate.clone();
        }
      }
    }

    return { info: bestInfo, worldPoint: bestWorldPoint };
  }

  private extractSnapPoints(object: THREE.Object3D): THREE.Vector3[] {
    const raw = object.userData['snapPoints'];
    if (!Array.isArray(raw)) {
      return [];
    }

    const points: THREE.Vector3[] = [];
    for (const entry of raw) {
      if (entry instanceof THREE.Vector3) {
        if (Number.isFinite(entry.x) && Number.isFinite(entry.y) && Number.isFinite(entry.z)) {
          points.push(entry.clone());
        }
        continue;
      }

      if (Array.isArray(entry) && entry.length === 3) {
        const [x, y, z] = entry;
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          points.push(new THREE.Vector3(x, y, z));
        }
      }
    }

    return points;
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
        const topOffset = layer.topOffset ?? 0;
        const topY = layer.top + topOffset;
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
        const topOffset = layer.topOffset ?? 0;
        const topY = layer.top + topOffset;
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

    return ['TOP', 'SIDE'];
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

    this.updateSnapFromObjectPosition(object, true);
    snapInfo = this.readSnapInfo(object);
    if (!snapInfo) {
      return;
    }

    snapInfo = this.normalizeSnapInfo(snapInfo, metadata);
    this.writeSnapInfo(object, snapInfo);

    const localNormal = new THREE.Vector3().fromArray(snapInfo.normal).normalize();
    const layers = this.getScaledLayers(metadata);
    const layer = this.findLayerInfo(layers, snapInfo.layerIndex);

    const storedProjection = this.buildProjectionFromSnap(snapInfo, layer, metadata, localNormal);
    const outwardLimit = snapInfo.surfaceType === 'TOP' ? 0.35 : 0.25;

    let projectionBase = storedProjection;
    let clampedOffset = THREE.MathUtils.clamp(snapInfo.offset ?? 0, -this.maxEmbeddingDepth, outwardLimit);

    if (!projectionBase) {
      const desiredWorldPosition = object.getWorldPosition(new THREE.Vector3());
      const desiredLocalPosition = this.cakeBase.worldToLocal(desiredWorldPosition.clone());

      projectionBase =
        snapInfo.surfaceType === 'TOP'
          ? this.projectPointToTopSurface(desiredLocalPosition, layer, metadata, localNormal, 0)
          : this.projectPointToSideSurface(desiredLocalPosition, layer, metadata, localNormal, 0);

      const userOffset = desiredLocalPosition.clone().sub(projectionBase.position).dot(projectionBase.normal);
      clampedOffset = THREE.MathUtils.clamp(userOffset, -this.maxEmbeddingDepth, outwardLimit);
    }

    let finalPosition = projectionBase.position.clone().add(projectionBase.normal.clone().multiplyScalar(clampedOffset));

    if (snapInfo.surfaceType === 'TOP') {
      const bottomLayer = metadata.layerDimensions[0];
      const minimumY = bottomLayer?.bottomY ?? -metadata.totalHeight / 2;
      if (finalPosition.y < minimumY) {
        finalPosition = new THREE.Vector3(finalPosition.x, minimumY, finalPosition.z);
      }
    }

    if (snapInfo.surfaceType === 'SIDE') {
      const outwardMargin = 0.06;
      if (metadata.shape === 'cylinder') {
        const layerRadius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
        const maxRadius = layerRadius + outwardMargin;
        const radialLength = Math.sqrt(finalPosition.x * finalPosition.x + finalPosition.z * finalPosition.z);
        if (radialLength > maxRadius && radialLength > 1e-6) {
          const scale = maxRadius / radialLength;
          finalPosition = new THREE.Vector3(finalPosition.x * scale, finalPosition.y, finalPosition.z * scale);
        }
      } else {
        const halfWidth = layer.halfWidth ?? (metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : 0.5);
        const halfDepth = layer.halfDepth ?? (metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : 0.5);
        const maxX = halfWidth + outwardMargin;
        const maxZ = halfDepth + outwardMargin;
        const clampedX = THREE.MathUtils.clamp(finalPosition.x, -maxX, maxX);
        const clampedZ = THREE.MathUtils.clamp(finalPosition.z, -maxZ, maxZ);
        finalPosition = new THREE.Vector3(clampedX, finalPosition.y, clampedZ);
      }
    }

    object.position.copy(finalPosition);
    object.updateMatrixWorld(true);

    const worldNormal = this.getWorldNormal(projectionBase.normal.clone());
    const updatedInfo: SnapUserData = {
      ...snapInfo,
      offset: clampedOffset,
      normal: projectionBase.normal.clone().normalize().toArray(),
    };
    this.writeSnapInfo(object, updatedInfo);
    if (!this.isPaintStroke(object)) {
      const relativeRotation = this.getRelativeQuaternion(updatedInfo, projectionBase.normal.clone());
      this.applyOrientationForSurface(
        object,
        worldNormal,
        snapInfo.surfaceType,
        updatedInfo.roll ?? 0,
        relativeRotation,
      );
      object.updateMatrixWorld(true);
    }
  }

  public updateSnapFromObjectPosition(object: THREE.Object3D, skipClamp = false): void {
    if (!object.userData['isSnapped'] || !this.cakeBase) {
      return;
    }

    const metadata = this.getCakeMetadata();
    if (!metadata) {
      return;
    }

    const snapInfo = this.readSnapInfo(object);
    if (!snapInfo) {
      return;
    }

    const normalizedInfo = this.normalizeSnapInfo(snapInfo, metadata);
    const layers = this.getScaledLayers(metadata);
    const layer = this.findLayerInfo(layers, normalizedInfo.layerIndex);
    const localNormal = new THREE.Vector3().fromArray(normalizedInfo.normal).normalize();
    const localPosition = this.cakeBase.worldToLocal(object.getWorldPosition(new THREE.Vector3()));

    const projection =
      normalizedInfo.surfaceType === 'TOP'
        ? this.projectPointToTopSurface(localPosition, layer, metadata, localNormal, 0)
        : this.projectPointToSideSurface(localPosition, layer, metadata, localNormal, 0);

    const userOffset = localPosition.clone().sub(projection.position).dot(projection.normal);
    const coords = this.computeSurfaceCoordinates(
      projection.position.clone(),
      normalizedInfo.surfaceType,
      layer,
      metadata,
    );

    const updated: SnapUserData = {
      ...normalizedInfo,
      offset: skipClamp ? userOffset : THREE.MathUtils.clamp(userOffset, -this.maxEmbeddingDepth, Infinity),
      coords,
    };

    this.writeSnapInfo(object, updated);
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

  public rotateDecorationByDegrees(
    object: THREE.Object3D,
    degrees: number,
  ): { success: boolean; message: string } {
    const radians = THREE.MathUtils.degToRad(degrees);
    const rounded = Math.round(degrees * 100) / 100;
    const message = `Dekoracja została obrócona o ${rounded}°.`;
    return this.rotateDecorationByAngle(object, radians, message);
  }

  private rotateDecorationByAngle(
    object: THREE.Object3D,
    angle: number,
    message: string,
  ): { success: boolean; message: string } {
    const snapInfo = this.readSnapInfo(object);
    if (snapInfo && object.userData['isSnapped'] && this.cakeBase) {
      const localNormal = new THREE.Vector3().fromArray(snapInfo.normal).normalize();
      const rotation = this.getRelativeQuaternion(snapInfo, localNormal.clone());
      const axis = snapInfo.surfaceType === 'SIDE'
        ? localNormal.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      const combined = rotation.clone().multiply(delta).normalize();
      const roll = this.computeRollFromQuaternion(combined, snapInfo.surfaceType, localNormal.clone());

      const updatedInfo: SnapUserData = {
        ...snapInfo,
        roll,
        rotation: this.serializeQuaternion(combined),
      };
      this.writeSnapInfo(object, updatedInfo);

      const worldNormal = this.getWorldNormal(localNormal.clone());
      this.applyOrientationForSurface(
        object,
        worldNormal,
        updatedInfo.surfaceType,
        updatedInfo.roll,
        combined,
      );
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
      rotation: [...this.identityRotation],
    };
    this.writeSnapInfo(object, updatedInfo);

    const normal = new THREE.Vector3().fromArray(updatedInfo.normal).normalize();
    const worldNormal = this.getWorldNormal(normal.clone());
    this.applyOrientationForSurface(
      object,
      worldNormal,
      updatedInfo.surfaceType,
      0,
      new THREE.Quaternion(),
    );
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
    const relative = baseQuaternion.clone().invert().multiply(currentQuaternion).normalize();

    const roll = this.computeRollFromQuaternion(relative, normalizedInfo.surfaceType, localNormal.clone());
    const rotationArray = this.serializeQuaternion(relative);

    const updatedInfo: SnapUserData = {
      ...normalizedInfo,
      roll,
      rotation: rotationArray,
    };

    this.writeSnapInfo(object, updatedInfo);
    this.applyOrientationForSurface(object, worldNormal, updatedInfo.surfaceType, roll, relative);
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
          rotation: info.rotation ? [...info.rotation] as [number, number, number, number] : undefined,
        },
      });
    }

    return states;
  }

  public getSnapInfoSnapshot(object: THREE.Object3D): SnapInfoSnapshot | null {
    const info = this.readSnapInfo(object);
    if (!info) {
      return null;
    }

    return {
      layerIndex: info.layerIndex,
      surfaceType: info.surfaceType,
      normal: [info.normal[0], info.normal[1], info.normal[2]],
      offset: info.offset,
      roll: info.roll,
      rotation: info.rotation ? [info.rotation[0], info.rotation[1], info.rotation[2], info.rotation[3]] : undefined,
      coords: info.coords ? { ...info.coords } : undefined,
    };
  }

  public restoreSnappedDecorations(states: SnappedDecorationState[]): void {
    if (!this.cakeBase) {
      return;
    }

    const metadata = this.getCakeMetadata();

    for (const state of states) {
      const object = state.object;
      const snapshot = metadata
        ? this.normalizeSnapInfo({ ...state.info } as SnapUserData, metadata)
        : ({ ...state.info } as SnapUserData);

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
      rotation: info.rotation ? [...info.rotation] as [number, number, number, number] : undefined,
      coords: info.coords ? { ...info.coords } : undefined,
    };
  }

  private readSnapInfo(object: THREE.Object3D): SnapUserData | null {
    const data = object.userData['snapInfo'];
    if (!data) {
      return null;
    }

    const { layerIndex, surfaceType, normal, offset, roll, rotation, coords } = data as Partial<SnapUserData>;
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
      coords: coords ? { ...coords } : undefined,
      rotation: Array.isArray(rotation) && rotation.length === 4
        ? [rotation[0], rotation[1], rotation[2], rotation[3]]
        : undefined,
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

  private clampLayerIndex(index: number, metadata: CakeMetadata): number {
    const totalLayers = metadata.layerDimensions.length;
    if (totalLayers <= 0) {
      return 0;
    }

    const maxIndex = totalLayers - 1;
    return THREE.MathUtils.clamp(Math.round(index), 0, maxIndex);
  }

  private normalizeRoll(angle: number): number {
    return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
  }

  private normalizeAngle(angle: number): number {
    return THREE.MathUtils.euclideanModulo(angle, Math.PI * 2);
  }

  private normalizeSnapInfo(info: SnapUserData, metadata: CakeMetadata): SnapUserData {
    const layerIndex = this.clampLayerIndex(info.layerIndex, metadata);
    const normal = new THREE.Vector3().fromArray(info.normal).normalize();
    const offset = THREE.MathUtils.clamp(info.offset ?? 0, -this.maxEmbeddingDepth, Infinity);
    const surfaceType = info.surfaceType;
    const coords = this.normalizeSurfaceCoordinates(info.coords, metadata);

    const { quaternion, roll } = this.sanitizeRotation(info, surfaceType, normal.clone());

    return {
      layerIndex,
      surfaceType,
      normal: normal.toArray() as [number, number, number],
      offset,
      roll,
      coords,
      rotation: this.serializeQuaternion(quaternion),
    };
  }

  private sanitizeRotation(
    info: SnapUserData,
    surfaceType: 'TOP' | 'SIDE',
    normal: THREE.Vector3,
  ): { quaternion: THREE.Quaternion; roll: number } {
    let quaternion: THREE.Quaternion | null = null;

    if (info.rotation && info.rotation.length === 4) {
      const candidate = new THREE.Quaternion(info.rotation[0], info.rotation[1], info.rotation[2], info.rotation[3]);
      if (
        candidate.lengthSq() > 1e-10 &&
        Number.isFinite(candidate.x) &&
        Number.isFinite(candidate.y) &&
        Number.isFinite(candidate.z) &&
        Number.isFinite(candidate.w)
      ) {
        quaternion = candidate.normalize();
      }
    }

    if (!quaternion) {
      const axis = surfaceType === 'SIDE' ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const roll = this.normalizeRoll(info.roll ?? 0);
      return {
        quaternion: new THREE.Quaternion().setFromAxisAngle(axis, roll),
        roll,
      };
    }

    const roll = this.computeRollFromQuaternion(quaternion, surfaceType, normal.clone());
    return { quaternion, roll };
  }

  private serializeQuaternion(quaternion: THREE.Quaternion): [number, number, number, number] {
    const normalized = quaternion.clone().normalize();
    return [normalized.x, normalized.y, normalized.z, normalized.w];
  }

  private getRelativeQuaternion(info: SnapUserData, localNormal: THREE.Vector3): THREE.Quaternion {
    if (info.rotation && info.rotation.length === 4) {
      const candidate = new THREE.Quaternion(info.rotation[0], info.rotation[1], info.rotation[2], info.rotation[3]);
      if (candidate.lengthSq() > 1e-10) {
        return candidate.normalize();
      }
    }

    const axis = info.surfaceType === 'SIDE' ? localNormal.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const roll = this.normalizeRoll(info.roll ?? 0);
    return new THREE.Quaternion().setFromAxisAngle(axis, roll);
  }

  private computeRollFromQuaternion(
    quaternion: THREE.Quaternion,
    surfaceType: 'TOP' | 'SIDE',
    localNormal: THREE.Vector3,
  ): number {
    const normalized = quaternion.clone().normalize();
    const sinHalf = Math.sqrt(normalized.x * normalized.x + normalized.y * normalized.y + normalized.z * normalized.z);

    if (sinHalf < 1e-6) {
      return 0;
    }

    const angle = 2 * Math.atan2(sinHalf, normalized.w);
    if (!Number.isFinite(angle)) {
      return 0;
    }

    const axis = sinHalf < 1e-6
      ? surfaceType === 'SIDE'
        ? localNormal.clone().normalize()
        : new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(normalized.x, normalized.y, normalized.z).normalize();

    const allowedAxis = surfaceType === 'SIDE'
      ? localNormal.clone().normalize()
      : new THREE.Vector3(0, 1, 0);

    const projection = THREE.MathUtils.clamp(axis.dot(allowedAxis), -1, 1);
    if (Math.abs(projection) < 1e-6) {
      return 0;
    }

    const signedAngle = angle * projection;
    return this.normalizeRoll(signedAngle);
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

  private computeSurfaceCoordinates(
    localPoint: THREE.Vector3,
    surfaceType: 'TOP' | 'SIDE',
    layer: ScaledLayerInfo,
    metadata: CakeMetadata,
  ): SurfaceCoordinates {
    const angleRad = Math.atan2(localPoint.z, localPoint.x);

    if (metadata.shape === 'cylinder') {
      const radius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      const radiusNorm = radius > 1e-6 ? localPoint.clone().setY(0).length() / radius : 0;
      const heightSpan = layer.top + (layer.topOffset ?? 0) - layer.bottom;
      const heightNorm = heightSpan > 1e-6 ? (localPoint.y - layer.bottom) / heightSpan : 0.5;

      if (surfaceType === 'TOP') {
        return { angleRad, radiusNorm, heightNorm };
      }

      return { angleRad, radiusNorm: 1, heightNorm };
    }

    const halfWidth = layer.halfWidth ?? (metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : 0.5);
    const halfDepth = layer.halfDepth ?? (metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : 0.5);
    const xNorm = halfWidth > 1e-6 ? localPoint.x / halfWidth : 0;
    const zNorm = halfDepth > 1e-6 ? localPoint.z / halfDepth : 0;
    const heightSpan = layer.top + (layer.topOffset ?? 0) - layer.bottom;
    const heightNorm = heightSpan > 1e-6 ? (localPoint.y - layer.bottom) / heightSpan : 0.5;

    if (surfaceType === 'TOP') {
      return { angleRad, xNorm, zNorm, heightNorm };
    }

    return { angleRad, xNorm, zNorm, heightNorm };
  }

  private normalizeSurfaceCoordinates(
    coords: SurfaceCoordinates | undefined,
    metadata: CakeMetadata,
  ): SurfaceCoordinates | undefined {
    if (!coords) {
      return undefined;
    }

    const angle = this.normalizeAngle(coords.angleRad);
    const radiusNorm = coords.radiusNorm !== undefined ? THREE.MathUtils.clamp(coords.radiusNorm, 0, 4) : undefined;
    const heightNorm = coords.heightNorm !== undefined ? THREE.MathUtils.clamp(coords.heightNorm, -0.25, 1.25) : undefined;
    const xNorm = coords.xNorm !== undefined ? THREE.MathUtils.clamp(coords.xNorm, -4, 4) : undefined;
    const zNorm = coords.zNorm !== undefined ? THREE.MathUtils.clamp(coords.zNorm, -4, 4) : undefined;

    return { angleRad: angle, radiusNorm, heightNorm, xNorm, zNorm };
  }

  private buildProjectionFromSnap(
    snapInfo: SnapUserData,
    layer: ScaledLayerInfo,
    metadata: CakeMetadata,
    localNormal: THREE.Vector3,
  ): { position: THREE.Vector3; normal: THREE.Vector3 } | null {
    const coords = snapInfo.coords;
    if (!coords) {
      return null;
    }

    const topHeight = layer.top + (layer.topOffset ?? 0);
    const normalFromAngle = new THREE.Vector3(Math.cos(coords.angleRad), 0, Math.sin(coords.angleRad)).normalize();

    if (metadata.shape === 'cylinder') {
      const radius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      if (snapInfo.surfaceType === 'TOP') {
        const radial = coords.radiusNorm !== undefined ? radius * coords.radiusNorm : radius;
        const heightSpan = topHeight - layer.bottom;
        const heightNorm = coords.heightNorm !== undefined ? coords.heightNorm : 1;
        const clampedHeight = THREE.MathUtils.clamp(heightNorm, -0.25, 1.25);
        const y = layer.bottom + clampedHeight * heightSpan;
        const position = new THREE.Vector3(normalFromAngle.x * radial, y, normalFromAngle.z * radial);
        const normal = new THREE.Vector3(0, 1, 0);
        return { position, normal };
      }

      const heightSpan = topHeight - layer.bottom;
      const heightNorm = coords.heightNorm !== undefined ? coords.heightNorm : 0.5;
      const clampedHeight = THREE.MathUtils.clamp(heightNorm, -0.25, 1.25);
      const y = layer.bottom + clampedHeight * heightSpan;
      const radial = coords.radiusNorm !== undefined ? radius * coords.radiusNorm : radius;
      const position = new THREE.Vector3(normalFromAngle.x * radial, y, normalFromAngle.z * radial);
      const normal = normalFromAngle.clone();
      return { position, normal };
    }

    const halfWidth = layer.halfWidth ?? (metadata.maxWidth ? metadata.maxWidth / 2 : metadata.width ? metadata.width / 2 : 0.5);
    const halfDepth = layer.halfDepth ?? (metadata.maxDepth ? metadata.maxDepth / 2 : metadata.depth ? metadata.depth / 2 : 0.5);

    if (snapInfo.surfaceType === 'TOP') {
      const radialFactor = coords.radiusNorm ?? 1;
      const radialX = Math.cos(coords.angleRad) * radialFactor;
      const radialZ = Math.sin(coords.angleRad) * radialFactor;
      const x = (coords.xNorm ?? radialX) * halfWidth;
      const z = (coords.zNorm ?? radialZ) * halfDepth;
      const heightSpan = topHeight - layer.bottom;
      const heightNorm = coords.heightNorm !== undefined ? coords.heightNorm : 1;
      const clampedHeight = THREE.MathUtils.clamp(heightNorm, -0.25, 1.25);
      const y = layer.bottom + clampedHeight * heightSpan;
      const position = new THREE.Vector3(x, y, z);
      const normal = new THREE.Vector3(0, 1, 0);
      return { position, normal };
    }

    const heightSpan = topHeight - layer.bottom;
    const heightNorm = coords.heightNorm !== undefined ? coords.heightNorm : 0.5;
    const clampedHeight = THREE.MathUtils.clamp(heightNorm, -0.25, 1.25);
    const y = layer.bottom + clampedHeight * heightSpan;

    const dominantAxis = Math.abs(localNormal.x) >= Math.abs(localNormal.z) ? 'x' : 'z';
    let position: THREE.Vector3;
    let normal: THREE.Vector3;
    const radiusFactor = coords.radiusNorm ?? 1;

    if (dominantAxis === 'x') {
      const sign = Math.sign(localNormal.x) || 1;
      position = new THREE.Vector3(sign * halfWidth * radiusFactor, y, (coords.zNorm ?? 0) * halfDepth);
      normal = new THREE.Vector3(sign, 0, 0);
    } else {
      const sign = Math.sign(localNormal.z) || 1;
      position = new THREE.Vector3((coords.xNorm ?? 0) * halfWidth, y, sign * halfDepth * radiusFactor);
      normal = new THREE.Vector3(0, 0, sign);
    }

    return { position, normal };
  }

  private projectPointToTopSurface(
    localPosition: THREE.Vector3,
    layer: ScaledLayerInfo,
    metadata: CakeMetadata,
    localNormal: THREE.Vector3,
    offset: number,
  ): { position: THREE.Vector3; normal: THREE.Vector3 } {
    const topHeight = layer.top + (layer.topOffset ?? 0);

    if (metadata.shape === 'cylinder') {
      const radius = layer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      const horizontal = new THREE.Vector3(localPosition.x, 0, localPosition.z);
      if (horizontal.lengthSq() > radius * radius && horizontal.lengthSq() > 1e-6) {
        horizontal.setLength(radius);
      }
      const basePoint = new THREE.Vector3(horizontal.x, topHeight, horizontal.z);
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
    const basePoint = new THREE.Vector3(clampedX, topHeight, clampedZ);
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
    relativeRotation?: THREE.Quaternion,
  ): void {
    if (surfaceType === 'NONE') {
      return;
    }

    const baseQuaternion = this.buildOrientationQuaternion(surfaceWorldNormal.clone(), surfaceType);

    if (relativeRotation) {
      const combined = baseQuaternion.clone().multiply(relativeRotation.clone().normalize());
      object.quaternion.copy(combined);
      return;
    }

    object.quaternion.copy(baseQuaternion);

    if (Math.abs(roll) > 1e-6) {
      const rollAxis = surfaceType === 'SIDE'
        ? surfaceWorldNormal.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      object.rotateOnWorldAxis(rollAxis, roll);
    }
  }

  private computeWorldBoundingBox(object: THREE.Object3D): THREE.Box3 {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tempBox = new THREE.Box3();
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();

    object.traverse((child) => {
      if ((child as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = child as THREE.InstancedMesh;
        const geometry = instanced.geometry;
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        if (!geometry.boundingBox) {
          return;
        }

        for (let i = 0; i < instanced.count; i++) {
          instanced.getMatrixAt(i, instanceMatrix);
          worldMatrix.multiplyMatrices(instanced.matrixWorld, instanceMatrix);
          tempBox.copy(geometry.boundingBox).applyMatrix4(worldMatrix);
          box.union(tempBox);
        }
        return;
      }

      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const geometry = mesh.geometry;
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        if (!geometry.boundingBox) {
          return;
        }

        tempBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        box.union(tempBox);
      }
    });

    return box;
  }

  private getAnchorPointForNormal(
    worldBounds: THREE.Box3,
    normalWorld: THREE.Vector3,
    object: THREE.Object3D,
    fallback: THREE.Vector3,
  ): THREE.Vector3 {
    if (worldBounds.isEmpty()) {
      return fallback.clone();
    }

    const normal = normalWorld.clone().normalize();
    const corners = this.getBoxCorners(worldBounds);
    let bestCorner = corners[0];
    let bestProjection = normal.dot(corners[0]);

    for (let i = 1; i < corners.length; i++) {
      const projection = normal.dot(corners[i]);
      if (projection < bestProjection) {
        bestProjection = projection;
        bestCorner = corners[i];
      }
    }

    if (!bestCorner) {
      return fallback.clone();
    }

    // Preserve local offsets for instanced/attached objects by converting back to world space anchor
    object.updateMatrixWorld(true);
    return bestCorner.clone();
  }

  private getBoxCorners(box: THREE.Box3): THREE.Vector3[] {
    return [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
  }

  private getWorldNormal(normalLocal: THREE.Vector3): THREE.Vector3 {
    if (!this.cakeBase) {
      return normalLocal.normalize();
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.cakeBase.matrixWorld);
    return normalLocal.applyMatrix3(normalMatrix).normalize();
  }
}

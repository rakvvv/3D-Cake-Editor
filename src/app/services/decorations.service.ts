import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { TransformControlsService } from './transform-controls-service';
import { DecorationFactory } from '../factories/decoration.factory';
import { CakeMetadata } from '../factories/three-objects.factory';
import { DecorationInfo } from '../models/decorationInfo';
import { SnapService } from './snap.service';

@Injectable({ providedIn: 'root' })
export class DecorationsService {
  private decorationsInfo: Map<string, DecorationInfo> = new Map();
  private decorations: DecorationInfo[] = [];
  private readonly decorationsSubject = new BehaviorSubject<DecorationInfo[]>([]);
  public readonly decorations$ = this.decorationsSubject.asObservable();

  constructor(
    private transformControlsService: TransformControlsService,
    private snapService: SnapService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  public getDecorations(): DecorationInfo[] {
    return this.decorations;
  }

  public setDecorations(decorations: DecorationInfo[]): void {
    this.decorations = decorations;
    this.decorationsInfo.clear();

    decorations.forEach((decoration) => {
      this.decorationsInfo.set(decoration.modelFileName, decoration);
      this.decorationsInfo.set(decoration.id, decoration);
    });

    this.decorationsSubject.next(this.decorations);
  }

  public async addDecorationFromModel(
    identifier: string,
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
    objects: THREE.Object3D[]
  ): Promise<THREE.Object3D | undefined> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!cakeBase) {
      return;
    }

    let decoInfo = this.decorationsInfo.get(identifier);
    if (!decoInfo) {
      decoInfo = this.decorations.find(d => d.modelFileName === identifier || d.name === identifier);
      if (!decoInfo) {
        console.error('Nie można znaleźć dekoracji o identyfikatorze/nazwie pliku:', identifier);
        return;
      }
    }

    const modelUrl = `/models/${decoInfo.modelFileName}`;
    try {
      const decoration = await DecorationFactory.loadDecorationModel(modelUrl);

      const box = new THREE.Box3().setFromObject(decoration);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const desiredSize = 1.5;
      if (maxDim > 0) {
        const scaleFactor = desiredSize / maxDim;
        decoration.scale.setScalar(scaleFactor);
      }

      decoration.userData['decorationType'] = decoInfo.type;
      decoration.userData['isDecoration'] = true;
      decoration.userData['modelFileName'] = decoInfo.modelFileName;
      decoration.userData['isSnapped'] = false;

      const metadata = cakeBase.userData['metadata'] as CakeMetadata | undefined;
      const { initialPosition, preferredSurface } = this.getInitialPlacement(
        metadata,
        cakeBase,
        decoInfo.type,
      );

      decoration.position.copy(initialPosition);
      decoration.updateMatrixWorld(true);

      scene.add(decoration);

      if (!objects.includes(decoration)) {
        objects.push(decoration);
      }

      this.transformControlsService.attachObject(decoration);

      const snapResult = this.snapService.snapDecorationToCake(decoration, preferredSurface);
      if (!snapResult.success) {
        console.warn('Nie udało się automatycznie przyczepić dekoracji:', snapResult.message);
      }

      return decoration;
    } catch (error) {
      console.error(`Błąd ładowania dekoracji ${identifier}:`, error);
      return;
    }
  }

  private getInitialPlacement(
    metadata: CakeMetadata | undefined,
    cakeBase: THREE.Object3D,
    type: DecorationInfo['type'],
  ): { initialPosition: THREE.Vector3; preferredSurface?: 'TOP' | 'SIDE' } {
    if (!metadata) {
      return {
        initialPosition: new THREE.Vector3().setFromMatrixPosition(cakeBase.matrixWorld),
        preferredSurface: undefined,
      };
    }

    const targetLayer = metadata.layerDimensions[metadata.layerDimensions.length - 1];
    if (!targetLayer) {
      return {
        initialPosition: new THREE.Vector3().setFromMatrixPosition(cakeBase.matrixWorld),
        preferredSurface: undefined,
      };
    }
    const topY = targetLayer.topY + (metadata.glazeTopOffset ?? 0);
    const midY = (targetLayer.bottomY + topY) / 2;

    if (metadata.shape === 'cylinder') {
      const radius = targetLayer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      const outward = radius + 0.05;

      if (type === 'SIDE') {
        const local = new THREE.Vector3(outward, midY, 0);
        return { initialPosition: cakeBase.localToWorld(local), preferredSurface: 'SIDE' };
      }

      const local = new THREE.Vector3(0, topY + 0.05, 0);
      return { initialPosition: cakeBase.localToWorld(local), preferredSurface: 'TOP' };
    }

    const halfWidth = targetLayer.width ? targetLayer.width / 2 : metadata.width ? metadata.width / 2 : 0.5;
    const halfDepth = targetLayer.depth ? targetLayer.depth / 2 : metadata.depth ? metadata.depth / 2 : 0.5;
    const offsetX = halfWidth + 0.05;

    if (type === 'SIDE') {
      const local = new THREE.Vector3(offsetX, midY, 0);
      return { initialPosition: cakeBase.localToWorld(local), preferredSurface: 'SIDE' };
    }

    const local = new THREE.Vector3(0, topY + 0.05, 0);
    return { initialPosition: cakeBase.localToWorld(local), preferredSurface: 'TOP' };
  }
}

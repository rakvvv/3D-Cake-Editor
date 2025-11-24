import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { TransformControlsService } from './transform-controls-service';
import { DecorationFactory } from '../factories/decoration.factory';
import { CakeMetadata } from '../factories/three-objects.factory';
import { DecorationInfo } from '../models/decorationInfo';

@Injectable({ providedIn: 'root' })
export class DecorationsService {
  private decorationsInfo: Map<string, DecorationInfo> = new Map();
  private decorations: DecorationInfo[] = [];
  private readonly decorationsSubject = new BehaviorSubject<DecorationInfo[]>([]);
  public readonly decorations$ = this.decorationsSubject.asObservable();

  constructor(
    private transformControlsService: TransformControlsService,
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
      const worldScale = cakeBase.getWorldScale(new THREE.Vector3());
      const topHeight = metadata
        ? metadata.totalHeight * worldScale.y
        : cakeBase.position.y + 2;

      decoration.position.set(
        (Math.random() - 0.5) * 5,
        topHeight + 2 + Math.random(),
        (Math.random() - 0.5) * 5
      );

      scene.add(decoration);

      if (!objects.includes(decoration)) {
        objects.push(decoration);
      }

      this.transformControlsService.attachObject(decoration);
      return decoration;
    } catch (error) {
      console.error(`Błąd ładowania dekoracji ${identifier}:`, error);
      return;
    }
  }
}

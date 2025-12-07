import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { environment } from '../../environments/environment';
import {
  QuickAttachPatternPreset,
  QuickAttachPoint,
  QuickAttachSideGridConfig,
  QuickAttachTopGridConfig,
} from '../models/quick-attach';
import { SnapService } from './snap.service';

interface MarkerMetadata {
  quickAttachIndex: number;
}

@Injectable({ providedIn: 'root' })
export class QuickAttachService {
  private scene: THREE.Scene | null = null;
  private markerGroup: THREE.Group | null = null;
  private placementHandler?: (decorationId: string, point: QuickAttachPoint) => Promise<THREE.Object3D | null>;
  private activeDecorationId: string | null = null;
  private activePatternId: string | null = null;
  private readonly markerMaterial = new THREE.MeshStandardMaterial({ color: '#ff7ab8', emissive: '#ffabd6' });

  public readonly presets: QuickAttachPatternPreset[] = [
    this.createSideGridPreset(
      {
        surface: 'SIDE',
        rows: 2,
        columns: 6,
        heightStartNorm: 0.25,
        heightEndNorm: 0.75,
      },
      'side-grid-2x6',
      'Dwurzędowa siatka boczna',
      'Równomierne rozmieszczenie 12 punktów na boku tortu.',
    ),
    this.createSideGridPreset(
      {
        surface: 'SIDE',
        rows: 1,
        columns: 8,
        heightStartNorm: 0.5,
        heightEndNorm: 0.5,
      },
      'side-ring-8',
      'Pierścień boczny',
      'Osiem punktów na jednym poziomie boku.',
    ),
    this.createTopGridPreset(
      {
        surface: 'TOP',
        radii: [0.2, 0.55],
        countPerRing: 6,
        includeCenter: true,
      },
      'top-star',
      'Gwiazda na górze',
      'Centralny punkt z dwoma pierścieniami po 6 pozycji.',
    ),
  ];

  constructor(private readonly snapService: SnapService) {}

  public get adminMode(): boolean {
    return !environment.production;
  }

  public registerScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  public registerPlacementHandler(
    handler: (decorationId: string, point: QuickAttachPoint) => Promise<THREE.Object3D | null>,
  ): void {
    this.placementHandler = handler;
  }

  public setActiveDecoration(decorationId: string | null): void {
    this.activeDecorationId = decorationId;
  }

  public setActivePattern(patternId: string | null, showMarkers = false): void {
    this.activePatternId = patternId;
    if (showMarkers) {
      this.renderMarkers();
    } else {
      this.clearMarkers();
    }
  }

  public get activePattern(): QuickAttachPatternPreset | undefined {
    return this.presets.find((preset) => preset.id === this.activePatternId);
  }

  public get markerObjects(): THREE.Object3D[] {
    return this.markerGroup?.children ?? [];
  }

  public getMarkerPoint(target: THREE.Object3D): QuickAttachPoint | null {
    const metadata = target.userData['quickAttachMarker'] as MarkerMetadata | undefined;
    if (!metadata) {
      return null;
    }

    const preset = this.activePattern;
    if (!preset) {
      return null;
    }

    return preset.points[metadata.quickAttachIndex] ?? null;
  }

  public async handleMarkerClick(target: THREE.Object3D): Promise<boolean> {
    const point = this.getMarkerPoint(target);
    if (!point || !this.placementHandler || !this.activeDecorationId) {
      return false;
    }

    await this.placementHandler(this.activeDecorationId, point);
    return true;
  }

  public async applyActivePattern(): Promise<number> {
    const preset = this.activePattern;
    if (!preset || !this.placementHandler || !this.activeDecorationId) {
      return 0;
    }

    let count = 0;
    for (const point of preset.points) {
      await this.placementHandler(this.activeDecorationId, point);
      count += 1;
    }
    return count;
  }

  public renderMarkers(): void {
    if (!this.scene || !this.activePattern) {
      return;
    }

    this.clearMarkers();
    const group = new THREE.Group();
    group.name = 'QuickAttachMarkers';

    this.activePattern.points.forEach((point, index) => {
      const projection = this.snapService.projectQuickAttachPoint(point);
      if (!projection) {
        return;
      }

      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), this.markerMaterial.clone());
      marker.position.copy(projection.worldPosition);
      marker.userData['quickAttachMarker'] = { quickAttachIndex: index } satisfies MarkerMetadata;
      marker.userData['isDecoration'] = false;
      marker.userData['isPainted'] = false;
      group.add(marker);
    });

    this.markerGroup = group;
    this.scene.add(group);
  }

  public clearMarkers(): void {
    if (this.markerGroup && this.scene) {
      this.scene.remove(this.markerGroup);
      this.markerGroup.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) {
            material.forEach((mat) => mat.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      this.markerGroup.clear();
      this.markerGroup = null;
    }
  }

  public buildPresetFromDecorations(name: string, decorationId: string, decorations: THREE.Object3D[]): QuickAttachPatternPreset | null {
    if (!decorations.length) {
      return null;
    }

    const points: QuickAttachPoint[] = [];
    decorations.forEach((decoration) => {
      const point = this.snapService.buildQuickAttachPointFromObject(decoration);
      if (point) {
        points.push(point);
      }
    });

    if (!points.length) {
      return null;
    }

    return {
      id: this.slugify(name),
      label: name,
      surface: points[0].surface,
      decorationId,
      description: 'Eksportowany wzór szybkie-przyczepienie',
      points,
    };
  }

  private createSideGridPreset(
    config: QuickAttachSideGridConfig,
    id: string,
    label: string,
    description: string,
  ): QuickAttachPatternPreset {
    return {
      id,
      label,
      surface: 'SIDE',
      description,
      points: this.buildSideGrid(config),
    };
  }

  private createTopGridPreset(
    config: QuickAttachTopGridConfig,
    id: string,
    label: string,
    description: string,
  ): QuickAttachPatternPreset {
    return {
      id,
      label,
      surface: 'TOP',
      description,
      points: this.buildTopGrid(config),
    };
  }

  private buildSideGrid(config: QuickAttachSideGridConfig): QuickAttachPoint[] {
    const rows = Math.max(1, Math.round(config.rows));
    const columns = Math.max(1, Math.round(config.columns));
    const heightStart = config.heightStartNorm ?? 0.2;
    const heightEnd = config.heightEndNorm ?? 0.8;
    const startAngle = config.startAngleRad ?? 0;
    const endAngle = config.endAngleRad ?? Math.PI * 2;

    const points: QuickAttachPoint[] = [];

    for (let row = 0; row < rows; row++) {
      const t = rows === 1 ? 0.5 : row / (rows - 1);
      const heightNorm = THREE.MathUtils.lerp(heightStart, heightEnd, t);

      for (let column = 0; column < columns; column++) {
        const angleT = columns === 1 ? 0.5 : column / columns;
        const angle = startAngle + (endAngle - startAngle) * angleT;
        points.push({
          surface: 'SIDE',
          layerIndex: config.layerIndex,
          offset: config.offset,
          rollRad: config.rollRad,
          scale: config.scale,
          coords: {
            angleRad: angle,
            heightNorm,
            radiusNorm: 1,
          },
        });
      }
    }

    return points;
  }

  private buildTopGrid(config: QuickAttachTopGridConfig): QuickAttachPoint[] {
    const startAngle = config.startAngleRad ?? 0;
    const endAngle = config.endAngleRad ?? Math.PI * 2;
    const points: QuickAttachPoint[] = [];

    if (config.includeCenter) {
      points.push({
        surface: 'TOP',
        layerIndex: config.layerIndex,
        offset: config.offset,
        rollRad: config.rollRad,
        scale: config.scale,
        coords: { angleRad: 0, radiusNorm: 0 },
      });
    }

    config.radii.forEach((radius) => {
      for (let index = 0; index < config.countPerRing; index++) {
        const t = config.countPerRing === 1 ? 0 : index / config.countPerRing;
        const angle = startAngle + (endAngle - startAngle) * t;
        points.push({
          surface: 'TOP',
          layerIndex: config.layerIndex,
          offset: config.offset,
          rollRad: config.rollRad,
          scale: config.scale,
          coords: { angleRad: angle, radiusNorm: radius },
        });
      }
    });

    return points;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') || 'preset';
  }
}

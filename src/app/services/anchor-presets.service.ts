import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as THREE from 'three';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { AnchorPoint, AnchorPreset } from '../models/anchors';
import { CakeMetadata } from '../factories/three-objects.factory';
import { SnapService } from './snap.service';
import { DecorationInfo } from '../models/decorationInfo';

@Injectable({
  providedIn: 'root',
})
export class AnchorPresetsService {
  private readonly presetsSubject = new BehaviorSubject<AnchorPreset[]>([]);
  private readonly activePresetIdSubject = new BehaviorSubject<string | null>(null);
  private readonly markersVisibleSubject = new BehaviorSubject<boolean>(false);
  private readonly anchorClicks = new Subject<string>();
  private readonly actionModeSubject = new BehaviorSubject<'spawn' | 'move'>('spawn');
  private readonly pendingDecorationSubject = new BehaviorSubject<DecorationInfo | null>(null);

  private scene: THREE.Scene | null = null;
  private cakeBase: THREE.Object3D | null = null;
  private metadata: CakeMetadata | null = null;
  private markers: THREE.Mesh[] = [];
  private highlightDecorationId: string | null = null;

  public readonly presets$ = this.presetsSubject.asObservable();
  public readonly activePresetId$ = this.activePresetIdSubject.asObservable();
  public readonly markersVisible$ = this.markersVisibleSubject.asObservable();
  public readonly anchorClicks$ = this.anchorClicks.asObservable();
  public readonly actionMode$ = this.actionModeSubject.asObservable();
  public readonly pendingDecoration$ = this.pendingDecorationSubject.asObservable();

  constructor(
    private readonly http: HttpClient,
    private readonly snapService: SnapService,
  ) {}

  public async loadPresets(url = '/assets/anchor-presets.json'): Promise<void> {
    try {
      const presets = await firstValueFrom(this.http.get<AnchorPreset[]>(url));
      this.setPresets(presets ?? []);
    } catch (error) {
      console.warn('Nie udało się wczytać presetów kotwic:', error);
      this.setPresets([]);
    }
  }

  public setPresets(presets: AnchorPreset[]): void {
    this.presetsSubject.next(presets);
    const activeId = this.activePresetIdSubject.value;
    const activeExists = activeId && presets.some((preset) => preset.id === activeId);
    if ((!activeId || !activeExists) && presets.length) {
      this.activePresetIdSubject.next(presets[0].id);
    }
    this.rebuildMarkers();
  }

  public setContext(scene: THREE.Scene, cakeBase: THREE.Object3D | null, metadata: CakeMetadata | null): void {
    this.scene = scene;
    this.cakeBase = cakeBase;
    this.metadata = metadata;
    this.rebuildMarkers();
  }

  public setMarkersVisible(visible: boolean): void {
    this.markersVisibleSubject.next(visible);
    this.rebuildMarkers();
  }

  public setActivePreset(id: string | null): void {
    this.activePresetIdSubject.next(id);
    this.rebuildMarkers();
  }

  public getActivePreset(): AnchorPreset | null {
    const activeId = this.activePresetIdSubject.value;
    const presets = this.presetsSubject.value;
    if (activeId) {
      return presets.find((preset) => preset.id === activeId) ?? null;
    }
    return presets[0] ?? null;
  }

  public getAnchor(anchorId: string): AnchorPoint | null {
    const preset = this.getActivePreset();
    if (!preset) {
      return null;
    }
    return preset.anchors.find((anchor) => anchor.id === anchorId) ?? null;
  }

  public pickAnchor(raycaster: THREE.Raycaster): AnchorPoint | null {
    if (!this.markersVisibleSubject.value || !this.markers.length) {
      return null;
    }
    const intersections = raycaster.intersectObjects(this.markers, true);
    if (!intersections.length) {
      return null;
    }
    const anchorId = intersections[0].object.userData['anchorId'] as string | undefined;
    if (!anchorId) {
      return null;
    }
    return this.getAnchor(anchorId);
  }

  public emitAnchorClick(anchorId: string): void {
    this.anchorClicks.next(anchorId);
  }

  public setHighlightedDecoration(decorationId: string | null): void {
    this.highlightDecorationId = decorationId;
    this.refreshMarkerColors();
  }

  public setActionMode(mode: 'spawn' | 'move'): void {
    this.actionModeSubject.next(mode);
  }

  public getActionMode(): 'spawn' | 'move' {
    return this.actionModeSubject.value;
  }

  public setPendingDecoration(decoration: DecorationInfo | null): void {
    this.pendingDecorationSubject.next(decoration);
    const highlightId = decoration?.modelFileName ?? decoration?.id ?? null;
    this.setHighlightedDecoration(highlightId);
    this.refreshMarkerColors();
  }

  public getPendingDecoration(): DecorationInfo | null {
    return this.pendingDecorationSubject.value;
  }

  public areMarkersVisible(): boolean {
    return this.markersVisibleSubject.value;
  }

  private rebuildMarkers(): void {
    this.clearMarkers();
    if (!this.scene || !this.cakeBase || !this.metadata) {
      return;
    }
    if (!this.markersVisibleSubject.value) {
      return;
    }

    const preset = this.getActivePreset();
    if (!preset) {
      return;
    }

    preset.anchors.forEach((anchor) => {
      const projection = this.snapService.projectAnchor(anchor, this.metadata!);
      if (!projection) {
        return;
      }

      const marker = this.createMarker(anchor, projection.normal);
      marker.position.copy(
        projection.position.clone().add(projection.normal.clone().multiplyScalar(0.05)),
      );
      this.cakeBase!.add(marker);
      this.markers.push(marker);
    });
  }

  private clearMarkers(): void {
    if (!this.markers.length) {
      return;
    }

    this.markers.forEach((marker) => {
      marker.removeFromParent();
      marker.geometry.dispose();
      if ((marker.material as THREE.Material).dispose) {
        (marker.material as THREE.Material).dispose();
      }
    });

    this.markers = [];
  }

  private createMarker(anchor: AnchorPoint, normal: THREE.Vector3): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.08, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: this.resolveMarkerColor(anchor) });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData['anchorId'] = anchor.id;
    mesh.userData['anchorLabel'] = anchor.label;
    mesh.lookAt(mesh.position.clone().add(normal));
    return mesh;
  }

  private resolveMarkerColor(anchor: AnchorPoint): number {
    if (!this.isAnchorCompatibleWithPending(anchor)) {
      return 0x9ca3af;
    }
    if (this.highlightDecorationId) {
      if (anchor.allowedDecorationIds?.length) {
        return anchor.allowedDecorationIds.includes(this.highlightDecorationId)
          ? 0x3b82f6
          : 0x94a3b8;
      }
      return 0x60a5fa;
    }
    return 0x4b5563;
  }

  private isAnchorCompatibleWithPending(anchor: AnchorPoint): boolean {
    const decoration = this.pendingDecorationSubject.value;
    if (!decoration) {
      return true;
    }

    const allowedSurfaces = this.mapPlacementTypeToSurfaces(decoration.type);
    if (allowedSurfaces.length && !allowedSurfaces.includes(anchor.surface)) {
      return false;
    }

    if (anchor.allowedDecorationIds?.length) {
      const candidates = [decoration.modelFileName, decoration.id].filter((id): id is string => !!id);
      return candidates.some((candidate) => anchor.allowedDecorationIds!.includes(candidate));
    }

    return true;
  }

  private mapPlacementTypeToSurfaces(type?: DecorationInfo['type']): Array<'TOP' | 'SIDE'> {
    if (type === 'TOP') {
      return ['TOP'];
    }
    if (type === 'SIDE') {
      return ['SIDE'];
    }
    return [];
  }

  private refreshMarkerColors(): void {
    this.markers.forEach((marker) => {
      const anchorId = marker.userData['anchorId'] as string | undefined;
      if (!anchorId) {
        return;
      }
      const anchor = this.getAnchor(anchorId);
      if (!anchor) {
        return;
      }
      const material = marker.material as THREE.MeshBasicMaterial;
      material.color.setHex(this.resolveMarkerColor(anchor));
    });
  }
}

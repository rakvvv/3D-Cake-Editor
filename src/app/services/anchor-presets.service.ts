import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as THREE from 'three';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { AnchorPoint, AnchorPreset } from '../models/anchors';
import { CakeMetadata } from '../factories/three-objects.factory';
import { SnapService } from './snap.service';
import { DecorationInfo } from '../models/decorationInfo';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AnchorPresetsService {
  private readonly presetsSubject = new BehaviorSubject<AnchorPreset[]>([]);
  private readonly activePresetIdSubject = new BehaviorSubject<string | null>(null);
  private readonly markersVisibleSubject = new BehaviorSubject<boolean>(false);
  private readonly focusedAnchorIdSubject = new BehaviorSubject<string | null>(null);
  private readonly anchorClicks = new Subject<string>();
  private readonly pendingDecorationSubject = new BehaviorSubject<DecorationInfo | null>(null);
  private readonly recordOptionsSubject = new BehaviorSubject<boolean>(false);
  private renderScheduler?: () => void;

  private scene: THREE.Scene | null = null;
  private cakeBase: THREE.Object3D | null = null;
  private metadata: CakeMetadata | null = null;
  private cakeContext: { shape?: string; cakeSize?: string; tiers?: number } | null = null;
  private markers: THREE.Mesh[] = [];
  private highlightDecorationId: string | null = null;

  public readonly presets$ = this.presetsSubject.asObservable();
  public readonly activePresetId$ = this.activePresetIdSubject.asObservable();
  public readonly markersVisible$ = this.markersVisibleSubject.asObservable();
  public readonly focusedAnchorId$ = this.focusedAnchorIdSubject.asObservable();
  public readonly anchorClicks$ = this.anchorClicks.asObservable();
  public readonly pendingDecoration$ = this.pendingDecorationSubject.asObservable();
  public readonly recordOptions$ = this.recordOptionsSubject.asObservable();

  constructor(
    private readonly http: HttpClient,
    private readonly snapService: SnapService,
  ) {}

  public setRenderScheduler(requestRender: () => void): void {
    this.renderScheduler = requestRender;
  }

  public async loadPresets(url = `${environment.apiBaseUrl}/presets/anchors`): Promise<void> {
    try {
      const presets = await firstValueFrom(
        this.http.get<(AnchorPreset | { dataJson: string; id?: string; name?: string; cakeShape?: string; cakeSize?: string; tiers?: number })[]>(url),
      );
      const normalized = (presets ?? []).map((preset) => {
        if ('dataJson' in preset) {
          const parsed = JSON.parse((preset as any).dataJson) as AnchorPreset;
          return {
            ...parsed,
            id: (preset as any).id ?? parsed.id,
            name: (preset as any).name ?? parsed.name,
            cakeShape: (preset as any).cakeShape ?? parsed.cakeShape,
            cakeSize: (preset as any).cakeSize ?? parsed.cakeSize,
            tiers: (preset as any).tiers ?? parsed.tiers,
          } as AnchorPreset;
        }
        return preset as AnchorPreset;
      });
      if (normalized?.length) {
        this.setPresets(normalized);
        return;
      }

      await this.loadLocalExamples();
    } catch (error) {
      console.warn('Nie udało się wczytać presetów kotwic z API, używam wersji przykładowych:', error);
      await this.loadLocalExamples();
    }
  }

  private async loadLocalExamples(): Promise<void> {
    try {
      const examples = await firstValueFrom(this.http.get<AnchorPreset[]>('/assets/anchor-presets.json'));
      this.setPresets(examples ?? []);
    } catch (fallbackError) {
      console.warn('Nie udało się wczytać lokalnych presetów kotwic:', fallbackError);
      this.setPresets([]);
    }
  }

  public setPresets(presets: AnchorPreset[]): void {
    this.presetsSubject.next(presets);
    this.ensureActivePresetForContext();
    this.rebuildMarkers();
  }

  public setContext(
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
    metadata: CakeMetadata | null,
    context?: { cakeSize?: string },
  ): void {
    this.scene = scene;
    this.cakeBase = cakeBase;
    this.metadata = metadata;
    this.cakeContext = metadata
      ? { shape: metadata.shape, tiers: metadata.layers, cakeSize: context?.cakeSize }
      : null;
    this.ensureActivePresetForContext();
    this.rebuildMarkers();
  }

  public setMarkersVisible(visible: boolean): void {
    this.markersVisibleSubject.next(visible);
    this.rebuildMarkers();
    this.requestRender();
  }

  public setActivePreset(id: string | null): void {
    this.activePresetIdSubject.next(id);
    this.rebuildMarkers();
    this.requestRender();
  }

  public getActivePreset(): AnchorPreset | null {
    const activeId = this.activePresetIdSubject.value;
    const presets = this.presetsSubject.value;
    if (activeId) {
      const active = presets.find((preset) => preset.id === activeId);
      if (active) {
        return active;
      }
    }
    return presets[0] ?? null;
  }

  private ensureActivePresetForContext(): void {
    const presets = this.presetsSubject.value;
    if (!presets.length) {
      this.activePresetIdSubject.next(null);
      return;
    }

    const activeId = this.activePresetIdSubject.value;
    const active = activeId ? presets.find((preset) => preset.id === activeId) : null;
    if (active && this.matchesContext(active)) {
      return;
    }

    const match = presets.find((preset) => this.matchesContext(preset));
    this.activePresetIdSubject.next(match?.id ?? presets[0].id);
  }

  private matchesContext(preset: AnchorPreset): boolean {
    if (!this.cakeContext) {
      return true;
    }

    if (preset.cakeShape && preset.cakeShape !== this.cakeContext.shape) {
      return false;
    }
    if (preset.cakeSize && preset.cakeSize !== this.cakeContext.cakeSize) {
      return false;
    }
    if (preset.tiers && this.cakeContext.tiers && preset.tiers !== this.cakeContext.tiers) {
      return false;
    }

    return true;
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
    this.setFocusedAnchor(anchorId);
    this.anchorClicks.next(anchorId);
  }

  public setFocusedAnchor(anchorId: string | null): void {
    if (anchorId && !this.getAnchor(anchorId)) {
      this.focusedAnchorIdSubject.next(null);
    } else {
      this.focusedAnchorIdSubject.next(anchorId);
    }
    this.refreshMarkerColors();
    this.requestRender();
  }

  public getFocusedAnchor(): string | null {
    return this.focusedAnchorIdSubject.value;
  }

  public removeAnchor(anchorId: string): boolean {
    if (!anchorId) {
      return false;
    }

    const presets = this.presetsSubject.value;
    const activeId = this.activePresetIdSubject.value;
    if (!activeId) {
      return false;
    }

    const presetIndex = presets.findIndex((preset) => preset.id === activeId);
    if (presetIndex === -1) {
      return false;
    }

    const preset = presets[presetIndex];
    const updatedAnchors = preset.anchors.filter((anchor) => anchor.id !== anchorId);
    if (updatedAnchors.length === preset.anchors.length) {
      return false;
    }

    const updatedPresets = [...presets];
    updatedPresets[presetIndex] = { ...preset, anchors: updatedAnchors };

    if (this.focusedAnchorIdSubject.value === anchorId) {
      this.focusedAnchorIdSubject.next(null);
    }

    this.presetsSubject.next(updatedPresets);
    this.rebuildMarkers();
    this.requestRender();
    return true;
  }

  public setHighlightedDecoration(decorationId: string | null): void {
    this.highlightDecorationId = decorationId;
    this.refreshMarkerColors();
    this.requestRender();
  }

  public setPendingDecoration(decoration: DecorationInfo | null): void {
    this.pendingDecorationSubject.next(decoration);
    this.setHighlightedDecoration(null);
    this.refreshMarkerColors();
  }

  public getPendingDecoration(): DecorationInfo | null {
    return this.pendingDecorationSubject.value;
  }

  public setRecordingOptions(enabled: boolean): void {
    this.recordOptionsSubject.next(enabled);
    this.refreshMarkerColors();
  }

  public isRecordingOptions(): boolean {
    return this.recordOptionsSubject.value;
  }

  public appendAllowedDecoration(anchorId: string | null, decorationId?: string): boolean {
    if (!anchorId || !decorationId) {
      return false;
    }

    const presets = this.presetsSubject.value;
    const activeId = this.activePresetIdSubject.value;
    if (!activeId) {
      return false;
    }

    const presetIndex = presets.findIndex((preset) => preset.id === activeId);
    if (presetIndex === -1) {
      return false;
    }

    const preset = presets[presetIndex];
    const anchorIndex = preset.anchors.findIndex((anchor) => anchor.id === anchorId);
    if (anchorIndex === -1) {
      return false;
    }

    const anchor = preset.anchors[anchorIndex];
    const merged = new Set(anchor.allowedDecorationIds ?? []);
    if (merged.has(decorationId)) {
      return false;
    }

    merged.add(decorationId);

    const updatedAnchors = [...preset.anchors];
    updatedAnchors[anchorIndex] = { ...anchor, allowedDecorationIds: Array.from(merged) };

    const updatedPresets = [...presets];
    updatedPresets[presetIndex] = { ...preset, anchors: updatedAnchors };

    this.presetsSubject.next(updatedPresets);
    this.refreshMarkerColors();
    return true;
  }

  public removeAllowedDecoration(anchorId: string | null, decorationId?: string): boolean {
    if (!anchorId || !decorationId) {
      return false;
    }

    const presets = this.presetsSubject.value;
    const activeId = this.activePresetIdSubject.value;
    if (!activeId) {
      return false;
    }

    const presetIndex = presets.findIndex((preset) => preset.id === activeId);
    if (presetIndex === -1) {
      return false;
    }

    const preset = presets[presetIndex];
    const anchorIndex = preset.anchors.findIndex((anchor) => anchor.id === anchorId);
    if (anchorIndex === -1) {
      return false;
    }

    const anchor = preset.anchors[anchorIndex];
    const allowed = new Set(anchor.allowedDecorationIds ?? []);
    const deleted = allowed.delete(decorationId);
    if (!deleted) {
      return false;
    }

    const overrides = { ...(anchor.decorationOverrides ?? {}) };
    delete overrides[decorationId];

    const updatedAnchors = [...preset.anchors];
    updatedAnchors[anchorIndex] = {
      ...anchor,
      decorationOverrides: Object.keys(overrides).length ? overrides : undefined,
      allowedDecorationIds: Array.from(allowed),
    };

    const updatedPresets = [...presets];
    updatedPresets[presetIndex] = { ...preset, anchors: updatedAnchors };

    this.presetsSubject.next(updatedPresets);
    this.refreshMarkerColors();
    return true;
  }

  public areMarkersVisible(): boolean {
    return this.markersVisibleSubject.value;
  }

  public upsertDecorationOverride(
    anchorId: string,
    decorationId: string,
    override: {
      rotationDeg?: number;
      rotationQuat?: [number, number, number, number];
      scale?: number;
      offset?: [number, number, number];
    },
  ): void {
    const presets = this.presetsSubject.value;
    const activeId = this.activePresetIdSubject.value;
    if (!activeId) {
      return;
    }

    const presetIndex = presets.findIndex((preset) => preset.id === activeId);
    if (presetIndex === -1) {
      return;
    }

    const preset = presets[presetIndex];
    const anchorIndex = preset.anchors.findIndex((anchor) => anchor.id === anchorId);
    if (anchorIndex === -1) {
      return;
    }

    const anchor = preset.anchors[anchorIndex];
    const decorationOverrides = { ...(anchor.decorationOverrides ?? {}) };
    decorationOverrides[decorationId] = override;

    const updatedAnchors = [...preset.anchors];
    updatedAnchors[anchorIndex] = { ...anchor, decorationOverrides };

    const updatedPresets = [...presets];
    updatedPresets[presetIndex] = { ...preset, anchors: updatedAnchors };

    this.presetsSubject.next(updatedPresets);
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

    this.requestRender();
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
    if (this.focusedAnchorIdSubject.value === anchor.id) {
      return 0xf59e0b;
    }
    return 0x4b5563;
  }

  private isAnchorCompatibleWithPending(anchor: AnchorPoint): boolean {
    const decoration = this.pendingDecorationSubject.value;
    if (!decoration) {
      return true;
    }

    if (this.recordOptionsSubject.value) {
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

    this.requestRender();
  }

  private requestRender(): void {
    this.renderScheduler?.();
  }
}

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AddDecorationRequest, DecorationSurfaceTarget } from '../../../models/add-decoration-request';
import { DecorationInfo } from '../../../models/decorationInfo';
import { DecorationsService } from '../../../services/decorations.service';
import { AnchorPresetsService } from '../../../services/anchor-presets.service';
import { AnchorPreset } from '../../../models/anchors';
import { PaintService } from '../../../services/paint.service';

@Component({
  selector: 'app-sidebar-decorations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-decorations-panel.component.html',
  styleUrls: ['./sidebar-decorations-panel.component.css'],
})
export class SidebarDecorationsPanelComponent implements OnInit, OnDestroy {
  @Input() layerCount = 1;
  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();

  decorations: DecorationInfo[] = [];
  presets: AnchorPreset[] = [];
  activePresetId: string | null = null;
  actionMode: 'spawn' | 'move' = 'spawn';
  markersVisible = false;
  selectedDecorationId: string | null = null;
  searchTerm = '';
  preferredSurface: DecorationSurfaceTarget = 'AUTO';
  targetLayerIndex = 0;
  readonly Math = Math;
  private readonly decorationPlaceholder = '/assets/decorations/thumbnails/placeholder.svg';
  private readonly subscriptions = new Subscription();
  private allowedDecorationIds: Set<string> | null = null;

  constructor(
    private readonly decorationsService: DecorationsService,
    private readonly anchorPresetsService: AnchorPresetsService,
    private readonly paintService: PaintService,
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.decorationsService.decorations$.subscribe((decorations) => (this.decorations = decorations)),
    );

    this.subscriptions.add(this.anchorPresetsService.presets$.subscribe((presets) => (this.presets = presets)));
    this.subscriptions.add(
      this.anchorPresetsService.activePresetId$.subscribe((id) => (this.activePresetId = id)),
    );
    this.subscriptions.add(
      this.anchorPresetsService.actionMode$.subscribe((mode) => (this.actionMode = mode)),
    );
    this.subscriptions.add(
      this.anchorPresetsService.markersVisible$.subscribe((visible) => (this.markersVisible = visible)),
    );
    this.subscriptions.add(
      this.anchorPresetsService.pendingDecoration$.subscribe((decoration) => {
        this.selectedDecorationId = decoration?.modelFileName ?? decoration?.id ?? null;
      }),
    );
    this.subscriptions.add(
      this.anchorPresetsService.focusedAnchorId$.subscribe((anchorId) => {
        this.syncAllowedDecorations(anchorId);
      }),
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get filteredDecorations(): DecorationInfo[] {
    const term = this.searchTerm.trim().toLowerCase();
    let available = this.allowedDecorationIds?.size
      ? this.decorations.filter((item) => this.matchesAllowedDecoration(item))
      : this.decorations;

    if (term) {
      available = available.filter((item) => item.name.toLowerCase().includes(term));
    }

    return available;
  }

  get layerIndices(): number[] {
    return Array.from({ length: Math.max(this.layerCount, 1) }, (_, index) => index);
  }

  getDecorationThumbnail(decoration: DecorationInfo): string {
    return decoration.thumbnailUrl ?? `/assets/decorations/thumbnails/${decoration.id}.png`;
  }

  onDecorationThumbnailError(event: Event, decoration: DecorationInfo): void {
    const img = event.target as HTMLImageElement;
    const generatedUrl = new URL(`/assets/decorations/thumbnails/${decoration.id}.png`, img.baseURI).toString();

    if (img.dataset['fallback'] !== 'generated' && img.src !== generatedUrl) {
      img.dataset['fallback'] = 'generated';
      img.src = generatedUrl;
      return;
    }

    img.src = new URL(this.decorationPlaceholder, img.baseURI).toString();
  }

  onAddDecoration(decoration: DecorationInfo): void {
    const decorationKey = decoration.id ?? decoration.modelFileName;
    const isAlreadySelected =
      !!this.selectedDecorationId &&
      (this.selectedDecorationId === decoration.id || this.selectedDecorationId === decoration.modelFileName);

    if (isAlreadySelected) {
      this.selectedDecorationId = null;
      this.anchorPresetsService.setPendingDecoration(null);
      return;
    }

    this.selectedDecorationId = decorationKey;
    this.anchorPresetsService.setPendingDecoration(decoration);
    this.paintService.setCurrentBrush(decoration.modelFileName);

    const shouldPlaceViaAnchor = this.markersVisible && this.actionMode === 'spawn';
    if (shouldPlaceViaAnchor) {
      return;
    }

    const request: AddDecorationRequest = {
      modelFileName: decoration.modelFileName,
      preferredSurface: this.preferredSurface === 'AUTO' ? undefined : this.preferredSurface,
      targetLayerIndex: this.targetLayerIndex,
    };
    this.addDecoration.emit(request);
  }

  onPresetChange(presetId: string): void {
    this.activePresetId = presetId;
    this.anchorPresetsService.setActivePreset(presetId);
  }

  onActionModeChange(mode: 'spawn' | 'move'): void {
    this.anchorPresetsService.setActionMode(mode);
  }

  toggleMarkers(): void {
    this.anchorPresetsService.setMarkersVisible(!this.markersVisible);
  }

  onLayerChange(index: number): void {
    this.targetLayerIndex = Math.min(Math.max(Math.round(index), 0), Math.max(this.layerCount - 1, 0));
  }

  private syncAllowedDecorations(anchorId: string | null): void {
    const anchor = anchorId ? this.anchorPresetsService.getAnchor(anchorId) : null;
    const allowed = anchor?.allowedDecorationIds?.filter((id): id is string => !!id) ?? [];
    this.allowedDecorationIds = allowed.length ? new Set(allowed) : null;
    this.dropDisallowedSelection();
  }

  private matchesAllowedDecoration(decoration: DecorationInfo): boolean {
    if (!this.allowedDecorationIds?.size) {
      return true;
    }
    const candidates = [decoration.modelFileName, decoration.id].filter((id): id is string => !!id);
    return candidates.some((candidate) => this.allowedDecorationIds!.has(candidate));
  }

  private dropDisallowedSelection(): void {
    if (!this.allowedDecorationIds?.size || !this.selectedDecorationId) {
      return;
    }

    const selectedInfo = this.decorationsService.getDecorationInfo(this.selectedDecorationId);
    const stillAllowed = selectedInfo
      ? this.matchesAllowedDecoration(selectedInfo)
      : this.allowedDecorationIds.has(this.selectedDecorationId);

    if (!stillAllowed) {
      this.selectedDecorationId = null;
      this.anchorPresetsService.setPendingDecoration(null);
    }
  }
}

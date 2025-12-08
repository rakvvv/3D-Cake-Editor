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
  private readonly subscriptions = new Subscription();

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
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get filteredDecorations(): DecorationInfo[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.decorations;
    }
    return this.decorations.filter((item) => item.name.toLowerCase().includes(term));
  }

  get layerIndices(): number[] {
    return Array.from({ length: Math.max(this.layerCount, 1) }, (_, index) => index);
  }

  onAddDecoration(decoration: DecorationInfo): void {
    this.selectedDecorationId = decoration.id ?? decoration.modelFileName;
    this.anchorPresetsService.setPendingDecoration(decoration);
    this.paintService.setCurrentBrush(decoration.modelFileName);
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
}

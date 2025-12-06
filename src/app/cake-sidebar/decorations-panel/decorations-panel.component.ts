import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DecorationInfo, DecorationPlacementType } from '../../models/decorationInfo';
import { DecorationsService } from '../../services/decorations.service';
import { DecorationValidationIssue } from '../../models/decoration-validation';
import { Subscription } from 'rxjs';
import { CakeOptions } from '../../models/cake.options';
import { AddDecorationRequest, DecorationSurfaceTarget } from '../../models/add-decoration-request';
import { AnchorPresetsService } from '../../services/anchor-presets.service';
import { AnchorPreset } from '../../models/anchors';
import { ThreeSceneService } from '../../services/three-scene.service';

@Component({
  selector: 'app-decorations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './decorations-panel.component.html',
  styleUrls: ['./decorations-panel.component.css']
})
export class DecorationsPanelComponent implements OnInit, OnDestroy, OnChanges {
  @Input() decorationsService!: DecorationsService;
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingActionLabel: string | null = null;
  @Input() options?: CakeOptions;
  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();
  @Output() validateDecorations = new EventEmitter<void>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();

  filterText = '';
  filterType: 'ALL' | DecorationPlacementType = 'ALL';
  decorations: DecorationInfo[] = [];
  placementSurface: DecorationSurfaceTarget = 'AUTO';
  targetLayerIndex = 0;
  anchorsEnabled = false;
  anchorMode: 'spawn' | 'move' = 'spawn';
  anchorPresets: AnchorPreset[] = [];
  activeAnchorPresetId: string | null = null;
  anchorInstruction: string | null = null;
  anchorExportJson = '';
  adminMode = false;
  private subscription?: Subscription;
  private anchorSubscriptions: Subscription[] = [];

  constructor(
    private readonly anchorPresetsService: AnchorPresetsService,
    private readonly sceneService: ThreeSceneService,
  ) {}

  ngOnInit(): void {
    this.subscription = this.decorationsService?.decorations$.subscribe((decorations) => {
      this.decorations = decorations;
    });
    this.decorations = this.decorationsService.getDecorations();
    this.syncTargetLayer();
    this.adminMode = typeof window !== 'undefined' && window.location.search.toLowerCase().includes('admin');

    void this.anchorPresetsService.loadPresets();
    this.anchorSubscriptions.push(
      this.anchorPresetsService.presets$.subscribe((presets) => {
        this.anchorPresets = presets;
      }),
      this.anchorPresetsService.activePresetId$.subscribe((id) => {
        this.activeAnchorPresetId = id;
      }),
      this.anchorPresetsService.markersVisible$.subscribe((visible) => {
        this.anchorsEnabled = visible;
        this.updateAnchorInstruction();
      }),
      this.anchorPresetsService.actionMode$.subscribe((mode) => {
        this.anchorMode = mode;
        this.updateAnchorInstruction();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.anchorSubscriptions.forEach((sub) => sub.unsubscribe());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['options']) {
      this.syncTargetLayer();
    }
  }

  get filteredDecorations(): DecorationInfo[] {
    return this.decorations.filter((decoration) => {
      const matchesText = decoration.name.toLowerCase().includes(this.filterText.toLowerCase());
      const matchesType =
        this.filterType === 'ALL' || decoration.type === this.filterType;
      return matchesText && matchesType;
    });
  }

  onAddDecoration(decoration: DecorationInfo): void {
    if (this.anchorsEnabled && this.anchorMode === 'spawn') {
      this.anchorPresetsService.setPendingDecoration(decoration);
      this.updateAnchorInstruction();
      return;
    }

    const surface = this.placementSurface === 'AUTO'
      ? this.getDefaultSurface(decoration.type)
      : this.placementSurface === 'TOP'
        ? 'TOP'
        : 'SIDE';

    this.addDecoration.emit({
      modelFileName: decoration.modelFileName,
      preferredSurface: surface,
      targetLayerIndex: this.getBoundLayerIndex(),
    });
  }

  onToggleAnchors(visible: boolean): void {
    this.anchorsEnabled = visible;
    this.anchorPresetsService.setMarkersVisible(visible);
    if (!visible) {
      this.anchorPresetsService.setPendingDecoration(null);
      this.anchorInstruction = null;
      return;
    }
    if (this.anchorMode === 'move') {
      const selected = this.sceneService.getSelectedDecoration();
      const modelId = (selected?.userData['modelFileName'] as string | undefined) ?? null;
      this.anchorPresetsService.setHighlightedDecoration(modelId);
    }
    this.updateAnchorInstruction();
  }

  onAnchorPresetChange(presetId: string): void {
    this.activeAnchorPresetId = presetId;
    this.anchorPresetsService.setActivePreset(presetId);
  }

  onAnchorModeChange(mode: 'spawn' | 'move'): void {
    this.anchorMode = mode;
    this.anchorPresetsService.setActionMode(mode);
    if (mode === 'move') {
      this.anchorPresetsService.setPendingDecoration(null);
      const selected = this.sceneService.getSelectedDecoration();
      const modelId = (selected?.userData['modelFileName'] as string | undefined) ?? null;
      this.anchorPresetsService.setHighlightedDecoration(modelId);
    }
    this.updateAnchorInstruction();
  }

  onExportAnchors(): void {
    const anchors = this.sceneService.exportAnchorsFromSelection();
    this.anchorExportJson = anchors.length ? JSON.stringify(anchors, null, 2) : '';
  }

  onValidateDecorations(): void {
    this.validateDecorations.emit();
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformModeChange.emit(mode);
  }

  get layerOptions(): number[] {
    const layersCount = this.options?.layers ?? this.options?.layerSizes?.length ?? 1;
    return Array.from({ length: Math.max(layersCount, 1) }, (_, index) => index);
  }

  surfaceLabel(surface: DecorationSurfaceTarget): string {
    switch (surface) {
      case 'TOP':
        return 'Przyczep do góry';
      case 'SIDE':
        return 'Przyczep do boku';
      default:
        return 'Automatyczny wybór';
    }
  }

  layerLabel(layerIndex: number): string {
    return `Piętro ${layerIndex + 1}`;
  }

  private syncTargetLayer(): void {
    const layersCount = this.layerOptions.length;
    if (this.targetLayerIndex > layersCount - 1) {
      this.targetLayerIndex = layersCount - 1;
    } else if (this.targetLayerIndex < 0) {
      this.targetLayerIndex = 0;
    }
  }

  private getBoundLayerIndex(): number {
    const layersCount = this.layerOptions.length;
    if (!layersCount) {
      return 0;
    }
    return Math.min(Math.max(this.targetLayerIndex, 0), layersCount - 1);
  }

  private getDefaultSurface(type: DecorationPlacementType): 'TOP' | 'SIDE' | undefined {
    if (type === 'TOP') {
      return 'TOP';
    }
    if (type === 'SIDE') {
      return 'SIDE';
    }
    return undefined;
  }

  private updateAnchorInstruction(): void {
    if (!this.anchorsEnabled) {
      this.anchorInstruction = null;
      return;
    }

    if (this.anchorMode === 'spawn') {
      const pending = this.anchorPresetsService.getPendingDecoration();
      this.anchorInstruction = pending
        ? `Kliknij kotwicę, aby dodać: ${pending.name}.`
        : 'Wybierz dekorację, a następnie kliknij kotwicę, aby ją dodać.';
      return;
    }

    this.anchorInstruction = 'Kliknij kotwicę, aby przenieść zaznaczoną dekorację.';
  }

  displayTypeLabel(type: DecorationPlacementType): string {
    switch (type) {
      case 'TOP':
        return 'Na górę';
      case 'SIDE':
        return 'Na bok';
      case 'BOTH':
        return 'Na górę i bok';
      default:
        return type;
    }
  }

  get hasValidationIssues(): boolean {
    return this.validationIssues.length > 0;
  }
}

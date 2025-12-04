import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DecorationInfo, DecorationPlacementType } from '../../models/decorationInfo';
import { DecorationsService } from '../../services/decorations.service';
import { DecorationValidationIssue } from '../../models/decoration-validation';
import { Subscription } from 'rxjs';
import { CakeOptions } from '../../models/cake.options';
import { AddDecorationRequest, DecorationSurfaceTarget } from '../../models/add-decoration-request';

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
  private subscription?: Subscription;

  ngOnInit(): void {
    this.subscription = this.decorationsService?.decorations$.subscribe((decorations) => {
      this.decorations = decorations;
    });
    this.decorations = this.decorationsService.getDecorations();
    this.syncTargetLayer();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
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

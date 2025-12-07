import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DecorationInfo } from '../../models/decorationInfo';
import { DecorationsService } from '../../services/decorations.service';
import { PaintService } from '../../services/paint.service';
import { CreamPathNode, CreamRingPreset, CreamPosition, ExtruderStrokeMode } from '../../models/cream-presets';

type SidebarPaintTool = 'decoration' | 'pen' | 'extruder';

type ExtruderVariantCard = {
  id: number;
  name: string;
  thumbnail?: string | null;
};

type BrushOption = {
  id: string;
  modelFileName: string;
  name: string;
  thumbnailUrl?: string;
  paintable?: boolean;
};

@Component({
  selector: 'app-paint-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './paint-panel.component.html',
  styleUrls: ['./paint-panel.component.css']
})
export class PaintPanelComponent implements OnChanges, OnInit, OnDestroy {
  @Input() paintService!: PaintService;
  @Input() decorationsService?: DecorationsService;
  @Output() paintModeChange = new EventEmitter<boolean>();
  @Output() brushChange = new EventEmitter<string>();

  brushOptions: BrushOption[] = [];
  selectedBrush: string | null = null;
  paintTools: { id: SidebarPaintTool; name: string }[] = [
    { id: 'decoration', name: 'Dekoracje 3D' },
    { id: 'pen', name: 'Pisak' },
    { id: 'extruder', name: 'Ekstruder kremu' },
  ];
  selectedTool: SidebarPaintTool = 'decoration';
  penSize = 0.05;
  penThickness = 0.02;
  penColor = '#ff4d6d';
  extruderVariant: number | 'random' = 'random';
  extruderVariantCards: ExtruderVariantCard[] = [];
  creamRingPresets: CreamRingPreset[] = [];
  selectedPresetId: string | null = null;
  extruderMode: ExtruderStrokeMode = 'RING';
  extruderLayerIndex = 0;
  extruderSegments = 96;
  extruderStartAngle = 0;
  extruderEndAngle = 360;
  extruderHeightNorm = 1;
  extruderRadiusOffset = 0.02;
  extruderScale = 1;
  extruderColor = '#ffffff';
  extruderPosition: CreamPosition = 'TOP_EDGE';
  extruderNodes: CreamPathNode[] = [
    { angleDeg: 0, heightNorm: 0.6 },
    { angleDeg: 180, heightNorm: 0.6 },
  ];
  extruderPreviewPoints: { angleDeg: number; heightNorm: number; x: number; y: number }[] = [];
  layerOptions: number[] = [0];

  private decorationsSubscription?: Subscription;
  private creamPresetSubscription?: Subscription;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.syncPaintServiceState();
      this.subscribeToCreamPresets();
      void this.paintService.loadCreamRingPresets();
      this.refreshLayerOptions();
    }

    if (changes['decorationsService']) {
      this.subscribeToDecorations();
    }
  }

  ngOnInit(): void {
    this.subscribeToDecorations();
    this.subscribeToCreamPresets();
    if (this.paintService) {
      void this.paintService.loadCreamRingPresets();
    }
    this.refreshLayerOptions();
  }

  ngOnDestroy(): void {
    this.decorationsSubscription?.unsubscribe();
    this.creamPresetSubscription?.unsubscribe();
  }

  togglePaintMode(): void {
    if (!this.paintService) {
      return;
    }
    this.paintService.paintMode = !this.paintService.paintMode;
    this.paintModeChange.emit(this.paintService.paintMode);
  }

  onBrushChange(): void {
    if (!this.paintService) {
      return;
    }
    if (!this.selectedBrush) {
      this.ensureBrushSelection();
    }
    if (!this.selectedBrush) {
      return;
    }

    this.paintService.setPaintTool('decoration');
    this.paintService.setCurrentBrush(this.selectedBrush);
    this.brushChange.emit(this.selectedBrush);
  }

  onToolChange(): void {
    if (!this.paintService) {
      return;
    }
    this.paintService.setPaintTool(this.selectedTool);
    if (this.selectedTool === 'pen') {
      this.onPenSettingsChange();
    } else if (this.selectedTool === 'extruder') {
      this.paintService.setExtruderVariantSelection(this.extruderVariant);
      this.loadExtruderVariants();
      this.refreshCreamPresets();
      this.refreshLayerOptions();
      this.updateExtruderPreview();
    } else {
      this.ensureBrushSelection();
      if (!this.selectedBrush) {
        return;
      }
      this.paintService.setCurrentBrush(this.selectedBrush);
    }
  }

  onPenSettingsChange(): void {
    if (!this.paintService) {
      return;
    }
    this.paintService.updatePenSettings({
      size: Number(this.penSize),
      thickness: Number(this.penThickness),
      color: this.penColor,
    });
  }

  onExtruderVariantChange(): void {
    if (!this.paintService) {
      return;
    }
    this.paintService.setExtruderVariantSelection(this.extruderVariant);
    this.updateExtruderPreview();
  }

  onExtruderCardSelect(variantId: number): void {
    this.extruderVariant = variantId;
    this.onExtruderVariantChange();
  }

  onRandomExtruderVariant(): void {
    this.extruderVariant = 'random';
    this.onExtruderVariantChange();
  }

  onPresetChange(): void {
    if (!this.selectedPresetId) {
      return;
    }

    const preset = this.creamRingPresets.find((item) => item.id === this.selectedPresetId);
    if (preset) {
      this.applyPresetToForm(preset);
    }
    this.updateExtruderPreview();
  }

  onExtruderModeChange(): void {
    if (this.extruderMode === 'RING') {
      this.extruderStartAngle = 0;
      this.extruderEndAngle = 360;
      if (this.extruderPosition === 'SIDE_ARC') {
        this.extruderPosition = 'TOP_EDGE';
      }
    } else if (this.extruderMode === 'ARC') {
      this.extruderEndAngle = Math.max(this.extruderStartAngle + 30, this.extruderEndAngle);
      this.extruderPosition = 'SIDE_ARC';
    } else {
      this.extruderPosition = 'SIDE_ARC';
    }

    this.updateExtruderPreview();
  }

  addExtruderNode(): void {
    this.extruderNodes = [...this.extruderNodes, { angleDeg: 0, heightNorm: this.extruderHeightNorm }];
    this.updateExtruderPreview();
  }

  removeExtruderNode(index: number): void {
    if (this.extruderNodes.length <= 2) {
      return;
    }
    this.extruderNodes = this.extruderNodes.filter((_, idx) => idx !== index);
    this.updateExtruderPreview();
  }

  updateNode(index: number, key: keyof CreamPathNode, value: number): void {
    this.extruderNodes = this.extruderNodes.map((node, idx) =>
      idx === index ? { ...node, [key]: Number(value) } : node,
    );
    this.updateExtruderPreview();
  }

  async onGenerateExtruderStroke(): Promise<void> {
    if (!this.paintService) {
      return;
    }

    const config = this.buildExtruderConfig();
    await this.paintService.generateExtruderStroke(config);
    this.updateExtruderPreview();
  }

  undoLast(): void {
    if (!this.paintService) {
      return;
    }
    this.paintService.undo();
  }

  redoLast(): void {
    if (!this.paintService) {
      return;
    }
    this.paintService.redo();
  }

  canUndo(): boolean {
    return this.paintService ? this.paintService.canUndo() : false;
  }

  canRedo(): boolean {
    return this.paintService ? this.paintService.canRedo() : false;
  }

  private async loadExtruderVariants(): Promise<void> {
    if (!this.paintService) {
      this.extruderVariantCards = [];
      return;
    }

    try {
      this.extruderVariantCards = await this.paintService.getExtruderVariantPreviews();
    } catch (error) {
      console.error('PaintPanel: nie udało się pobrać wariantów ekstrudera', error);
      this.extruderVariantCards = [];
    }
  }

  onBrushSelect(brush: BrushOption): void {
    this.selectedBrush = brush.modelFileName;
    this.onBrushChange();
  }

  private syncPaintServiceState(): void {
    const activeTool = this.paintService.paintTool;
    this.selectedTool = activeTool as SidebarPaintTool;
    this.selectedBrush = this.paintService.currentBrush ?? this.selectedBrush;
    this.penSize = this.paintService.penSize;
    this.penThickness = this.paintService.penThickness;
    this.penColor = this.paintService.penColor;
    this.extruderVariant = this.paintService.getExtruderVariantSelection() ?? 'random';
    this.loadExtruderVariants();
    this.refreshCreamPresets();
    this.refreshLayerOptions();
    this.updateExtruderPreview();
    this.ensureBrushSelection();
  }

  private subscribeToDecorations(): void {
    this.decorationsSubscription?.unsubscribe();
    if (!this.decorationsService) {
      this.brushOptions = [];
      return;
    }

    this.decorationsSubscription = this.decorationsService.decorations$.subscribe((decorations) => {
      this.updateBrushOptions(decorations);
    });
    this.updateBrushOptions(this.decorationsService.getDecorations());
  }

  private subscribeToCreamPresets(): void {
    this.creamPresetSubscription?.unsubscribe();
    if (!this.paintService) {
      this.creamRingPresets = [];
      this.selectedPresetId = null;
      return;
    }

    this.creamPresetSubscription = this.paintService.creamRingPresets$.subscribe((presets) => {
      this.updateCreamPresets(presets ?? []);
      this.updateExtruderPreview();
    });
    this.updateCreamPresets(this.paintService.getCreamRingPresets());
    this.updateExtruderPreview();
  }

  private updateBrushOptions(decorations: DecorationInfo[]): void {
    const uniqueBrushes = new Map<string, BrushOption>();
    decorations
      .filter((decoration) => decoration.paintable === true)
      .forEach((decoration) => {
        const option = this.mapDecorationToBrush(decoration);
        uniqueBrushes.set(option.modelFileName, option);
      });
    this.brushOptions = Array.from(uniqueBrushes.values());
    this.ensureBrushSelection();
  }

  private ensureBrushSelection(): void {
    if (!this.paintService) {
      return;
    }

    if (!this.brushOptions.length) {
      this.selectedBrush = null;
      return;
    }

    const available = this.brushOptions.map((brush) => brush.modelFileName);
    const preferred = this.selectedBrush ?? this.paintService.currentBrush;
    if (preferred && available.includes(preferred)) {
      this.selectedBrush = preferred;
    } else {
      this.selectedBrush = available[0];
    }

    this.paintService.setCurrentBrush(this.selectedBrush);
  }

  private refreshCreamPresets(): void {
    if (!this.paintService) {
      this.updateCreamPresets([]);
      return;
    }

    this.updateCreamPresets(this.paintService.getCreamRingPresets());
  }

  private updateCreamPresets(presets: CreamRingPreset[]): void {
    this.creamRingPresets = presets;
    const availableIds = this.creamRingPresets.map((preset) => preset.id);
    if (!this.selectedPresetId || !availableIds.includes(this.selectedPresetId)) {
      this.selectedPresetId = availableIds[0] ?? null;
    }

    this.applySelectedPreset();
    this.updateExtruderPreview();
  }

  private mapDecorationToBrush(decoration: DecorationInfo): BrushOption {
    return {
      id: decoration.id,
      modelFileName: decoration.modelFileName,
      name: decoration.name,
      thumbnailUrl: decoration.thumbnailUrl,
      paintable: decoration.paintable,
    };
  }

  private applySelectedPreset(): void {
    if (!this.selectedPresetId) {
      return;
    }

    const preset = this.creamRingPresets.find((item) => item.id === this.selectedPresetId);
    if (preset) {
      this.applyPresetToForm(preset);
    }
  }

  private applyPresetToForm(preset: CreamRingPreset): void {
    this.extruderMode = preset.mode;
    this.extruderLayerIndex = preset.layerIndex;
    this.extruderSegments = preset.segments ?? this.extruderSegments;
    this.extruderStartAngle = preset.startAngleDeg ?? this.extruderStartAngle;
    this.extruderEndAngle = preset.endAngleDeg ?? this.extruderEndAngle;
    this.extruderHeightNorm = preset.heightNorm ?? this.extruderHeightNorm;
    this.extruderRadiusOffset = preset.radiusOffset ?? this.extruderRadiusOffset;
    this.extruderScale = preset.scale ?? this.extruderScale;
    this.extruderColor = preset.color ?? this.extruderColor;
    this.extruderPosition = preset.position;
    this.extruderNodes =
      preset.nodes && preset.nodes.length >= 2
        ? preset.nodes.map((node) => ({ ...node }))
        : this.extruderNodes;
  }

  private buildExtruderConfig(): CreamRingPreset {
    return {
      id: this.selectedPresetId ?? 'custom-stroke',
      name: 'Ścieżka ekstrudera',
      mode: this.extruderMode,
      layerIndex: this.extruderLayerIndex,
      position: this.extruderMode === 'RING' ? this.extruderPosition : 'SIDE_ARC',
      segments: this.extruderSegments,
      startAngleDeg: this.extruderStartAngle,
      endAngleDeg: this.extruderMode === 'RING' ? this.extruderStartAngle + 360 : this.extruderEndAngle,
      heightNorm: this.extruderHeightNorm,
      radiusOffset: this.extruderRadiusOffset,
      scale: this.extruderScale,
      color: this.extruderColor || undefined,
      nodes: this.extruderMode === 'PATH' ? this.extruderNodes.map((node) => ({ ...node })) : undefined,
    };
  }

  private refreshLayerOptions(): void {
    if (!this.paintService) {
      this.layerOptions = [0];
      return;
    }

    this.layerOptions = this.paintService.getLayerOptions();
    const maxIndex = Math.max(0, this.layerOptions.length - 1);
    if (this.extruderLayerIndex > maxIndex) {
      this.extruderLayerIndex = Math.max(0, maxIndex);
    }
  }

  getPreviewColor(heightNorm: number): string {
    const green = Math.round(170 + heightNorm * 70);
    const blue = Math.round(180 + heightNorm * 60);
    return `rgb(255, ${Math.min(240, green)}, ${Math.min(240, blue)})`;
  }

  updateExtruderPreview(): void {
    if (!this.paintService) {
      this.extruderPreviewPoints = [];
      return;
    }

    const config = this.buildExtruderConfig();
    const preview = this.paintService
      .getExtruderPreview(config)
      .slice(0, 180)
      .map((point) => ({ angleDeg: point.angleDeg, heightNorm: point.heightNorm }));

    const radius = 48;
    const center = 60;
    this.extruderPreviewPoints = preview.map((point) => {
      const rad = ((point.angleDeg - 90) * Math.PI) / 180;
      const x = center + radius * Math.cos(rad);
      const y = center + radius * Math.sin(rad);
      return { ...point, x, y };
    });
  }
}

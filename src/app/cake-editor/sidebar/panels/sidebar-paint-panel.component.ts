import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DecorationInfo } from '../../../models/decorationInfo';
import { BrushSettings, SidebarPaintMode } from '../sidebar.types';
import { DecorationsService } from '../../../services/decorations.service';
import { AnchorPresetsService } from '../../../services/anchor-presets.service';
import { PaintService } from '../../../services/paint.service';
import { SurfacePaintingService } from '../../../services/surface-painting.service';
import { CreamPathNode, CreamPosition, CreamRingPreset, ExtruderStrokeMode } from '../../../models/cream-presets';
import { DecorationSurfaceTarget } from '../../../models/add-decoration-request';

@Component({
  selector: 'app-sidebar-paint-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-paint-panel.component.html',
  styleUrls: ['./sidebar-paint-panel.component.css'],
})
export class SidebarPaintPanelComponent implements OnInit, OnDestroy {
  @Input() mode: SidebarPaintMode = 'decor3d';
  @Input() paintColor = '#ff4d6d';
  @Input() penSize = 0.02;
  @Input() penThickness = 0.02;
  @Input() penOpacity = 1;
  @Input() brushId = 'trawa.glb';
  @Input() layerCount = 1;
  @Input() paintingEnabled = true;

  @Output() paintModeChange = new EventEmitter<SidebarPaintMode>();
  @Output() brushChange = new EventEmitter<BrushSettings>();
  @Output() paintingPowerChange = new EventEmitter<boolean>();

  decorations: DecorationInfo[] = [];
  decorationSearch = '';
  selectedDecorationId: string | null = null;
  preferredSurface: DecorationSurfaceTarget = 'AUTO';
  targetLayerIndex = 0;

  extruderVariants: { id: number; name: string; thumbnail: string | null }[] = [];
  extruderSelection: number | 'random' = 'random';
  creamPresets: CreamRingPreset[] = [];
  selectedCreamPresetId: string | null = null;
  extruderTab: 'manual' | 'preset' = 'manual';
  showPresetAdvanced = false;
  showPresetPoints = false;
  extruderPathNodes: CreamPathNode[] = [];
  extruderMode: ExtruderStrokeMode = 'RING';
  extruderPosition: CreamPosition = 'SIDE_ARC';
  extruderSegments = 64;
  extruderStartAngle = 0;
  extruderEndAngle = 360;
  extruderHeightNorm = 0.6;
  extruderRadiusOffset = 0.02;
  extruderScale = 1;
  extruderColor = '#ffffff';
  extruderPathModeEnabled = false;

  brushSize = 90;
  sprinkleSize = 40;
  sprinkleDensity = 70;
  sprinkleRandomness = 30;
  sprinkleColor = '#ffffff';

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly decorationsService: DecorationsService,
    private readonly anchorPresetsService: AnchorPresetsService,
    private readonly paintService: PaintService,
    private readonly surfacePaintingService: SurfacePaintingService,
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.decorationsService.decorations$.subscribe((decorations) => (this.decorations = decorations)),
    );
    this.subscriptions.add(
      this.anchorPresetsService.pendingDecoration$.subscribe((decoration) => {
        this.selectedDecorationId = decoration?.modelFileName ?? decoration?.id ?? null;
      }),
    );

    this.loadExtruderVariants();
    this.subscriptions.add(
      this.paintService.creamRingPresets$.subscribe((presets) => {
        this.creamPresets = presets;
        if (!this.selectedCreamPresetId && presets.length) {
          this.selectedCreamPresetId = presets[0].id;
          this.applyPresetToForm(presets[0]);
        }
      }),
    );

    this.subscriptions.add(
      this.paintService.extruderPathNodes$.subscribe((nodes) => (this.extruderPathNodes = nodes)),
    );

    this.brushSize = this.surfacePaintingService.brushSize;
    this.sprinkleDensity = this.surfacePaintingService.sprinkleDensity * 10;
    this.sprinkleRandomness = 30;
    this.sprinkleColor = this.surfacePaintingService.sprinkleColor;
  }

  get layerIndices(): number[] {
    return Array.from({ length: Math.max(this.layerCount, 1) }, (_, index) => index);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get filteredDecorations(): DecorationInfo[] {
    const term = this.decorationSearch.trim().toLowerCase();
    if (!term) {
      return this.decorations;
    }
    return this.decorations.filter((item) => item.name.toLowerCase().includes(term));
  }

  togglePainting(): void {
    this.paintingEnabled = !this.paintingEnabled;
    this.paintingPowerChange.emit(this.paintingEnabled);
  }

  selectMode(mode: SidebarPaintMode): void {
    this.mode = mode;
    this.paintModeChange.emit(mode);
  }

  selectDecoration(decoration: DecorationInfo): void {
    this.selectedDecorationId = decoration.id ?? decoration.modelFileName;
    this.anchorPresetsService.setPendingDecoration(decoration);
    this.paintService.setCurrentBrush(decoration.modelFileName);
    this.brushChange.emit({ brushId: decoration.modelFileName });
  }

  onDecorationSearch(term: string): void {
    this.decorationSearch = term;
  }

  onBrushColorChange(color: string): void {
    this.paintColor = color;
    this.brushChange.emit({ color });
    this.surfacePaintingService.brushColor = color;
  }

  onBrushSizeChange(size: number): void {
    this.brushSize = size;
    this.surfacePaintingService.brushSize = size;
    this.brushChange.emit({ size });
  }

  onPenSizeChange(size: number): void {
    this.penSize = size;
    this.brushChange.emit({ size });
  }

  onPenThicknessChange(value: number): void {
    this.penThickness = value;
    this.brushChange.emit({ thickness: value });
  }

  onPenOpacityChange(value: number): void {
    this.penOpacity = value / 100;
    this.brushChange.emit({ opacity: this.penOpacity });
  }

  onLayerChange(index: number): void {
    this.targetLayerIndex = Math.min(Math.max(Math.round(index), 0), Math.max(this.layerCount - 1, 0));
  }

  onExtruderSelectionChange(selection: number | 'random'): void {
    this.extruderSelection = selection;
    this.paintService.setExtruderVariantSelection(selection);
  }

  onExtruderPresetSelect(presetId: string): void {
    this.selectedCreamPresetId = presetId;
    const preset = this.creamPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    this.applyPresetToForm(preset);
    this.paintService.setExtruderPathMode(preset.mode === 'PATH');
    if (preset.mode === 'PATH') {
      this.extruderPathModeEnabled = true;
      this.paintService.setExtruderPathContext(preset);
      this.paintService.setExtruderPathNodes(preset.nodes ?? [], preset);
    } else {
      this.extruderPathModeEnabled = false;
    }
  }

  onExtruderColorChange(color: string): void {
    this.paintColor = color;
    this.extruderColor = color;
    this.brushChange.emit({ color });
    this.syncExtruderContext();
  }

  onSprinkleDensityChange(value: number): void {
    this.sprinkleDensity = value;
    this.surfacePaintingService.sprinkleDensity = value / 10;
  }

  onSprinkleSizeChange(value: number): void {
    this.sprinkleSize = value;
    this.surfacePaintingService.sprinkleMaxScale = value / 50;
    this.surfacePaintingService.sprinkleMinScale = Math.max(0.1, this.surfacePaintingService.sprinkleMaxScale * 0.6);
  }

  onSprinkleRandomnessChange(value: number): void {
    this.sprinkleRandomness = value;
  }

  onSprinkleColorChange(color: string): void {
    this.sprinkleColor = color;
    this.surfacePaintingService.sprinkleUseRandomColors = false;
    this.surfacePaintingService.sprinkleColor = color;
  }

  toggleExtruderTab(tab: 'manual' | 'preset'): void {
    this.extruderTab = tab;
  }

  togglePresetAdvanced(): void {
    this.showPresetAdvanced = !this.showPresetAdvanced;
  }

  togglePresetPoints(): void {
    this.showPresetPoints = !this.showPresetPoints;
    if (this.showPresetPoints) {
      this.connectExtruderNodes();
    } else if (this.extruderPathModeEnabled) {
      this.setExtruderDrawingMode('free');
    }
  }

  togglePathConnection(): void {
    const enable = !this.extruderPathModeEnabled;
    this.setExtruderDrawingMode(enable ? 'path' : 'free');
  }

  setExtruderDrawingMode(mode: 'path' | 'free'): void {
    this.extruderPathModeEnabled = mode === 'path';
    if (this.extruderPathModeEnabled) {
      this.extruderMode = 'PATH';
      if (!this.extruderPathNodes.length) {
        this.extruderPathNodes = this.getDefaultPathNodes();
      }
    } else {
      this.extruderMode = this.extruderMode === 'PATH' ? 'ARC' : this.extruderMode;
    }

    this.paintService.setExtruderPathMode(this.extruderPathModeEnabled);
    this.syncExtruderContext();
  }

  onExtruderModeChange(mode: ExtruderStrokeMode): void {
    this.extruderMode = mode;
    if (this.extruderMode === 'RING') {
      this.extruderEndAngle = this.extruderStartAngle + 360;
    }
    this.syncExtruderContext();
  }

  onExtruderPositionChange(position: CreamPosition): void {
    this.extruderPosition = position;
    this.syncExtruderContext();
  }

  onExtruderSegmentsChange(value: number): void {
    this.extruderSegments = Math.max(2, Math.round(Number(value)));
    this.syncExtruderContext();
  }

  onExtruderAnglesChange(): void {
    if (this.extruderMode === 'RING') {
      this.extruderEndAngle = this.extruderStartAngle + 360;
    }
    this.syncExtruderContext();
  }

  onExtruderHeightChange(value: number): void {
    this.extruderHeightNorm = Math.min(1, Math.max(0, Number(value)));
    this.syncExtruderContext();
  }

  onExtruderRadiusChange(value: number): void {
    this.extruderRadiusOffset = Number(value);
    this.syncExtruderContext();
  }

  onExtruderScaleChange(value: number): void {
    this.extruderScale = Math.max(0.05, Number(value));
    this.syncExtruderContext();
  }

  onGenerateExtruderStroke(): void {
    const preset = this.getPresetConfig();
    if (!preset) {
      return;
    }
    void this.paintService.generateExtruderStroke(preset);
  }

  updateExtruderNode(index: number, key: keyof CreamPathNode, value: number): void {
    const updatedNodes = this.extruderPathNodes.map((node, idx) =>
      idx === index ? { ...node, [key]: key === 'angleDeg' ? Number(value) : Math.max(0, Math.min(1, Number(value))) } : node,
    );
    this.persistExtruderNodes(updatedNodes);
  }

  addExtruderNode(): void {
    const last = this.extruderPathNodes[this.extruderPathNodes.length - 1];
    const fallback: CreamPathNode = { angleDeg: 0, heightNorm: 0.6 };
    this.persistExtruderNodes([...this.extruderPathNodes, last ? { ...last } : fallback]);
  }

  removeExtruderNode(index: number): void {
    this.persistExtruderNodes(this.extruderPathNodes.filter((_, idx) => idx !== index));
  }

  clearExtruderNodes(): void {
    this.persistExtruderNodes([]);
  }

  private persistExtruderNodes(nodes: CreamPathNode[]): void {
    this.extruderPathNodes = nodes;
    const preset = this.getActivePreset();
    if (preset) {
      this.paintService.setExtruderPathMode(true);
      this.paintService.setExtruderPathNodes(nodes, preset);
    }
  }

  private getActivePreset(): CreamRingPreset | null {
    return this.getPresetConfig();
  }

  private async loadExtruderVariants(): Promise<void> {
    this.extruderSelection = this.paintService.getExtruderVariantSelection();
    this.extruderVariants = await this.paintService.getExtruderVariantPreviews();
  }

  private applyPresetToForm(preset: CreamRingPreset): void {
    this.extruderMode = preset.mode;
    this.extruderPosition = preset.position;
    this.extruderSegments = preset.segments ?? this.extruderSegments;
    this.extruderStartAngle = preset.startAngleDeg ?? 0;
    this.extruderEndAngle = preset.endAngleDeg ?? (preset.mode === 'RING' ? this.extruderStartAngle + 360 : 180);
    this.extruderHeightNorm = preset.heightNorm ?? this.extruderHeightNorm;
    this.extruderRadiusOffset = preset.radiusOffset ?? this.extruderRadiusOffset;
    this.extruderScale = preset.scale ?? this.extruderScale;
    this.extruderColor = preset.color ?? this.extruderColor;
    this.targetLayerIndex = preset.layerIndex;
    this.extruderPathModeEnabled = preset.mode === 'PATH';
    this.extruderPathNodes = preset.nodes?.map((node) => ({ ...node })) ?? this.extruderPathNodes;
    if (this.extruderPathModeEnabled && !this.extruderPathNodes.length) {
      this.extruderPathNodes = this.getDefaultPathNodes();
    }
  }

  private getPresetConfig(): CreamRingPreset | null {
    const active = this.creamPresets.find((item) => item.id === this.selectedCreamPresetId);
    const fallback = this.creamPresets[0];
    const base = active ?? fallback;
    if (!base) {
      return null;
    }

    return {
      ...base,
      mode: this.extruderMode,
      layerIndex: this.targetLayerIndex,
      position: this.extruderPosition,
      segments: this.extruderSegments,
      startAngleDeg: this.extruderStartAngle,
      endAngleDeg: this.extruderMode === 'RING' ? this.extruderStartAngle + 360 : this.extruderEndAngle,
      heightNorm: this.extruderHeightNorm,
      radiusOffset: this.extruderRadiusOffset,
      scale: this.extruderScale,
      color: this.extruderColor,
      nodes: this.extruderMode === 'PATH' ? this.extruderPathNodes.map((node) => ({ ...node })) : base.nodes,
    };
  }

  private syncExtruderContext(): void {
    const config = this.getPresetConfig();
    if (!config) {
      return;
    }
    this.paintService.setExtruderPathContext(config);
    if (this.extruderMode === 'PATH') {
      this.paintService.setExtruderPathNodes(this.extruderPathNodes, config);
    }
  }

  connectExtruderNodes(): void {
    if (!this.extruderPathNodes.length) {
      this.extruderPathNodes = this.getDefaultPathNodes();
    }
    this.setExtruderDrawingMode('path');
    this.syncExtruderContext();
  }

  private getDefaultPathNodes(): CreamPathNode[] {
    return [
      { angleDeg: 0, heightNorm: this.extruderHeightNorm },
      { angleDeg: 180, heightNorm: this.extruderHeightNorm },
    ];
  }
}

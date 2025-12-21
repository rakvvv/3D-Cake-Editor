import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DecorationInfo } from '../../../models/decorationInfo';
import { BrushSettings, SidebarPaintMode } from '../sidebar.types';
import { DecorationsService } from '../../../services/decorations.service';
import { AnchorPresetsService } from '../../../services/anchor-presets.service';
import { PaintService } from '../../../services/paint.service';
import { SurfacePaintingService, SprinkleShape } from '../../../services/surface-painting.service';
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

  private allDecorations: DecorationInfo[] = [];
  decorations: DecorationInfo[] = [];
  decorationSearch = '';
  selectedDecorationId: string | null = null;
  preferredSurface: DecorationSurfaceTarget = 'AUTO';
  targetLayerIndex = 0;

  extruderVariants: { id: number; name: string; thumbnail: string | null; description?: string }[] = [];
  extruderSelection = 0;
  creamPresets: CreamRingPreset[] = [];
  selectedCreamPresetId: string | null = null;
  extruderTab: 'manual' | 'preset' = 'manual';
  showPresetAdvanced = false;
  showPresetPoints = false;
  extruderPathNodes: CreamPathNode[] = [];
  extruderPathHistory: CreamPathNode[][] = [];
  extruderPathRedo: CreamPathNode[][] = [];
  extruderNodePreview: { angleDeg: number; heightNorm: number; position: { x: number; y: number; z: number } | null }[] = [];
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
  nodeErrors: (string | null)[] = [];
  angleError: string | null = null;
  segmentError: string | null = null;
  private userExtruderColor: string | null = null;

  brushSize = 90;
  sprinkleSize = 40;
  sprinkleDensity = 70;
  sprinkleRandomness = 30;
  sprinkleColor = '#ffffff';
  sprinkleShape: SprinkleShape = 'stick';

  sprinkleShapes: { id: SprinkleShape; label: string }[] = [
    { id: 'stick', label: 'Patyczki' },
    { id: 'ball', label: 'Kuleczki' },
    { id: 'star', label: 'Gwiazdki' },
  ];

  private readonly decorationPlaceholder = '/assets/decorations/thumbnails/placeholder.svg';
  private readonly subscriptions = new Subscription();

  constructor(
    private readonly decorationsService: DecorationsService,
    private readonly anchorPresetsService: AnchorPresetsService,
    private readonly paintService: PaintService,
    private readonly surfacePaintingService: SurfacePaintingService,
  ) {}

  ngOnInit(): void {
    this.extruderColor = this.paintColor;
    this.paintService.setExtruderColor(this.extruderColor);
    this.subscriptions.add(
      this.decorationsService.decorations$.subscribe((decorations) => {
        this.allDecorations = decorations;
        this.refreshDecorations();
        this.registerDecorationMetadata(this.decorations);
      }),
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
      this.paintService.extruderPathNodes$.subscribe((nodes) => {
        this.extruderPathNodes = nodes;
        this.validateNodes();
        this.refreshNodePreview();
        this.refreshPathMarkers();
      }),
    );

    this.brushSize = this.surfacePaintingService.brushSize;
    this.sprinkleDensity = this.surfacePaintingService.sprinkleDensity * 10;
    this.sprinkleRandomness = Math.round(this.surfacePaintingService.sprinkleRandomness * 100);
    this.sprinkleColor = this.surfacePaintingService.sprinkleColor;
    this.sprinkleShape = this.surfacePaintingService.sprinkleShape;
    this.validateAngles();
    this.validateSegments();
    this.validateNodes();
    this.refreshNodePreview();
  }

  get layerIndices(): number[] {
    return Array.from({ length: Math.max(this.layerCount, 1) }, (_, index) => index);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get filteredDecorations(): DecorationInfo[] {
    const availableDecorations = this.filterDecorationsForMode(this.decorations);
    const term = this.decorationSearch.trim().toLowerCase();
    if (!term) {
      return availableDecorations;
    }
    return availableDecorations.filter((item) => item.name.toLowerCase().includes(term));
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

  togglePainting(): void {
    this.paintingEnabled = !this.paintingEnabled;
    this.paintingPowerChange.emit(this.paintingEnabled);
    if (this.mode === 'brush' || this.mode === 'sprinkles') {
      this.surfacePaintingService.setEnabled(this.paintingEnabled);
    }
  }

  selectMode(mode: SidebarPaintMode): void {
    this.mode = mode;
    this.paintModeChange.emit(mode);
    this.refreshDecorations();
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
    this.userExtruderColor = color;
    this.extruderColor = color;
    this.syncExtruderContext();
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

  onExtruderSelectionChange(selection: number): void {
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
    this.userExtruderColor = color;
    this.paintColor = color;
    this.extruderColor = color;
    this.brushChange.emit({ color });
    this.paintService.setExtruderColor(color);
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
    this.surfacePaintingService.sprinkleRandomness = value / 100;
  }

  onSprinkleColorChange(color: string): void {
    this.sprinkleColor = color;
    this.surfacePaintingService.sprinkleUseRandomColors = false;
    this.surfacePaintingService.sprinkleColor = color;
  }

  onSprinkleShapeSelect(shape: SprinkleShape): void {
    this.sprinkleShape = shape;
    this.surfacePaintingService.setSprinkleShape(shape);
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
    this.refreshPathMarkers();
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
      this.validateNodes();
      this.refreshNodePreview();
    } else {
      this.extruderMode = this.extruderMode === 'PATH' ? 'ARC' : this.extruderMode;
    }

    this.paintService.setExtruderPathMode(this.extruderPathModeEnabled);
    this.syncExtruderContext();
    this.refreshPathMarkers();
  }

  onExtruderModeChange(mode: ExtruderStrokeMode): void {
    this.extruderMode = mode;
    if (this.extruderMode === 'RING') {
      this.extruderEndAngle = this.extruderStartAngle + 360;
    }
    this.validateAngles();
    this.syncExtruderContext();
  }

  onExtruderPositionChange(position: CreamPosition): void {
    this.extruderPosition = position;
    this.syncExtruderContext();
  }

  onExtruderSegmentsChange(value: number): void {
    this.extruderSegments = Math.max(2, Math.min(512, Math.round(Number(value)) || 2));
    this.validateSegments();
    this.syncExtruderContext();
  }

  onExtruderAnglesChange(): void {
    if (this.extruderMode === 'RING') {
      this.extruderEndAngle = this.extruderStartAngle + 360;
    }
    this.validateAngles();
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
    const numericValue = Number(value);
    const updatedNodes = this.extruderPathNodes.map((node, idx) => {
      if (idx !== index) {
        return { ...node };
      }

      const nextValue =
        key === 'heightNorm'
          ? Math.max(0, Math.min(1, Number.isFinite(numericValue) ? numericValue : 0))
          : Number.isFinite(numericValue)
            ? numericValue
            : 0;
      return { ...node, [key]: nextValue };
    });
    this.persistExtruderNodes(updatedNodes);
  }

  addExtruderNode(): void {
    const last = this.extruderPathNodes[this.extruderPathNodes.length - 1];
    const fallback: CreamPathNode = { angleDeg: 0, heightNorm: 0.6, enabled: true };
    this.persistExtruderNodes([...this.extruderPathNodes.map((node) => ({ ...node })), last ? { ...last } : fallback]);
  }

  removeExtruderNode(index: number): void {
    this.persistExtruderNodes(this.extruderPathNodes.filter((_, idx) => idx !== index));
  }

  clearExtruderNodes(): void {
    this.persistExtruderNodes([]);
  }

  toggleExtruderNodeEnabled(index: number): void {
    const toggledNodes = this.extruderPathNodes.map((node, idx) =>
      idx === index ? { ...node, enabled: node.enabled === false ? true : false } : { ...node },
    );
    this.persistExtruderNodes(toggledNodes);
  }

  undoExtruderNodes(): void {
    const previous = this.extruderPathHistory.pop();
    if (!previous) {
      return;
    }

    this.extruderPathRedo.push(this.cloneExtruderNodes(this.extruderPathNodes));
    this.persistExtruderNodes(previous, true);
  }

  redoExtruderNodes(): void {
    const next = this.extruderPathRedo.pop();
    if (!next) {
      return;
    }

    this.extruderPathHistory.push(this.cloneExtruderNodes(this.extruderPathNodes));
    this.persistExtruderNodes(next, true);
  }

  private persistExtruderNodes(nodes: CreamPathNode[], skipHistory = false): void {
    if (!skipHistory) {
      this.extruderPathHistory.push(this.cloneExtruderNodes(this.extruderPathNodes));
      if (this.extruderPathHistory.length > 50) {
        this.extruderPathHistory.shift();
      }
      this.extruderPathRedo = [];
    }

    this.extruderPathNodes = this.cloneExtruderNodes(nodes);
    this.validateNodes(this.extruderPathNodes);
    const preset = this.getActivePreset();
    if (preset) {
      this.paintService.setExtruderPathMode(true);
      this.paintService.setExtruderPathNodes(this.extruderPathNodes, preset);
    }
    this.refreshNodePreview();
    this.refreshPathMarkers();
  }

  private cloneExtruderNodes(nodes: CreamPathNode[]): CreamPathNode[] {
    return nodes.map((node) => ({ ...node, enabled: node.enabled !== false }));
  }

  private refreshPathMarkers(): void {
    if (!this.extruderPathModeEnabled) {
      return;
    }

    this.paintService.refreshExtruderPathMarkers();
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalShortcuts(event: KeyboardEvent): void {
    if (!this.showPresetPoints || !this.extruderPathModeEnabled) {
      return;
    }

    const isRedo = (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'));
    const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';

    if (isUndo) {
      event.preventDefault();
      this.undoExtruderNodes();
    } else if (isRedo) {
      event.preventDefault();
      this.redoExtruderNodes();
    }
  }

  private validateNodes(nodes: CreamPathNode[] = this.extruderPathNodes): void {
    this.nodeErrors = nodes.map((node) => {
      if (node.enabled === false) {
        return null;
      }
      if (!Number.isFinite(node.angleDeg)) {
        return 'Podaj poprawny kąt punktu.';
      }
      if (node.angleDeg < -720 || node.angleDeg > 720) {
        return 'Kąt powinien mieścić się w zakresie od -720° do 720°.';
      }
      const height = node.heightNorm ?? 0;
      if (!Number.isFinite(height)) {
        return 'Wysokość punktu jest niepoprawna.';
      }
      if (height < 0 || height > 1) {
        return 'Wysokość musi być w zakresie 0-1.';
      }
      return null;
    });
  }

  private validateAngles(): void {
    const startValid = Number.isFinite(this.extruderStartAngle);
    const endValid = Number.isFinite(this.extruderEndAngle);
    this.angleError = null;
    if (!startValid || (!endValid && this.extruderMode !== 'RING')) {
      this.angleError = 'Podaj poprawne wartości kątów.';
      return;
    }

    if (this.extruderMode !== 'RING' && this.extruderEndAngle <= this.extruderStartAngle) {
      this.angleError = 'Kąt końcowy musi być większy od początkowego.';
    }
  }

  private validateSegments(): void {
    this.segmentError = null;
    if (!Number.isFinite(this.extruderSegments)) {
      this.segmentError = 'Liczba segmentów jest niepoprawna.';
      return;
    }

    if (this.extruderSegments < 2 || this.extruderSegments > 512) {
      this.segmentError = 'Segmenty muszą mieścić się w zakresie 2-512.';
    }
  }

  private refreshNodePreview(): void {
    const config = this.getPresetConfig();
    if (!config || config.mode !== 'PATH') {
      this.extruderNodePreview = [];
      return;
    }

    const activePreview = this.paintService.getExtruderNodePreview(config);
    let previewIndex = 0;

    this.extruderNodePreview = this.extruderPathNodes.map((node) => {
      if (node.enabled === false) {
        return { angleDeg: node.angleDeg, heightNorm: node.heightNorm ?? 0.5, position: null };
      }

      const preview = activePreview[previewIndex++];
      return (
        preview ?? {
          angleDeg: node.angleDeg,
          heightNorm: node.heightNorm ?? 0.5,
          position: null,
        }
      );
    });
  }

  private registerDecorationMetadata(decorations: DecorationInfo[]): void {
    decorations.forEach((decoration) => {
      if (!decoration.paintable) {
        return;
      }

      this.paintService.setBrushMetadata(decoration.modelFileName, {
        initialScale: decoration.initialScale,
        initialRotation: decoration.paintInitialRotation ?? decoration.initialRotation,
        material: decoration.material,
        paintInitialRotation: decoration.paintInitialRotation,
        surfaceOffset: decoration.surfaceOffset,
        modelUpAxis: decoration.modelUpAxis,
        modelForwardAxis: decoration.modelForwardAxis,
        faceOutwardOnSides: decoration.faceOutwardOnSides,
      });
    });
  }

  private getActivePreset(): CreamRingPreset | null {
    return this.getPresetConfig();
  }

  private async loadExtruderVariants(): Promise<void> {
    this.extruderSelection = this.paintService.getExtruderVariantSelection();
    this.extruderVariants = await this.paintService.getExtruderVariantPreviews();
    if (this.extruderVariants.length && this.extruderSelection >= this.extruderVariants.length) {
      this.extruderSelection = 0;
      this.paintService.setExtruderVariantSelection(0);
    }
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
    if (!this.userExtruderColor && preset.color) {
      this.extruderColor = preset.color;
      this.paintColor = preset.color;
    }
    this.targetLayerIndex = preset.layerIndex;
    this.extruderPathModeEnabled = preset.mode === 'PATH';
    this.extruderPathNodes = preset.nodes?.map((node) => ({ ...node })) ?? this.extruderPathNodes;
    if (this.extruderPathModeEnabled && !this.extruderPathNodes.length) {
      this.extruderPathNodes = this.getDefaultPathNodes();
    }
    this.extruderPathHistory = [];
    this.extruderPathRedo = [];
    this.validateNodes();
    this.refreshNodePreview();
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
    this.validateAngles();
    this.validateSegments();
    this.refreshNodePreview();
    this.paintService.setExtruderPathContext(config);
    this.paintService.setExtruderColor(this.extruderColor);
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
      { angleDeg: 0, heightNorm: this.extruderHeightNorm, enabled: true },
      { angleDeg: 180, heightNorm: this.extruderHeightNorm, enabled: true },
    ];
  }

  private refreshDecorations(): void {
    this.decorations = this.filterDecorationsForMode(this.allDecorations);
  }

  private filterDecorationsForMode(decorations: DecorationInfo[]): DecorationInfo[] {
    if (!this.requiresPaintableDecorations) {
      return decorations;
    }

    return decorations.filter((item) => item.paintable);
  }

  private get requiresPaintableDecorations(): boolean {
    return this.mode === 'decor3d';
  }
}

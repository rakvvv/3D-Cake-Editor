import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DecorationInfo } from '../../models/decorationInfo';
import { DecorationsService } from '../../services/decorations.service';
import { PaintService } from '../../services/paint.service';

type SidebarPaintTool = 'decoration' | 'pen' | 'extruder';
type ExtruderPreset = 'circle' | 'arc' | 'wave';

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
  presetOptions: { id: ExtruderPreset; name: string }[] = [
    { id: 'circle', name: 'Koło' },
    { id: 'arc', name: 'Łuk' },
    { id: 'wave', name: 'Linia falista' },
  ];
  selectedPreset: ExtruderPreset = 'circle';

  private decorationsSubscription?: Subscription;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.syncPaintServiceState();
    }

    if (changes['decorationsService']) {
      this.subscribeToDecorations();
    }
  }

  ngOnInit(): void {
    this.subscribeToDecorations();
  }

  ngOnDestroy(): void {
    this.decorationsSubscription?.unsubscribe();
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
  }

  onExtruderCardSelect(variantId: number): void {
    this.extruderVariant = variantId;
    this.onExtruderVariantChange();
  }

  onRandomExtruderVariant(): void {
    this.extruderVariant = 'random';
    this.onExtruderVariantChange();
  }

  async onInsertPreset(): Promise<void> {
    if (!this.paintService) {
      return;
    }

    await this.paintService.insertExtruderPreset(this.selectedPreset);
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

  private updateBrushOptions(decorations: DecorationInfo[]): void {
    const uniqueBrushes = new Map<string, BrushOption>();
    decorations
      .filter((decoration) => decoration.paintable)
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

  private mapDecorationToBrush(decoration: DecorationInfo): BrushOption {
    return {
      id: decoration.id,
      modelFileName: decoration.modelFileName,
      name: decoration.name,
      thumbnailUrl: decoration.thumbnailUrl,
      paintable: decoration.paintable,
    };
  }
}

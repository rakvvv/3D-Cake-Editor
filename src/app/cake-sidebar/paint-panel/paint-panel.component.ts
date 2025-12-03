import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaintService } from '../../services/paint.service';

type SidebarPaintTool = 'decoration' | 'pen' | 'extruder';
type ExtruderPreset = 'circle' | 'arc' | 'wave';

type ExtruderVariantCard = {
  id: number;
  name: string;
  thumbnail?: string | null;
};

@Component({
  selector: 'app-paint-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './paint-panel.component.html',
  styleUrls: ['./paint-panel.component.css']
})
export class PaintPanelComponent implements OnChanges {
  @Input() paintService!: PaintService;
  @Output() paintModeChange = new EventEmitter<boolean>();
  @Output() brushChange = new EventEmitter<string>();

  brushList: { id: string; name: string }[] = [
    { id: 'trawa.glb', name: 'Trawa' },
    { id: 'chocolate_kiss.glb', name: 'Stożek' },
  ];

  selectedBrush = this.brushList[0].id;
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
  extruderVariants: { id: number | 'random'; name: string }[] = [
    { id: 'random', name: 'Losowy wariant' },
    { id: 0, name: 'Wariant 1' },
    { id: 1, name: 'Wariant 2' },
    { id: 2, name: 'Wariant 3' },
    { id: 3, name: 'Wariant 4' },
    { id: 4, name: 'Wariant 5' },
  ];
  presetOptions: { id: ExtruderPreset; name: string }[] = [
    { id: 'circle', name: 'Koło' },
    { id: 'arc', name: 'Łuk' },
    { id: 'wave', name: 'Linia falista' },
  ];
  selectedPreset: ExtruderPreset = 'circle';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.selectedBrush = this.paintService.currentBrush || this.brushList[0].id;
      const activeTool = this.paintService.paintTool;
      this.selectedTool = activeTool as SidebarPaintTool;
      this.penSize = this.paintService.penSize;
      this.penThickness = this.paintService.penThickness;
      this.penColor = this.paintService.penColor;
      this.extruderVariant = this.paintService.getExtruderVariantSelection() ?? 'random';
      this.loadExtruderVariants();
    }
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
}

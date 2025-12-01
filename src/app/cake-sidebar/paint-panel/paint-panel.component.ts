import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaintService } from '../../services/paint.service';

type SidebarPaintTool = 'decoration' | 'pen' | 'extruder';

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
  extruderVariants: { id: number | 'random'; name: string }[] = [
    { id: 'random', name: 'Losowy wariant' },
    { id: 0, name: 'Wariant 1' },
    { id: 1, name: 'Wariant 2' },
    { id: 2, name: 'Wariant 3' },
    { id: 3, name: 'Wariant 4' },
    { id: 4, name: 'Wariant 5' },
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.selectedBrush = this.paintService.currentBrush || this.brushList[0].id;
      const activeTool = this.paintService.paintTool;
      this.selectedTool = activeTool as SidebarPaintTool;
      this.penSize = this.paintService.penSize;
      this.penThickness = this.paintService.penThickness;
      this.penColor = this.paintService.penColor;
      this.extruderVariant = this.paintService.getExtruderVariantSelection() ?? 'random';
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
}

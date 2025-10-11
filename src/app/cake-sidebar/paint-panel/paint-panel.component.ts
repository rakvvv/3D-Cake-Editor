import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaintService } from '../../services/paint.service';

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
  paintTools: { id: 'decoration' | 'pen'; name: string }[] = [
    { id: 'decoration', name: 'Dekoracje 3D' },
    { id: 'pen', name: 'Pisak' },
  ];
  selectedTool: 'decoration' | 'pen' = 'decoration';
  penSize = 0.05;
  penThickness = 0.02;
  penColor = '#ff4d6d';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.selectedBrush = this.paintService.currentBrush || this.brushList[0].id;
      this.selectedTool = this.paintService.paintTool;
      this.penSize = this.paintService.penSize;
      this.penThickness = this.paintService.penThickness;
      this.penColor = this.paintService.penColor;
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
}

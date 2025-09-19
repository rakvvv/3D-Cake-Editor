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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.selectedBrush = this.paintService.currentBrush || this.brushList[0].id;
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
    this.paintService.currentBrush = this.selectedBrush;
    this.brushChange.emit(this.selectedBrush);
  }
}

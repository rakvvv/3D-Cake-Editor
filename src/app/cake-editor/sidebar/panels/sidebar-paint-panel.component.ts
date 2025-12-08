import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrushSettings, SidebarPaintMode } from '../sidebar.types';

@Component({
  selector: 'app-sidebar-paint-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-paint-panel.component.html',
  styleUrls: ['./sidebar-paint-panel.component.css'],
})
export class SidebarPaintPanelComponent {
  @Input() mode: SidebarPaintMode = 'decor3d';
  @Input() paintColor = '#ff4d6d';
  @Input() penSize = 0.05;
  @Input() penThickness = 0.02;
  @Input() brushId = 'trawa.glb';

  @Output() paintModeChange = new EventEmitter<SidebarPaintMode>();
  @Output() brushChange = new EventEmitter<BrushSettings>();

  selectMode(mode: SidebarPaintMode): void {
    this.mode = mode;
    this.paintModeChange.emit(mode);
  }

  onBrushIdChange(brushId: string): void {
    this.brushId = brushId;
    this.emitBrushChange();
  }

  onColorChange(color: string): void {
    this.paintColor = color;
    this.emitBrushChange();
  }

  onSizeChange(size: number): void {
    this.penSize = Math.max(size, 0.005);
    this.emitBrushChange();
  }

  onThicknessChange(value: number): void {
    this.penThickness = Math.max(value, 0.003);
    this.emitBrushChange();
  }

  private emitBrushChange(): void {
    const payload: BrushSettings = {
      brushId: this.brushId,
      color: this.paintColor,
      size: this.penSize,
      thickness: this.penThickness,
    };
    this.brushChange.emit(payload);
  }
}

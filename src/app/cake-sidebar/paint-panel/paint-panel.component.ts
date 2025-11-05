import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaintService } from '../../services/paint.service';

type BrushType = 'model' | 'procedural';

interface BrushOption {
  id: string;
  name: string;
  type: BrushType;
}

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

  brushList: BrushOption[] = [
    { id: 'trawa.glb', name: 'Trawa', type: 'model' },
    { id: 'chocolate_kiss.glb', name: 'Stożek', type: 'model' },
    { id: 'procedural:smear-vanilla', name: 'Smuga wanilii', type: 'procedural' },
    { id: 'procedural:smear-confetti', name: 'Smuga konfetti', type: 'procedural' },
    { id: 'procedural:smear-cocoa', name: 'Smuga kakao', type: 'procedural' },
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
  sprinkleTextureOptions: { id: string; name: string }[] = [];
  proceduralBrushColors: Record<string, string> = {};
  proceduralBrushSprinkles: Record<string, string> = {};

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paintService'] && this.paintService) {
      this.selectedBrush = this.paintService.currentBrush || this.brushList[0].id;
      const activeTool = this.paintService.paintTool;
      this.selectedTool =
        activeTool === 'eraser' ? this.paintService.getLastNonEraserTool() : activeTool;
      this.penSize = this.paintService.penSize;
      this.penThickness = this.paintService.penThickness;
      this.penColor = this.paintService.penColor;
      this.sprinkleTextureOptions = this.paintService.getSprinkleTextureOptions();
      this.syncProceduralBrushSettings();
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
    if (this.isProceduralBrush(this.selectedBrush)) {
      this.applyProceduralBrushSettings(this.selectedBrush);
    }
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
      if (this.isProceduralBrush(this.selectedBrush)) {
        this.applyProceduralBrushSettings(this.selectedBrush);
      }
    }
  }

  onProceduralColorChange(): void {
    if (!this.paintService || !this.isProceduralBrush(this.selectedBrush)) {
      return;
    }
    this.applyProceduralBrushSettings(this.selectedBrush);
  }

  onProceduralSprinkleChange(): void {
    if (!this.paintService || !this.isProceduralBrush(this.selectedBrush)) {
      return;
    }
    this.applyProceduralBrushSettings(this.selectedBrush);
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

  isProceduralBrush(brushId: string): boolean {
    return this.paintService ? this.paintService.isProceduralBrush(brushId) : false;
  }

  private syncProceduralBrushSettings(): void {
    if (!this.paintService) {
      return;
    }
    for (const brush of this.brushList.filter((option) => option.type === 'procedural')) {
      const config = this.paintService.getProceduralBrushConfig(brush.id);
      this.proceduralBrushColors[brush.id] = config.color;
      this.proceduralBrushSprinkles[brush.id] = config.sprinkleTextureId ?? 'none';
    }
  }

  private applyProceduralBrushSettings(brushId: string): void {
    if (!this.paintService) {
      return;
    }
    const color = this.proceduralBrushColors[brushId] ?? '#ffffff';
    const sprinkle = this.proceduralBrushSprinkles[brushId] ?? 'none';
    this.paintService.updateProceduralBrushSettings(brushId, {
      color,
      sprinkleTextureId: sprinkle,
    });
  }
}

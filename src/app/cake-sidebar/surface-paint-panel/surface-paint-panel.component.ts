import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SurfacePaintingService, PaintingMode, BrushKind, GradientDirection, SprinkleShape } from '../../services/surface-painting.service';

@Component({
  selector: 'app-surface-paint-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './surface-paint-panel.component.html',
  styleUrls: ['./surface-paint-panel.component.css'],
})
export class SurfacePaintPanelComponent {
  public modes: { id: PaintingMode; label: string }[] = [
    { id: 'brush', label: 'Pędzel' },
    { id: 'gradient', label: 'Gradient' },
    { id: 'sprinkles', label: 'Posypka' },
  ];
  public brushKinds: { id: BrushKind; label: string }[] = [
    { id: 'soft', label: 'Miękki' },
    { id: 'cream', label: 'Kremowy' },
  ];
  public directions: { id: GradientDirection; label: string }[] = [
    { id: 'vertical', label: 'Pionowy' },
    { id: 'horizontal', label: 'Poziomy' },
    { id: 'diag1', label: 'Skośny ↘︎' },
    { id: 'diag2', label: 'Skośny ↙︎' },
    { id: 'radial', label: 'Radialny' },
  ];
  public sprinkleShapes: { id: SprinkleShape; label: string }[] = [
    { id: 'stick', label: 'Patyczki' },
    { id: 'ball', label: 'Kuleczki' },
  ];

  constructor(public readonly painting: SurfacePaintingService) {}

  toggle(): void {
    this.painting.setEnabled(!this.painting.enabled);
  }

  setMode(mode: PaintingMode): void {
    this.painting.mode = mode;
  }

  applyGradient(): void {
    this.painting.applyGradientSettings();
  }

  disableGradient(): void {
    this.painting.disableGradient();
  }

  clearPaint(): void {
    this.painting.clearPaint();
  }
}

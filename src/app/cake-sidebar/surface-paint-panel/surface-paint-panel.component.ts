import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SurfacePaintingService, PaintingMode, GradientDirection, SprinkleShape } from '../../services/surface-painting.service';

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
  public directions: { id: GradientDirection; label: string }[] = [{ id: 'vertical', label: 'Pionowy' }];
  public sprinkleShapes: { id: SprinkleShape; label: string }[] = [
    { id: 'stick', label: 'Patyczki' },
    { id: 'ball', label: 'Kuleczki' },
    { id: 'star', label: 'Gwiazdki' },
  ];

  constructor(public readonly painting: SurfacePaintingService) {}

  toggle(): void {
    this.painting.setEnabled(!this.painting.enabled);
  }

  setMode(mode: PaintingMode): void {
    this.painting.mode = mode;
    if (mode === 'gradient') {
      this.painting.applyGradientSettings();
    }
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

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CakeOptions } from '../../../models/cake.options';

@Component({
  selector: 'app-sidebar-layers-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-layers-panel.component.html',
  styleUrls: ['./sidebar-layers-panel.component.css'],
})
export class SidebarLayersPanelComponent {
  @Input() options!: CakeOptions;
  @Output() optionsChange = new EventEmitter<CakeOptions>();

  sizePreset: 'small' | 'medium' | 'large' = 'medium';

  ngOnChanges(): void {
    this.syncFromOptions();
  }

  onLayerCountChange(value: number): void {
    if (!this.options) return;
    const layers = Math.min(Math.max(Math.round(value), 1), 4);
    const preset = layers === 3 ? 'small' : this.sizePreset;
    this.sizePreset = preset;
    const baseWidth = this.getBaseWidth(preset);
    const layerSizes = this.buildLayerSizes(layers, baseWidth);
    this.emitOptions({ layers, layerSizes, cake_size: 1 });
  }

  onSizePresetChange(preset: 'small' | 'medium' | 'large'): void {
    if (!this.options) return;
    this.sizePreset = preset;
    const width = this.getBaseWidth(preset);
    const layerSizes = this.buildLayerSizes(this.options.layers, width);
    this.emitOptions({ cake_size: 1, layerSizes });
  }

  onShapeChange(shape: 'cylinder' | 'cuboid'): void {
    this.emitOptions({ shape });
  }

  onCakeScaleChange(scale: number): void {
    const next = Math.min(Math.max(scale, 0.6), 1.6);
    this.emitOptions({ cake_size: next });
  }

  trackLayer(_: number, size: number): number {
    return size;
  }

  private emitOptions(partial: Partial<CakeOptions>): void {
    if (!this.options) return;
    const merged = { ...this.options, ...partial } as CakeOptions;
    this.optionsChange.emit(merged);
  }

  private syncFromOptions(): void {
    if (!this.options?.layerSizes?.length) {
      return;
    }

    if (this.options.layers === 3) {
      this.sizePreset = 'small';
      return;
    }

    const base = this.options.layerSizes[0];
    if (base < 0.95) {
      this.sizePreset = 'small';
    } else if (base > 1.05) {
      this.sizePreset = 'large';
    } else {
      this.sizePreset = 'medium';
    }
  }

  private getBaseWidth(preset: 'small' | 'medium' | 'large'): number {
    if (preset === 'small') return 0.9;
    if (preset === 'large') return 1.2;
    return 1;
  }

  private buildLayerSizes(layers: number, baseWidth: number): number[] {
    const widenedBase = baseWidth + (layers - 1) * 0.2;
    return Array.from({ length: layers }, (_, idx) => Math.max(0.6, widenedBase - idx * 0.2));
  }
}

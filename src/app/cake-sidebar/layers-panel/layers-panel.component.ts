import { Component, EventEmitter, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CakeOptions } from '../../models/cake.options';

@Component({
  selector: 'app-layers-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './layers-panel.component.html',
  styleUrls: ['./layers-panel.component.css']
})
export class LayersPanelComponent implements OnDestroy {
  @Output() cakeOptionsChange = new EventEmitter<CakeOptions>();

  readonly minLayerSize = 0.6;
  readonly maxLayerSize = 1.5;
  readonly waferScaleMin = 0.5;
  readonly waferScaleMax = 1.5;
  readonly acceptedWaferTypes = ['image/png', 'image/jpeg', 'image/webp'];
  readonly maxWaferSizeBytes = 5 * 1024 * 1024;

  cakeSize = 1;
  cakeColor = '#ffea00';
  cakeText = false;
  cakeTextValue = 'Urodziny';
  cakeTextPosition: 'top' | 'side' = 'top';
  cakeTextOffset = 0;
  cakeTextFont = 'helvetiker';
  cakeTextDepth = 0.1;
  cakeLayers = 1;
  cakeShape: 'cylinder' | 'cuboid' = 'cylinder';
  cakeLayerSizes: number[] = [1];
  glazeEnabled = true;
  glazeColor = '#f99be6';
  glazeThickness = 0.15;
  glazeDripLength = 1;
  glazeSeed = 1;
  waferTextureUrl: string | null = null;
  waferScale = 1;
  waferError: string | null = null;
  readonly availableFonts = [
    { label: 'Helvetiker', value: 'helvetiker' },
    { label: 'Optimer', value: 'optimer' },
    { label: 'Frosting', value: 'frosting' },
  ];

  onLayersChanged(newCount: number): void {
    const targetCount = Math.max(1, Math.min(5, Math.round(Number(newCount))));
    if (targetCount > this.cakeLayerSizes.length) {
      let previous = this.cakeLayerSizes[this.cakeLayerSizes.length - 1] ?? 1;
      for (let index = this.cakeLayerSizes.length; index < targetCount; index++) {
        previous = this.clampLayerSize(previous - 0.15, this.minLayerSize, previous);
        this.cakeLayerSizes.push(previous);
      }
    } else if (targetCount < this.cakeLayerSizes.length) {
      this.cakeLayerSizes = this.cakeLayerSizes.slice(0, targetCount);
    }

    this.cakeLayers = targetCount;
    this.updateCakeOptions();
  }

  onLayerSizeChanged(index: number, value: number): void {
    const numericValue = Number(value);
    const maxNeighbor = index > 0 ? this.cakeLayerSizes[index - 1] : this.maxLayerSize;
    const minNeighbor = index < this.cakeLayerSizes.length - 1 ? this.cakeLayerSizes[index + 1] : this.minLayerSize;
    const clampedValue = this.clampLayerSize(
      numericValue,
      Math.max(this.minLayerSize, minNeighbor),
      Math.min(this.maxLayerSize, maxNeighbor),
    );
    this.cakeLayerSizes[index] = clampedValue;
    this.updateCakeOptions();
  }

  ngOnDestroy(): void {
    this.clearWaferPreview();
  }

  private clampLayerSize(value: number, min: number, max: number): number {
    let effectiveMin = min;
    let effectiveMax = max;
    if (effectiveMin > effectiveMax) {
      [effectiveMin, effectiveMax] = [effectiveMax, effectiveMin];
    }
    return Math.min(Math.max(value, effectiveMin), effectiveMax);
  }

  updateCakeOptions(): void {
    this.cakeOptionsChange.emit({
      cake_size: this.cakeSize,
      cake_color: this.cakeColor,
      cake_text: this.cakeText,
      cake_text_value: this.cakeTextValue,
      cake_text_position: this.cakeTextPosition,
      cake_text_offset: this.cakeTextOffset,
      cake_text_font: this.cakeTextFont,
      cake_text_depth: this.cakeTextDepth,
      layers: this.cakeLayers,
      shape: this.cakeShape,
      layerSizes: [...this.cakeLayerSizes],
      glaze_enabled: this.glazeEnabled,
      glaze_color: this.glazeColor,
      glaze_thickness: this.glazeThickness,
      glaze_drip_length: this.glazeDripLength,
      glaze_seed: this.glazeSeed,
      wafer_texture_url: this.waferTextureUrl,
      wafer_scale: this.waferScale,
    });
  }

  onWaferFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.processWaferFile(file);
    input.value = '';
  }

  private processWaferFile(file: File | null): void {
    if (!file) {
      this.clearWaferPreview();
      this.waferError = null;
      this.updateCakeOptions();
      return;
    }

    if (!this.acceptedWaferTypes.includes(file.type)) {
      this.waferError = 'Dozwolone są jedynie pliki PNG, JPG lub WebP.';
      this.clearWaferPreview();
      this.updateCakeOptions();
      return;
    }

    if (file.size > this.maxWaferSizeBytes) {
      this.waferError = 'Plik jest za duży. Maksymalny rozmiar to 5 MB.';
      this.clearWaferPreview();
      this.updateCakeOptions();
      return;
    }

    if (this.waferTextureUrl) {
      URL.revokeObjectURL(this.waferTextureUrl);
    }

    this.waferTextureUrl = URL.createObjectURL(file);
    this.waferError = null;
    this.updateCakeOptions();
  }

  private clearWaferPreview(): void {
    if (this.waferTextureUrl) {
      URL.revokeObjectURL(this.waferTextureUrl);
    }
    this.waferTextureUrl = null;
  }
}

import { Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild } from '@angular/core';
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
  @ViewChild('waferViewport') waferViewport?: ElementRef<HTMLDivElement>;

  readonly minLayerSize = 0.6;
  readonly maxLayerSize = 1.5;
  readonly waferScaleMin = 0.5;
  readonly waferScaleMax = 1.5;
  readonly waferZoomMin = 1;
  readonly waferZoomMax = 3.5;
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
  waferTextureZoom = 1;
  waferTextureOffsetX = 0;
  waferTextureOffsetY = 0;
  waferError: string | null = null;
  waferEditorOpen = false;
  private waferEditorSnapshot: { zoom: number; offsetX: number; offsetY: number } | null = null;
  private waferEditorDirty = false;
  private waferDragStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;

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

  private clampOffset(value: number, limit: number): number {
    return Math.min(Math.max(value, -limit), limit);
  }

  private getWaferOffsetLimit(zoom: number = this.waferTextureZoom): number {
    const clampedZoom = this.clampLayerSize(Number(zoom), this.waferZoomMin, this.waferZoomMax);
    return Math.max(0, 0.5 * (clampedZoom - 1));
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
      wafer_texture_zoom: this.waferTextureZoom,
      wafer_texture_offset_x: this.waferTextureOffsetX,
      wafer_texture_offset_y: this.waferTextureOffsetY,
    });
  }

  onWaferFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.processWaferFile(file);
    input.value = '';
  }

  openWaferEditor(): void {
    if (!this.waferTextureUrl) {
      return;
    }
    this.waferEditorSnapshot = {
      zoom: this.waferTextureZoom,
      offsetX: this.waferTextureOffsetX,
      offsetY: this.waferTextureOffsetY,
    };
    this.waferEditorDirty = false;
    this.waferEditorOpen = true;
  }

  closeWaferEditor(): void {
    if (this.waferEditorDirty && this.waferEditorSnapshot) {
      this.waferTextureZoom = this.waferEditorSnapshot.zoom;
      this.waferTextureOffsetX = this.waferEditorSnapshot.offsetX;
      this.waferTextureOffsetY = this.waferEditorSnapshot.offsetY;
    }
    this.waferEditorDirty = false;
    this.waferEditorOpen = false;
    this.waferDragStart = null;
  }

  confirmWaferEditor(): void {
    this.waferEditorOpen = false;
    this.waferEditorDirty = false;
    this.updateCakeOptions();
  }

  onWaferZoomChanged(value: number): void {
    this.waferTextureZoom = this.clampLayerSize(Number(value), this.waferZoomMin, this.waferZoomMax);
    const offsetLimit = this.getWaferOffsetLimit(this.waferTextureZoom);
    this.waferTextureOffsetX = this.clampOffset(this.waferTextureOffsetX, offsetLimit);
    this.waferTextureOffsetY = this.clampOffset(this.waferTextureOffsetY, offsetLimit);
    this.waferEditorDirty = true;
  }

  onWaferPointerDown(event: PointerEvent): void {
    if (!this.waferTextureUrl || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.waferViewport?.nativeElement.setPointerCapture(event.pointerId);
    this.waferDragStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: this.waferTextureOffsetX,
      offsetY: this.waferTextureOffsetY,
    };
  }

  onWaferPointerMove(event: PointerEvent): void {
    if (!this.waferDragStart || !this.waferViewport) {
      return;
    }
    event.preventDefault();
    const rect = this.waferViewport.nativeElement.getBoundingClientRect();
    const deltaX = (event.clientX - this.waferDragStart.x) / rect.width;
    const deltaY = (event.clientY - this.waferDragStart.y) / rect.height;
    const offsetLimit = this.getWaferOffsetLimit();
    this.waferTextureOffsetX = this.clampOffset(this.waferDragStart.offsetX - deltaX, offsetLimit);
    this.waferTextureOffsetY = this.clampOffset(this.waferDragStart.offsetY - deltaY, offsetLimit);
    this.waferEditorDirty = true;
  }

  onWaferPointerUp(event: PointerEvent): void {
    if (this.waferDragStart && this.waferViewport) {
      this.waferViewport.nativeElement.releasePointerCapture(event.pointerId);
    }
    this.waferDragStart = null;
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
    this.waferTextureZoom = 1;
    this.waferTextureOffsetX = 0;
    this.waferTextureOffsetY = 0;
    this.waferError = null;
    this.waferEditorOpen = true;
    this.updateCakeOptions();
  }

  private clearWaferPreview(): void {
    if (this.waferTextureUrl) {
      URL.revokeObjectURL(this.waferTextureUrl);
    }
    this.waferTextureUrl = null;
    this.waferTextureZoom = 1;
    this.waferTextureOffsetX = 0;
    this.waferTextureOffsetY = 0;
    this.waferEditorOpen = false;
  }

  get waferPreviewStyle(): Record<string, string> {
    if (!this.waferTextureUrl) {
      return {};
    }

    const zoom = this.clampLayerSize(this.waferTextureZoom, this.waferZoomMin, this.waferZoomMax);
    const offsetLimit = this.getWaferOffsetLimit(zoom);
    const offsetX = this.clampOffset(this.waferTextureOffsetX, offsetLimit);
    const offsetY = this.clampOffset(this.waferTextureOffsetY, offsetLimit);
    const backgroundSize = `${zoom * 100}% ${zoom * 100}%`;
    const backgroundPosition = `${this.computeWaferBackgroundPosition(offsetX, zoom)} ${this.computeWaferBackgroundPosition(offsetY, zoom)}`;

    return {
      backgroundImage: `url(${this.waferTextureUrl})`,
      backgroundSize,
      backgroundPosition,
    };
  }

  private computeWaferTransform(): { repeat: number; offsetX: number; offsetY: number } {
    const zoom = this.clampLayerSize(this.waferTextureZoom, this.waferZoomMin, this.waferZoomMax);
    const repeat = 1 / zoom;
    const offsetLimit = this.getWaferOffsetLimit(zoom);
    const offsetX = this.clampOffset(this.waferTextureOffsetX, offsetLimit);
    const offsetY = this.clampOffset(this.waferTextureOffsetY, offsetLimit);

    return {
      repeat,
      offsetX: 0.5 - repeat / 2 + offsetX * repeat,
      offsetY: 0.5 - repeat / 2 + offsetY * repeat,
    };
  }

  private computeWaferBackgroundPosition(offset: number, zoom: number): string {
    if (zoom === 1) {
      return '50%';
    }

    const position = ((0.5 * zoom + offset - 0.5) / (zoom - 1)) * 100;
    return `${position}%`;
  }
}

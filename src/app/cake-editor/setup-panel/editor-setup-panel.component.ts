import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CakeOptions, TextureMaps } from '../../models/cake.options';

@Component({
  selector: 'app-editor-setup-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor-setup-panel.component.html',
  styleUrls: ['./editor-setup-panel.component.css'],
})
export class EditorSetupPanelComponent {
  @Input() options!: CakeOptions;
  @Input() setupTab: 'cake' | 'texture' | 'color' | 'glaze' = 'cake';
  @Input() selectedCakeSize: 'small' | 'medium' | 'large' = 'medium';
  @Input() selectedShape: 'cylinder' | 'cuboid' = 'cylinder';
  @Input() selectedLayers = 1;
  @Input() selectedTextureId = 'vanilla';
  @Input() gradientEnabled = false;
  @Input() gradientDirection: 'top-bottom' | 'bottom-top' = 'top-bottom';
  @Input() primaryColor = '#ffffff';
  @Input() gradientFirst = '#ffffff';
  @Input() gradientSecond = '#ffffff';
  @Input() glazeMode: 'taffla' | 'plain' = 'taffla';
  @Input() glazeEnabled = true;
  @Input() waferEnabled = false;
  @Input() waferZoom = 1;
  @Input() waferScale = 1;
  @Input() waferOffsetX = 0;
  @Input() waferOffsetY = 0;
  @Input() setupTextures: { id: string; name: string; preview: string; maps: TextureMaps }[] = [];

  @Output() setupTabChange = new EventEmitter<'cake' | 'texture' | 'color' | 'glaze'>();
  @Output() cakeSizeChange = new EventEmitter<'small' | 'medium' | 'large'>();
  @Output() shapeChange = new EventEmitter<'cylinder' | 'cuboid'>();
  @Output() layersChange = new EventEmitter<number>();
  @Output() textureChange = new EventEmitter<string>();
  @Output() cakeColorChange = new EventEmitter<string>();
  @Output() gradientToggle = new EventEmitter<boolean>();
  @Output() gradientColorChange = new EventEmitter<{ which: 'first' | 'second'; color: string }>();
  @Output() gradientDirectionChange = new EventEmitter<'top-bottom' | 'bottom-top'>();
  @Output() glazeToggle = new EventEmitter<boolean>();
  @Output() glazeModeChange = new EventEmitter<'taffla' | 'plain'>();
  @Output() glazeColorChange = new EventEmitter<string>();
  @Output() waferToggle = new EventEmitter<boolean>();
  @Output() waferColorChange = new EventEmitter<string>();
  @Output() waferScaleChange = new EventEmitter<number>();
  @Output() waferZoomChange = new EventEmitter<number>();
  @Output() waferOffsetChange = new EventEmitter<{ axis: 'x' | 'y'; value: number }>();
  @Output() waferFileSelected = new EventEmitter<Event>();
  @Output() continue = new EventEmitter<void>();
  @Output() canvasReady = new EventEmitter<ElementRef>();

  @ViewChild('canvasContainer') set canvasContainer(element: ElementRef | undefined) {
    if (element) {
      this.canvasReady.emit(element);
    }
  }

  getInputValue(event: Event): string {
    const target = event.target as HTMLInputElement | null;
    return target?.value ?? '';
  }
}

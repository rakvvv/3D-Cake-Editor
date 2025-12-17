import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecoratedCakePreset } from '../../../models/cake-preset';

@Component({
  selector: 'app-sidebar-presets-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar-presets-panel.component.html',
  styleUrls: ['./sidebar-presets-panel.component.css'],
})
export class SidebarPresetsPanelComponent {
  @Input() presets: DecoratedCakePreset[] = [];
  @Output() applyCakePreset = new EventEmitter<DecoratedCakePreset>();

  private readonly presetPlaceholder = '/assets/presets/placeholder.svg';

  onApplyPreset(preset: DecoratedCakePreset): void {
    this.applyCakePreset.emit(preset);
  }

  getPresetThumbnail(preset: DecoratedCakePreset): string {
    return preset.thumbnailUrl || this.presetPlaceholder;
  }

  onPresetThumbnailError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.dataset['fallback'] === 'true') {
      return;
    }

    img.dataset['fallback'] = 'true';
    img.src = new URL(this.presetPlaceholder, img.baseURI).toString();
  }
}

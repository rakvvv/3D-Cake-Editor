import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecoratedCakePreset } from '../../../models/cake-preset';
import { environment } from '../../../../environments/environment';

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
  private readonly apiBaseUrl = environment.apiBaseUrl;

  onApplyPreset(preset: DecoratedCakePreset): void {
    this.applyCakePreset.emit(preset);
  }

  getPresetThumbnail(preset: DecoratedCakePreset): string {
    return this.normalizePresetThumbnail(preset.thumbnailUrl) || this.presetPlaceholder;
  }

  onPresetThumbnailError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.dataset['fallback'] === 'true') {
      return;
    }

    img.dataset['fallback'] = 'true';
    img.src = new URL(this.presetPlaceholder, img.baseURI).toString();
  }

  private normalizePresetThumbnail(url?: string): string | null {
    if (!url) {
      return null;
    }

    if (/^(https?:|data:|blob:)/i.test(url)) {
      return url;
    }

    if (url.startsWith('/api/') && this.apiBaseUrl && !this.apiBaseUrl.startsWith('/')) {
      try {
        return new URL(url, this.apiBaseUrl).toString();
      } catch {
        return url;
      }
    }

    return url;
  }
}

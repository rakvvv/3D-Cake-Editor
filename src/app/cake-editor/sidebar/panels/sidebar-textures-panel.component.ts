import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CakeOptions, TextureMaps } from '../../../models/cake.options';
import { SidebarTextureOption } from '../sidebar.types';

@Component({
  selector: 'app-sidebar-textures-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-textures-panel.component.html',
  styleUrls: ['./sidebar-textures-panel.component.css'],
})
export class SidebarTexturesPanelComponent {
  @Input() options!: CakeOptions;
  @Input() textures: SidebarTextureOption[] = [];
  @Output() optionsChange = new EventEmitter<CakeOptions>();

  onCakeColorChange(color: string): void {
    if (!this.options) return;
    this.emitOptions({ cake_color: color, cake_textures: null });
  }

  onTextureSelected(texture: SidebarTextureOption): void {
    const maps = texture.maps as TextureMaps;
    this.emitOptions({ cake_textures: maps, cake_color: '#ffffff' });
  }

  onGlazeToggle(enabled: boolean): void {
    this.emitOptions({ glaze_enabled: enabled });
  }

  onGlazeTopToggle(enabled: boolean): void {
    this.emitOptions({ glaze_top_enabled: enabled });
  }

  onGlazeColorChange(color: string): void {
    this.emitOptions({ glaze_color: color });
  }

  onWaferToggle(enabled: boolean): void {
    const fallback = this.options?.wafer_texture_url ?? '/assets/textures/Pink%20Candy_BaseColor.jpg';
    this.emitOptions({
      wafer_texture_url: enabled ? fallback : null,
      wafer_texture_zoom: enabled ? this.options.wafer_texture_zoom : 1,
      wafer_scale: enabled ? this.options.wafer_scale : 1,
    });
  }

  private emitOptions(partial: Partial<CakeOptions>): void {
    if (!this.options) return;
    const merged = { ...this.options, ...partial } as CakeOptions;
    this.optionsChange.emit(merged);
  }
}

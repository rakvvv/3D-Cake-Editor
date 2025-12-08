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

  onApplyPreset(preset: DecoratedCakePreset): void {
    this.applyCakePreset.emit(preset);
  }
}

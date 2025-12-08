import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AddDecorationRequest, DecorationSurfaceTarget } from '../../../models/add-decoration-request';
import { DecorationInfo } from '../../../models/decorationInfo';

@Component({
  selector: 'app-sidebar-decorations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-decorations-panel.component.html',
  styleUrls: ['./sidebar-decorations-panel.component.css'],
})
export class SidebarDecorationsPanelComponent {
  @Input() decorations: DecorationInfo[] = [];
  @Input() layerCount = 1;
  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();

  searchTerm = '';
  preferredSurface: DecorationSurfaceTarget = 'AUTO';
  targetLayerIndex = 0;
  readonly Math = Math;

  get filteredDecorations(): DecorationInfo[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.decorations;
    }
    return this.decorations.filter((item) => item.name.toLowerCase().includes(term));
  }

  onAddDecoration(decoration: DecorationInfo): void {
    const request: AddDecorationRequest = {
      modelFileName: decoration.modelFileName,
      preferredSurface: this.preferredSurface === 'AUTO' ? undefined : this.preferredSurface,
      targetLayerIndex: this.targetLayerIndex,
    };
    this.addDecoration.emit(request);
  }

  onLayerChange(index: number): void {
    this.targetLayerIndex = Math.min(Math.max(Math.round(index), 0), Math.max(this.layerCount - 1, 0));
  }
}

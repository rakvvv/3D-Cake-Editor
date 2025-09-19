import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DecorationInfo } from '../../models/decorationInfo';
import { DecorationsService } from '../../services/decorations.service';

@Component({
  selector: 'app-decorations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './decorations-panel.component.html',
  styleUrls: ['./decorations-panel.component.css']
})
export class DecorationsPanelComponent implements OnChanges {
  @Input() decorationsService!: DecorationsService;
  @Output() addDecoration = new EventEmitter<string>();
  @Output() attachSelectedToCake = new EventEmitter<void>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();

  filterText = '';
  filterType: 'ALL' | 'TOP' | 'SIDE' = 'ALL';
  decorations: DecorationInfo[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['decorationsService'] && this.decorationsService) {
      this.decorations = this.decorationsService.getDecorations();
    }
  }

  get filteredDecorations(): DecorationInfo[] {
    return this.decorations.filter((decoration) => {
      const matchesText = decoration.name.toLowerCase().includes(this.filterText.toLowerCase());
      const matchesType = this.filterType === 'ALL' || decoration.type === this.filterType;
      return matchesText && matchesType;
    });
  }

  onAddDecoration(identifier: string): void {
    this.addDecoration.emit(identifier);
  }

  onAttachSelectedToCake(): void {
    this.attachSelectedToCake.emit();
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformModeChange.emit(mode);
  }
}

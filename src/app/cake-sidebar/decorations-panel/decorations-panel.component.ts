import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DecorationInfo, DecorationPlacementType } from '../../models/decorationInfo';
import { DecorationsService } from '../../services/decorations.service';
import { DecorationValidationIssue } from '../../models/decoration-validation';

@Component({
  selector: 'app-decorations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './decorations-panel.component.html',
  styleUrls: ['./decorations-panel.component.css']
})
export class DecorationsPanelComponent implements OnChanges {
  @Input() decorationsService!: DecorationsService;
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingActionLabel: string | null = null;
  @Output() addDecoration = new EventEmitter<string>();
  @Output() validateDecorations = new EventEmitter<void>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();

  filterText = '';
  filterType: 'ALL' | DecorationPlacementType = 'ALL';
  decorations: DecorationInfo[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['decorationsService'] && this.decorationsService) {
      this.decorations = this.decorationsService.getDecorations();
    }
  }

  get filteredDecorations(): DecorationInfo[] {
    return this.decorations.filter((decoration) => {
      const matchesText = decoration.name.toLowerCase().includes(this.filterText.toLowerCase());
      const matchesType =
        this.filterType === 'ALL' || decoration.type === this.filterType;
      return matchesText && matchesType;
    });
  }

  onAddDecoration(identifier: string): void {
    this.addDecoration.emit(identifier);
  }

  onValidateDecorations(): void {
    this.validateDecorations.emit();
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformModeChange.emit(mode);
  }

  displayTypeLabel(type: DecorationPlacementType): string {
    switch (type) {
      case 'TOP':
        return 'Na górę';
      case 'SIDE':
        return 'Na bok';
      case 'BOTH':
        return 'Na górę i bok';
      default:
        return type;
    }
  }

  get hasValidationIssues(): boolean {
    return this.validationIssues.length > 0;
  }
}

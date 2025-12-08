import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecorationValidationIssue } from '../../../models/decoration-validation';

@Component({
  selector: 'app-sidebar-export-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar-export-panel.component.html',
  styleUrls: ['./sidebar-export-panel.component.css'],
})
export class SidebarExportPanelComponent {
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] | null = null;
  @Input() pendingValidationLabel: string | null = null;

  @Output() validateDecorations = new EventEmitter<void>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();
  @Output() saveScene = new EventEmitter<void>();
  @Output() exportObj = new EventEmitter<void>();
  @Output() exportStl = new EventEmitter<void>();
  @Output() exportGltf = new EventEmitter<void>();
}

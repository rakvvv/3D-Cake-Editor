import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CakeSidebarComponent, SidebarPanelKey } from '../../cake-sidebar/cake-sidebar.component';
import { CakeOptions } from '../../models/cake.options';
import { AddDecorationRequest } from '../../models/add-decoration-request';
import { DecorationValidationIssue } from '../../models/decoration-validation';
import { DecoratedCakePreset } from '../../models/cake-preset';

@Component({
  selector: 'app-workspace-right-sidebar',
  standalone: true,
  imports: [CommonModule, CakeSidebarComponent],
  templateUrl: './workspace-right-sidebar.component.html',
  styleUrls: ['./workspace-right-sidebar.component.css'],
})
export class WorkspaceRightSidebarComponent {
  @Input() options!: CakeOptions;
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingValidationLabel: string | null = null;
  @Input() authorModeEnabled = false;

  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();
  @Output() saveScene = new EventEmitter<void>();
  @Output() validateDecorations = new EventEmitter<void>();
  @Output() optionsChange = new EventEmitter<CakeOptions>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();
  @Output() paintModeChange = new EventEmitter<boolean>();
  @Output() brushChange = new EventEmitter<string>();
  @Output() exportObj = new EventEmitter<void>();
  @Output() exportStl = new EventEmitter<void>();
  @Output() exportGltf = new EventEmitter<void>();
  @Output() screenshot = new EventEmitter<void>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();
  @Output() applyCakePreset = new EventEmitter<DecoratedCakePreset>();

  @ViewChild(CakeSidebarComponent) sidebar?: CakeSidebarComponent;

  focusPanel(panel: SidebarPanelKey): void {
    this.sidebar?.focusPanel(panel);
  }
}

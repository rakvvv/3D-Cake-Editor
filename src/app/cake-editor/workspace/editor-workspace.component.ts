import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { SceneOutlineComponent } from '../../cake-sidebar/scene-outline/scene-outline.component';
import { CakeOptions } from '../../models/cake.options';
import { AddDecorationRequest } from '../../models/add-decoration-request';
import { DecorationValidationIssue } from '../../models/decoration-validation';
import { DecoratedCakePreset } from '../../models/cake-preset';
import { WorkspaceToolbarComponent } from './workspace-toolbar.component';
import { WorkspaceViewportComponent } from './workspace-viewport.component';
import { WorkspaceRightSidebarComponent } from './workspace-right-sidebar.component';
import { SidebarPanelKey } from '../../cake-sidebar/cake-sidebar.component';

@Component({
  selector: 'app-editor-workspace',
  standalone: true,
  imports: [
    CommonModule,
    SceneOutlineComponent,
    WorkspaceToolbarComponent,
    WorkspaceViewportComponent,
    WorkspaceRightSidebarComponent,
  ],
  templateUrl: './editor-workspace.component.html',
  styleUrls: ['./editor-workspace.component.css'],
})
export class EditorWorkspaceComponent {
  @Input() options!: CakeOptions;
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingValidationLabel: string | null = null;
  @Input() authorModeEnabled = false;
  @Input() currentTransformMode: 'translate' | 'rotate' | 'scale' = 'translate';

  @Output() optionsChange = new EventEmitter<CakeOptions>();
  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();
  @Output() saveScene = new EventEmitter<void>();
  @Output() validateDecorations = new EventEmitter<void>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();
  @Output() paintModeChange = new EventEmitter<boolean>();
  @Output() brushChange = new EventEmitter<string>();
  @Output() exportObj = new EventEmitter<void>();
  @Output() exportStl = new EventEmitter<void>();
  @Output() exportGltf = new EventEmitter<void>();
  @Output() screenshot = new EventEmitter<void>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();
  @Output() applyCakePreset = new EventEmitter<DecoratedCakePreset>();
  @Output() canvasReady = new EventEmitter<ElementRef>();

  @ViewChild(WorkspaceRightSidebarComponent) sidebar?: WorkspaceRightSidebarComponent;

  focusPanel(panel: SidebarPanelKey): void {
    this.sidebar?.focusPanel(panel);
  }
}

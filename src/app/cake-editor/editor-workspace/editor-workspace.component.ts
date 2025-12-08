import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CakeOptions } from '../../models/cake.options';
import { DecorationValidationIssue } from '../../models/decoration-validation';
import { AddDecorationRequest } from '../../models/add-decoration-request';
import { DecoratedCakePreset } from '../../models/cake-preset';
import { SceneOutlineComponent } from '../../editor-sidebar/scene-outline/scene-outline.component';
import { WorkspaceToolbarComponent } from '../workspace-toolbar/workspace-toolbar.component';
import { WorkspaceViewportComponent } from '../workspace-viewport/workspace-viewport.component';
import { EditorSidebarComponent } from '../../editor-sidebar/editor-sidebar.component';

@Component({
  selector: 'app-editor-workspace',
  standalone: true,
  imports: [
    CommonModule,
    SceneOutlineComponent,
    WorkspaceToolbarComponent,
    WorkspaceViewportComponent,
    EditorSidebarComponent,
  ],
  templateUrl: './editor-workspace.component.html',
  styleUrls: ['../cake-editor.component.css'],
})
export class EditorWorkspaceComponent {
  @Input() options!: CakeOptions;
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingValidationLabel: string | null = null;
  @Input() authorModeEnabled = false;
  @Input() projectName = '';

  @Output() optionsChange = new EventEmitter<CakeOptions>();
  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();
  @Output() validateDecorations = new EventEmitter<void>();
  @Output() saveScene = new EventEmitter<void>();
  @Output() applyCakePreset = new EventEmitter<DecoratedCakePreset>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();
  @Output() exportObj = new EventEmitter<void>();
  @Output() exportStl = new EventEmitter<void>();
  @Output() exportGltf = new EventEmitter<void>();
  @Output() brushChange = new EventEmitter<string>();
  @Output() paintModeChange = new EventEmitter<boolean>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();
  @Output() screenshot = new EventEmitter<void>();
  @Output() canvasReady = new EventEmitter<ElementRef<HTMLDivElement>>();

  @ViewChild(EditorSidebarComponent) sidebar?: EditorSidebarComponent;

  activePanel: 'decorations' | 'paint' = 'decorations';

  focusDecorations(): void {
    this.activePanel = 'decorations';
    this.sidebar?.focusPanel('decorations');
    this.paintModeChange.emit(false);
  }

  focusPaint(): void {
    this.activePanel = 'paint';
    this.sidebar?.focusPanel('paint');
    this.paintModeChange.emit(true);
  }

  handleCanvasReady(container: ElementRef<HTMLDivElement>): void {
    this.canvasReady.emit(container);
  }
}

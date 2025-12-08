import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-workspace-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './workspace-toolbar.component.html',
  styleUrls: ['../cake-editor.component.css'],
})
export class WorkspaceToolbarComponent {
  @Input() activePanel: 'decorations' | 'paint' = 'decorations';

  @Output() decorationsRequested = new EventEmitter<void>();
  @Output() paintRequested = new EventEmitter<void>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();

  onTransformModeChange(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformModeChange.emit(mode);
  }

  openDecorations(): void {
    this.decorationsRequested.emit();
  }

  openPaint(): void {
    this.paintRequested.emit();
  }
}

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-workspace-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './workspace-toolbar.component.html',
  styleUrls: ['./workspace-toolbar.component.css'],
})
export class WorkspaceToolbarComponent {
  @Input() currentTransformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  @Output() decorationsRequested = new EventEmitter<void>();
  @Output() paintRequested = new EventEmitter<void>();
  @Output() transformModeChange = new EventEmitter<'translate' | 'rotate' | 'scale'>();
}

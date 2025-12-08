import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-workspace-viewport',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './workspace-viewport.component.html',
  styleUrls: ['./workspace-viewport.component.css'],
})
export class WorkspaceViewportComponent {
  @Output() canvasReady = new EventEmitter<ElementRef>();

  @ViewChild('canvasContainer') set canvasContainer(element: ElementRef | undefined) {
    if (element) {
      this.canvasReady.emit(element);
    }
  }
}

import { AfterViewInit, Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-workspace-viewport',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './workspace-viewport.component.html',
  styleUrls: ['../cake-editor.component.css'],
})
export class WorkspaceViewportComponent implements AfterViewInit {
  @ViewChild('canvasContainer', { static: true }) canvasContainer?: ElementRef<HTMLDivElement>;
  @Output() canvasReady = new EventEmitter<ElementRef<HTMLDivElement>>();

  ngAfterViewInit(): void {
    if (this.canvasContainer) {
      this.canvasReady.emit(this.canvasContainer);
    }
  }
}

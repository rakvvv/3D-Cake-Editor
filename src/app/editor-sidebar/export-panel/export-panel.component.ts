import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-export-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './export-panel.component.html',
  styleUrls: ['./export-panel.component.css']
})
export class ExportPanelComponent {
  @Output() saveScene = new EventEmitter<void>();
  @Output() exportObj = new EventEmitter<void>();
  @Output() exportStl = new EventEmitter<void>();
  @Output() exportGltf = new EventEmitter<void>();
  @Output() screenshot = new EventEmitter<void>();

  onSaveScene(): void {
    this.saveScene.emit();
  }

  onExportObj(): void {
    this.exportObj.emit();
  }

  onExportStl(): void {
    this.exportStl.emit();
  }

  onExportGltf(): void {
    this.exportGltf.emit();
  }

  onScreenshot(): void {
    this.screenshot.emit();
  }
}

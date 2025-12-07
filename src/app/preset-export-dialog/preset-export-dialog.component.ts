import { CommonModule } from '@angular/common';
import {Component, inject} from '@angular/core';
import { PresetDialogService } from '../services/preset-dialog.service';

@Component({
  selector: 'app-preset-export-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preset-export-dialog.component.html',
  styleUrls: ['./preset-export-dialog.component.css'],
})
export class PresetExportDialogComponent {
  private readonly dialogService = inject(PresetDialogService);
  dialog$ = this.dialogService.dialog$;

  copy(content: string): void {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(content).catch(() => this.fallbackCopy(content));
      return;
    }
    this.fallbackCopy(content);
  }

  close(): void {
    this.dialogService.close();
  }

  private fallbackCopy(content: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

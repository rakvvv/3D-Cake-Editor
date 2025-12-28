import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface PresetDialogState {
  title: string;
  content: string;
}

@Injectable({
  providedIn: 'root',
})
export class PresetDialogService {
  private readonly dialogState = new BehaviorSubject<PresetDialogState | null>(null);
  public readonly dialog$ = this.dialogState.asObservable();

  open(title: string, payload: unknown): void {
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    this.dialogState.next({ title, content });
  }

  close(): void {
    this.dialogState.next(null);
  }
}

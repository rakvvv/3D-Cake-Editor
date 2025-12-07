import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { DecoratedCakePreset } from '../models/cake-preset';

@Injectable({ providedIn: 'root' })
export class CakePresetsService {
  private readonly presetsSubject = new BehaviorSubject<DecoratedCakePreset[]>([]);
  public readonly presets$ = this.presetsSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  public async loadPresets(url = '/assets/cake-presets.json'): Promise<void> {
    try {
      const presets = await firstValueFrom(this.http.get<DecoratedCakePreset[]>(url));
      this.presetsSubject.next(presets ?? []);
    } catch (error) {
      console.warn('Nie udało się wczytać gotowych tortów:', error);
      this.presetsSubject.next([]);
    }
  }

  public getPreset(id: string): DecoratedCakePreset | null {
    return this.presetsSubject.value.find((preset) => preset.id === id) ?? null;
  }
}

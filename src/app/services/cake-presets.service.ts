import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { DecoratedCakePreset } from '../models/cake-preset';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CakePresetsService {
  private readonly presetsSubject = new BehaviorSubject<DecoratedCakePreset[]>([]);
  public readonly presets$ = this.presetsSubject.asObservable();
  private readonly presetsUrl = `${environment.apiBaseUrl}/presets/cakes`;

  constructor(private readonly http: HttpClient) {}

  public async loadPresets(url = this.presetsUrl): Promise<void> {
    try {
      const presets = await firstValueFrom(
        this.http.get<(DecoratedCakePreset | { dataJson: string; thumbnailUrl?: string; description?: string; name?: string; id?: string })[]>(url),
      );
      const normalized = (presets ?? []).map((entry) => {
        if ('dataJson' in entry) {
          const parsed = JSON.parse((entry as any).dataJson) as DecoratedCakePreset;
          return {
            ...parsed,
            id: (entry as any).id ?? parsed.id,
            name: (entry as any).name ?? parsed.name,
            description: (entry as any).description ?? parsed.description,
            thumbnailUrl: (entry as any).thumbnailUrl ?? parsed.thumbnailUrl,
          } as DecoratedCakePreset;
        }
        return entry as DecoratedCakePreset;
      });
      this.presetsSubject.next(normalized ?? []);
    } catch (error) {
      console.warn('Nie udało się wczytać gotowych tortów:', error);
      this.presetsSubject.next([]);
    }
  }

  public getPreset(id: string): DecoratedCakePreset | null {
    return this.presetsSubject.value.find((preset) => preset.id === id) ?? null;
  }
}

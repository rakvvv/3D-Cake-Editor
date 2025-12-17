import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DecoratedPresetPayload {
  presetId: string;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  cakeShape?: string;
  cakeSize?: string;
  tiers?: number;
  dataJson: string;
}

export interface AnchorPresetPayload {
  presetId: string;
  name: string;
  cakeShape?: string;
  cakeSize?: string;
  tiers?: number;
  dataJson: string;
}

@Injectable({ providedIn: 'root' })
export class AdminPresetService {
  private readonly baseUrl = `${environment.apiBaseUrl}/admin/presets`;

  constructor(private readonly http: HttpClient) {}

  saveCakePreset(payload: DecoratedPresetPayload): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.baseUrl}/cakes`, payload));
  }

  saveAnchorPreset(payload: AnchorPresetPayload): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.baseUrl}/anchors`, payload));
  }
}

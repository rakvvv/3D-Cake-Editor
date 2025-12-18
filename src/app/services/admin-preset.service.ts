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

  updateAnchorPreset(payload: AnchorPresetPayload): Promise<void> {
    const url = `${this.baseUrl}/anchors/${encodeURIComponent(payload.presetId)}`;
    return firstValueFrom(this.http.put<void>(url, payload));
  }

  deleteAnchorPreset(presetId: string): Promise<void> {
    const url = `${this.baseUrl}/anchors/${encodeURIComponent(presetId)}`;
    return firstValueFrom(this.http.delete<void>(url));
  }

  uploadCakePresetThumbnail(presetId: string, file: Blob): Promise<string | null> {
    const formData = new FormData();
    formData.append('file', file, 'thumbnail.png');
    return firstValueFrom(
      this.http.post<{ thumbnailUrl: string }>(`${this.baseUrl}/cakes/${encodeURIComponent(presetId)}/thumbnail`, formData),
    ).then((response) => response?.thumbnailUrl ?? null);
  }
}

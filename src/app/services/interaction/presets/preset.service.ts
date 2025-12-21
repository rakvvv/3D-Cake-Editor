import {Injectable} from '@angular/core';

interface VersionedPreset<T> {
  version: number;
  data: T;
}

@Injectable({providedIn: 'root'})
export class PresetService {
  private readonly currentVersion = 1;

  public exportPreset<T>(preset: T): VersionedPreset<T> {
    return {version: this.currentVersion, data: preset};
  }

  public importPreset<T>(payload: VersionedPreset<T>): T {
    if (!payload || payload.version !== this.currentVersion) {
      // In the future, migrations can be added here. For now just passthrough.
      return payload?.data ?? ({} as T);
    }
    return payload.data;
  }

  public normalizeAngles(values: number[]): number[] {
    return values.map((angle) => (Number.isFinite(angle) ? angle % 360 : 0));
  }
}

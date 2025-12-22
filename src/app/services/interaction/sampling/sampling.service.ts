import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {HistoryDomain, SamplingConfig, SamplingDecision} from '../types/interaction-types';

@Injectable({providedIn: 'root'})
export class SamplingService {
  private readonly defaultConfigs: Record<HistoryDomain, SamplingConfig> = {
    [HistoryDomain.Surface]: {minDistance: 0.015},
    [HistoryDomain.Decorations]: {minDistance: 0.02, minTimeMs: 40},
  };

  public getConfig(domain: HistoryDomain): SamplingConfig {
    return this.defaultConfigs[domain];
  }

  public shouldRecordPoint(
    lastPoint: THREE.Vector3 | null,
    newPoint: THREE.Vector3,
    config: SamplingConfig,
    lastTimestamp?: number,
    now: number = performance.now(),
  ): SamplingDecision {
    const minDistanceSq =
      config.minDistanceSq ?? (config.minDistance !== undefined ? config.minDistance * config.minDistance : undefined);
    if (lastPoint && minDistanceSq !== undefined) {
      const distanceSq = lastPoint.distanceToSquared(newPoint);
      if (distanceSq < minDistanceSq) {
        return {accepted: false, reason: 'distance-threshold'};
      }
    }

    if (lastTimestamp !== undefined && config.minTimeMs !== undefined) {
      const delta = now - lastTimestamp;
      if (delta < config.minTimeMs) {
        return {accepted: false, reason: 'time-threshold'};
      }
    }

    return {accepted: true};
  }
}

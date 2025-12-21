import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {SamplingConfig, SamplingDecision} from '../types/interaction-types';

@Injectable({providedIn: 'root'})
export class SamplingService {
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

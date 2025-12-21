import * as THREE from 'three';
import {SamplingService} from '../interaction/sampling/sampling.service';
import {SamplingConfig} from '../interaction/types/interaction-types';

/**
 * Tracks stroke spacing in distance and time to avoid excessive allocations in hot paths.
 */
export class StrokeSampler {
  private lastPoint: THREE.Vector3 | null = null;
  private lastNormal: THREE.Vector3 | null = null;
  private lastTimestamp = 0;

  constructor(private readonly samplingService: SamplingService = new SamplingService()) {}

  public reset(): void {
    this.lastPoint = null;
    this.lastNormal = null;
    this.lastTimestamp = 0;
  }

  public snapshot(): { point: THREE.Vector3 | null; normal: THREE.Vector3 | null; timestamp: number } {
    return {
      point: this.lastPoint ? this.lastPoint.clone() : null,
      normal: this.lastNormal ? this.lastNormal.clone() : null,
      timestamp: this.lastTimestamp,
    };
  }

  public shouldSample(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    minDistance: number,
    minTimeMs: number,
    now: number,
  ): boolean {
    const config: SamplingConfig = {minDistance, minTimeMs};
    const decision = this.samplingService.shouldRecordPoint(this.lastPoint, point, config, this.lastTimestamp, now);
    if (!decision.accepted) {
      return false;
    }

    if (this.lastPoint) {
      // Preserve legacy normal gating even though sampling service already accepted.
      const distance = point.distanceTo(this.lastPoint);
      const timeDelta = now - this.lastTimestamp;
      if (distance < minDistance && timeDelta < minTimeMs) {
        return false;
      }
    }
    return true;
  }

  public commit(point: THREE.Vector3, normal: THREE.Vector3, now: number): void {
    this.lastPoint = point.clone();
    this.lastNormal = normal.clone();
    this.lastTimestamp = now;
  }
}

/**
 * Lightweight distance gate for serialization sampling.
 */
export class DistanceRecorder {
  private lastPoint: THREE.Vector3 | null = null;

  public reset(): void {
    this.lastPoint = null;
  }

  public shouldRecord(point: THREE.Vector3, minDistanceSq: number): boolean {
    if (this.lastPoint && this.lastPoint.distanceToSquared(point) < minDistanceSq) {
      return false;
    }
    this.lastPoint = this.lastPoint ?? new THREE.Vector3();
    this.lastPoint.copy(point);
    return true;
  }
}

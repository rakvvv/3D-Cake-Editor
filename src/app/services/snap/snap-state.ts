import * as THREE from 'three';
import { CakeMetadata } from '../../factories/three-objects.factory';

/**
 * Centralizes mutable snap context shared across projection/orientation helpers.
 */
export class SnapState {
  private cakeBase: THREE.Object3D | null = null;
  private readonly identityRotation: [number, number, number, number] = [0, 0, 0, 1];

  public setCakeBase(cake: THREE.Object3D | null): void {
    this.cakeBase = cake;
  }

  public getCakeBase(): THREE.Object3D | null {
    return this.cakeBase;
  }

  public getCakeMetadata(): CakeMetadata | undefined {
    return this.cakeBase?.userData['metadata'] as CakeMetadata | undefined;
  }

  public getIdentityRotation(): [number, number, number, number] {
    return [...this.identityRotation];
  }
}

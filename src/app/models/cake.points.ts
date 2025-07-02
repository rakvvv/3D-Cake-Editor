import * as THREE from 'three';

export interface ClosestPointInfo {
  point: THREE.Vector3;       // Najbliższy punkt na powierzchni tortu (w lokalnych koordynatach tortu)
  normal: THREE.Vector3;      // Normalna do powierzchni w tym punkcie (w lokalnych koordynatach tortu)
  distance: number;           // Odległość od oryginalnego punktu do najbliższego punktu na torcie
  surfaceType: 'TOP' | 'SIDE' | 'NONE'; // Typ powierzchni, na której znaleziono najbliższy punkt
}

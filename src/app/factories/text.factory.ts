import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

export interface TextMeshOptions {
  size: number;
  depth: number;
  curveSegments?: number;
  material?: THREE.MeshPhongMaterialParameters | THREE.Material;
  center?: boolean;
  align?: 'center' | 'left';
  verticalAlign?: 'center' | 'baseline';
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelSegments?: number;
}

export class TextFactory {
  public static createTextMesh(font: Font, text: string, options: TextMeshOptions): THREE.Mesh {
    const geometry = new TextGeometry(text, {
      font,
      size: options.size,
      depth: options.depth,
      curveSegments: options.curveSegments ?? 12,
      bevelEnabled: options.bevelEnabled ?? false,
      bevelThickness: options.bevelThickness ?? Math.max(options.depth * 0.2, 0.01),
      bevelSize: options.bevelSize ?? Math.max(options.size * 0.02, 0.01),
      bevelSegments: options.bevelSegments ?? 3,
    });

    if (options.align === 'left') {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        const { min, max } = geometry.boundingBox;
        const offsetY = options.verticalAlign === 'baseline'
          ? 0
          : -((min.y + max.y) / 2);
        const offsetZ = -((min.z + max.z) / 2);
        geometry.translate(-min.x, offsetY, offsetZ);
      }
    } else if (options.center ?? true) {
      geometry.center();
    } else {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        const { min, max } = geometry.boundingBox;
        const offsetX = -((min.x + max.x) / 2);
        const offsetY = options.verticalAlign === 'baseline'
          ? 0
          : -((min.y + max.y) / 2);
        const offsetZ = -((min.z + max.z) / 2);
        geometry.translate(offsetX, offsetY, offsetZ);
      }
    }

    let material: THREE.Material;
    if (options.material instanceof THREE.Material) {
      material = options.material;
    } else {
      const materialParams = options.material ?? { color: 0xff0000 };
      material = new THREE.MeshPhongMaterial(materialParams);
    }

    return new THREE.Mesh(geometry, material);
  }
}

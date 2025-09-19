import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

export interface TextMeshOptions {
  size: number;
  depth: number;
  curveSegments?: number;
  material?: THREE.MeshPhongMaterialParameters;
}

export class TextFactory {
  public static createTextMesh(font: Font, text: string, options: TextMeshOptions): THREE.Mesh {
    const geometry = new TextGeometry(text, {
      font,
      size: options.size,
      depth: options.depth,
      curveSegments: options.curveSegments ?? 12,
    });
    geometry.center();

    const materialParams = options.material ?? { color: 0xff0000 };
    const material = new THREE.MeshPhongMaterial(materialParams);

    return new THREE.Mesh(geometry, material);
  }
}

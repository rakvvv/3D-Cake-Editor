import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

@Injectable({ providedIn: 'root' })
export class ExportService {
  exportOBJ(scene: THREE.Scene): string {
    const exporter = new OBJExporter();
    const cleanScene = this.prepareScene(scene);
    return exporter.parse(cleanScene);
  }

  exportSTL(scene: THREE.Scene): string {
    const exporter = new STLExporter();
    const cleanScene = this.prepareScene(scene);
    return exporter.parse(cleanScene);
  }

  exportGLTF(scene: THREE.Scene, callback: (gltf: object) => void): void {
    const exporter = new GLTFExporter();
    const cleanScene = this.prepareScene(scene);
    exporter.parse(cleanScene, callback, () => {});
  }

  screenshot(renderer: THREE.WebGLRenderer): string {
    return renderer.domElement.toDataURL('image/png');
  }

  private prepareScene(scene: THREE.Scene): THREE.Scene {
    const clone = scene.clone(true);
    const toRemove: THREE.Object3D[] = [];

    clone.updateMatrixWorld(true);

    clone.traverse((child) => {
      if (
        child instanceof THREE.GridHelper ||
        child instanceof THREE.AxesHelper ||
        child instanceof THREE.BoxHelper ||
        child.type === 'TransformControls' ||
        child instanceof THREE.Camera
      ) {
        toRemove.push(child);
      }

      child.updateMatrixWorld(true);
    });

    toRemove.forEach((object) => object.parent?.remove(object));

    return clone;
  }
}

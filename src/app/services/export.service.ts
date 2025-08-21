import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

@Injectable({ providedIn: 'root' })
export class ExportService {
  exportOBJ(scene: THREE.Scene): string {
    const exporter = new OBJExporter();
    return exporter.parse(scene);
  }

  exportSTL(scene: THREE.Scene): string {
    const exporter = new STLExporter();
    return exporter.parse(scene);
  }

  exportGLTF(scene: THREE.Scene, callback: (gltf: object) => void): void {
    const exporter = new GLTFExporter();
    exporter.parse(scene, callback, () => {});
  }

  screenshot(renderer: THREE.WebGLRenderer): string {
    return renderer.domElement.toDataURL('image/png');
  }
}

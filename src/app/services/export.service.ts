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

  exportGLTF(scene: THREE.Scene, callback: (gltf: ArrayBuffer | object) => void): void {
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      (result) => callback(result),
      (error) => console.error('Błąd eksportu GLTF:', error),
      {
        binary: true,
        embedImages: true,
        onlyVisible: false,
        includeCustomExtensions: false,
      },
    );
  }

  /**
   * Eksportuje scenę do OBJ z poprawnym "bake" transformacji
   */
  downloadOBJ(scene: THREE.Scene, filename = 'model.obj'): void {
    console.log('=== OBJ EXPORT ===');

    // Stwórz czystą scenę tylko z meshami (bez świateł, helperów)
    const cleanScene = this.flattenSceneForExport(scene, false);

    let meshCount = 0;
    cleanScene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        meshCount++;
      }
    });
    console.log(`Exporting ${meshCount} meshes to OBJ`);

    const content = this.exportOBJ(cleanScene);
    console.log(`OBJ content length: ${content.length} characters`);
    this.downloadTextFile(content, filename, 'model/obj');
  }

  /**
   * Eksportuje scenę do STL z poprawną orientacją (Z-up)
   */
  downloadSTL(scene: THREE.Scene, filename = 'model.stl'): void {
    console.log('=== STL EXPORT ===');

    // Stwórz czystą scenę z "baked" transformacjami i rotacją dla STL
    const cleanScene = this.flattenSceneForExport(scene, true);

    let meshCount = 0;
    cleanScene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        meshCount++;
      }
    });
    console.log(`Exporting ${meshCount} meshes to STL`);

    const content = this.exportSTL(cleanScene);
    console.log(`STL content length: ${content.length} characters`);
    this.downloadTextFile(content, filename, 'model/stl');
  }

  /**
   * Spłaszcza scenę - aplikuje wszystkie transformacje bezpośrednio do geometrii
   * To eliminuje problemy z hierarchią i gwarantuje poprawny eksport
   */
  private flattenSceneForExport(scene: THREE.Scene, rotateForSTL: boolean): THREE.Scene {
    const exportScene = new THREE.Scene();

    // Macierz rotacji dla STL (konwersja Y-up → Z-up)
    // Rotacja +90° wokół X sprawia że Y staje się Z
    const stlRotation = new THREE.Matrix4();
    if (rotateForSTL) {
      stlRotation.makeRotationX(Math.PI / 2);  // +90 stopni
    }

    // Aktualizuj wszystkie macierze świata
    scene.updateMatrixWorld(true);

    // Zbierz wszystkie meshe ze sceny
    const meshesToExport: { mesh: THREE.Mesh; worldMatrix: THREE.Matrix4 }[] = [];

    scene.traverse((node) => {
      // Pomiń światła i helpery
      if ((node as THREE.Light).isLight) return;
      if (node instanceof THREE.GridHelper) return;
      if (node instanceof THREE.AxesHelper) return;
      if (node instanceof THREE.BoxHelper) return;

      // Pomiń InstancedMesh (powinny być już skonwertowane)
      if ((node as THREE.InstancedMesh).isInstancedMesh) {
        console.warn('Found unconverted InstancedMesh in export scene:', node.name);
        return;
      }

      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        meshesToExport.push({
          mesh,
          worldMatrix: mesh.matrixWorld.clone()
        });
      }
    });

    console.log(`Flattening ${meshesToExport.length} meshes for export`);

    // Stwórz nowe meshe z "baked" transformacjami
    meshesToExport.forEach(({ mesh, worldMatrix }, index) => {
      // Klonuj geometrię
      const geometry = mesh.geometry.clone();

      // Aplikuj transformację świata do geometrii
      geometry.applyMatrix4(worldMatrix);

      // Dla STL - aplikuj rotację
      if (rotateForSTL) {
        geometry.applyMatrix4(stlRotation);
      }

      // Klonuj materiał
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(m => m.clone())
        : mesh.material.clone();

      // Stwórz nowy mesh z zerową transformacją (wszystko jest w geometrii)
      const exportMesh = new THREE.Mesh(geometry, material);
      exportMesh.name = mesh.name || `mesh_${index}`;

      exportScene.add(exportMesh);
    });

    return exportScene;
  }

  downloadGLB(scene: THREE.Scene, filename = 'model.glb'): void {
    console.log('=== GLB EXPORT ===');
    let meshCount = 0;
    scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        meshCount++;
      }
    });
    console.log(`Total meshes for GLB export: ${meshCount}`);

    this.exportGLTF(scene, (result) => {
      if (result instanceof ArrayBuffer) {
        console.log(`✅ GLB exported: ${(result.byteLength / 1024).toFixed(1)} KB`);
        const blob = new Blob([result], { type: 'model/gltf-binary' });
        this.downloadBlob(blob, filename);
      } else {
        const json = JSON.stringify(result, null, 2);
        this.downloadTextFile(json, filename.replace('.glb', '.gltf'), 'model/gltf+json');
      }
    });
  }

  private downloadTextFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    this.downloadBlob(blob, filename);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  downloadScreenshot(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    filename = 'screenshot.png',
    options?: {
      width?: number;
      height?: number;
      backgroundColor?: THREE.Color;
      hideHelpers?: boolean;
    }
  ): void {
    console.log('=== SCREENSHOT ===');

    const currentSize = renderer.getSize(new THREE.Vector2());
    const width = options?.width ?? currentSize.x;
    const height = options?.height ?? currentSize.y;

    // Zapisz poprzedni stan
    const previousSize = currentSize.clone();
    const previousPixelRatio = renderer.getPixelRatio();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    const previousBackground = scene.background;

    // Ukryj helpery
    const hiddenObjects: THREE.Object3D[] = [];
    if (options?.hideHelpers) {
      scene.traverse((child) => {
        if ((child instanceof THREE.GridHelper ||
          child instanceof THREE.AxesHelper ||
          child instanceof THREE.BoxHelper) && child.visible) {
          child.visible = false;
          hiddenObjects.push(child);
        }
      });
    }

    try {
      if (options?.backgroundColor) {
        scene.background = options.backgroundColor;
        renderer.setClearColor(options.backgroundColor, 1);
      }

      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);

      const canvas = renderer.domElement;
      const dataURL = canvas.toDataURL('image/png');

      if (!dataURL || dataURL === 'data:,') {
        console.error('Screenshot failed: empty data URL. Make sure renderer has preserveDrawingBuffer: true');
        return;
      }

      // Konwertuj base64 do Blob
      const byteString = atob(dataURL.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/png' });

      this.downloadBlob(blob, filename);
      console.log(`✅ Screenshot saved: ${filename} (${(blob.size / 1024).toFixed(1)} KB)`);

    } finally {
      renderer.setPixelRatio(previousPixelRatio);
      renderer.setSize(previousSize.x, previousSize.y, false);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      scene.background = previousBackground;
      hiddenObjects.forEach((obj) => obj.visible = true);
      renderer.render(scene, camera);
    }
  }
}

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { DecorationFactory } from '../factories/decoration.factory';

@Injectable({ providedIn: 'root' })
export class PaintService {
  public paintMode = false;
  public currentBrush = 'trawa.glb';
  public isPainting = false;

  public async handlePaint(
    event: MouseEvent,
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    cakeBase: THREE.Mesh,
    mouse: THREE.Vector2,
    raycaster: THREE.Raycaster
  ): Promise<void> {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(cakeBase, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const pointOnCakeWorld = hit.point.clone();
      const normal = hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
      try {
        const brushModel = await DecorationFactory.loadDecorationModel(`/models/${this.currentBrush}`);

        const box = new THREE.Box3().setFromObject(brushModel);
        const center = new THREE.Vector3();
        box.getCenter(center);
        brushModel.position.sub(center);

        brushModel.position.copy(pointOnCakeWorld);
        const offset = normal.clone().multiplyScalar(0.005);
        brushModel.position.add(offset);

        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone());
        brushModel.quaternion.copy(quaternion);
        brushModel.rotation.y = Math.random() * Math.PI * 2;

        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const scaleFactor = 0.5 / maxDim;
          brushModel.scale.setScalar(scaleFactor);
        }

        scene.add(brushModel);
        brushModel.userData['isSnapped'] = true;
      } catch (e) {
        console.error('Paint: błąd ładowania modelu pędzla:', e);
      }
    }
  }
}

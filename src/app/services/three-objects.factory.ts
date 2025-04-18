import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ThreeObjectsFactory {
    public static loadDecorationModel(url: string): Promise<THREE.Object3D> {
        return new Promise((resolve, reject) => {
          const loader = new GLTFLoader();
          loader.load(
            url,
            (gltf) => resolve(gltf.scene),
            undefined,
            (err) => reject(err)
          );
        });
      }

    public static createCakeBase(): THREE.Mesh {
        const geometry = new THREE.CylinderGeometry(2, 2, 2, 100);
        const material = new THREE.MeshPhongMaterial({ color: 0xffc0cb });
        const cakeBase = new THREE.Mesh(geometry, material);
        cakeBase.position.set(0,1,0)
        return cakeBase;
    }
      
}

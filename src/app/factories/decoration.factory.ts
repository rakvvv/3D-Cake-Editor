import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class DecorationFactory {
  public static loadDecorationModel(url: string): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        url,
        gltf => {
          const meshes = this.getAllMeshes(gltf.scene);
          this.prepareMeshesForClick(meshes);
          gltf.scene.userData['clickableMeshes'] = meshes;
          resolve(gltf.scene);
        },
        undefined,
        err => reject(err)
      );
    });
  }

  private static getAllMeshes(object: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    object.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        meshes.push(child as THREE.Mesh);
      }
    });
    return meshes;
  }

  private static prepareMeshesForClick(meshes: THREE.Mesh[]) {
    meshes.forEach(mesh => {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => (mat.side = THREE.DoubleSide));
      } else {
        mesh.material.side = THREE.DoubleSide;
      }

      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }
}

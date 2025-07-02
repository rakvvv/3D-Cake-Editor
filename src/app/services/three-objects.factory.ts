import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ThreeObjectsFactory {
    public static loadDecorationModel(url: string): Promise<THREE.Object3D> {
      return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            const meshes = this.getAllMeshes(gltf.scene);
            this.prepareMeshesForClick(meshes);
            gltf.scene.userData['clickableMeshes'] = meshes; // ZAPAMIĘTUJEMY SIATKI
            resolve(gltf.scene);
          },
          undefined,
          (err) => reject(err)
        );
      });
    }

  public static createCakeBase(): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(2, 2, 2, 100);

    // 1. Stwórz TextureLoader
    const loader = new THREE.TextureLoader();

    // 2. Załaduj mapy
    const colorMap = loader.load('/assets/textures/cake_color.jpg');
    const bumpMap = loader.load('/assets/textures/cake_bump.jpg');
    const roughnessMap = loader.load('/assets/textures/cake_roughness.jpg');

    // 3. Ustaw skalowanie tekstur, żeby ładnie się powtarzały
    [colorMap, bumpMap, roughnessMap].forEach(tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2); // 2x2 powtórzenia, możesz eksperymentować
    });

    // 4. Stwórz materiał z tymi mapami
    const material = new THREE.MeshStandardMaterial({
      map: colorMap,
      bumpMap: bumpMap,
      bumpScale: 0.1,        // intensywność wypukłości
      roughnessMap: roughnessMap,
      roughness: 0.7,        // domyślna szorstkość
      metalness: 0.0,        // tort raczej nie metaliczny
    });

    const cakeBase = new THREE.Mesh(geometry, material);
    cakeBase.position.set(0, 1, 0);
    return cakeBase;
  }

    private static getAllMeshes(object: THREE.Object3D): THREE.Mesh[] {
      const meshes: THREE.Mesh[] = [];
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshes.push(child as THREE.Mesh);
        }
      });
      return meshes;
    }

    private static prepareMeshesForClick(meshes: THREE.Mesh[]) {
      meshes.forEach((mesh) => {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.side = THREE.DoubleSide);
        } else {
          mesh.material.side = THREE.DoubleSide;
        }

        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        mesh.frustumCulled = false;
        mesh.castShadow = true; // opcjonalnie
        mesh.receiveShadow = true; // opcjonalnie
      });
    }

  public static createCakeTopping(): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(1.95, 1.95, 0.05, 100);
    const loader = new THREE.TextureLoader();
    const syrupMap = loader.load('/assets/textures/Candy001_1K-JPG_Color.jpg');
    const normalMap = loader.load('/assets/textures/Candy001_1K-JPG_NormalGL.jpg');
    [syrupMap, normalMap].forEach(tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
    });
    const material = new THREE.MeshStandardMaterial({
      map: syrupMap,
      normalMap: normalMap,
      metalness: 0.2,
      roughness: 0.4,
      transparent: true,
      opacity: 0.95,
    });
    const topping = new THREE.Mesh(geometry, material);
    topping.position.set(0, 0.05, 0); // tort ma wysokość 2 pozycjonowany od y=0? Sprawdź u siebie.
    return topping;
  }

}

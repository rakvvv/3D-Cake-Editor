import * as THREE from 'three';

export class CakeFactory {
  public static createCakeBase(): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(2, 2, 2, 100);

    const loader = new THREE.TextureLoader();
    const colorMap = loader.load('/assets/textures/cake_color.jpg');
    const bumpMap = loader.load('/assets/textures/cake_bump.jpg');
    const roughnessMap = loader.load('/assets/textures/cake_roughness.jpg');

    [colorMap, bumpMap, roughnessMap].forEach(tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
    });

    const material = new THREE.MeshStandardMaterial({
      map: colorMap,
      bumpMap: bumpMap,
      bumpScale: 0.1,
      roughnessMap: roughnessMap,
      roughness: 0.7,
      metalness: 0.0,
    });

    const cakeBase = new THREE.Mesh(geometry, material);
    cakeBase.position.set(0, 1, 0);
    return cakeBase;
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
    topping.position.set(0, 0.05, 0);
    return topping;
  }
}

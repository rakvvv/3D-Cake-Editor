import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { Subject } from 'rxjs';

export class DecorationFactory {
  private static readonly errorSubject = new Subject<unknown>();
  public static readonly errors$ = this.errorSubject.asObservable();
  private static renderer: THREE.WebGLRenderer | null = null;
  private static gltfLoaderPromise: Promise<GLTFLoader> | null = null;

  public static initialize(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    this.gltfLoaderPromise = null;
  }

  public static async loadDecorationModel(
    url: string,
    renderer?: THREE.WebGLRenderer,
  ): Promise<THREE.Object3D> {
    const loader = await this.getLoader(renderer);
    const resolvedUrl = this.resolveAssetUrl(url);

    return new Promise((resolve, reject) => {
      loader.load(
        resolvedUrl,
        gltf => {
          const meshes = this.getAllMeshes(gltf.scene);
          this.prepareMeshesForClick(meshes);
          gltf.scene.userData['clickableMeshes'] = meshes;
          resolve(gltf.scene);
        },
        undefined,
        err => {
          this.emitError(err);
          reject(err);
        }
      );
    });
  }

  private static async getLoader(renderer?: THREE.WebGLRenderer): Promise<GLTFLoader> {
    if (!this.gltfLoaderPromise) {
      this.gltfLoaderPromise = this.buildLoader(renderer ?? this.renderer);
    }

    return this.gltfLoaderPromise;
  }

  private static async buildLoader(renderer: THREE.WebGLRenderer | null): Promise<GLTFLoader> {
    const loader = new GLTFLoader();

    const meshoptDecoder = await this.tryLoadMeshoptDecoder();
    if (meshoptDecoder) {
      loader.setMeshoptDecoder(meshoptDecoder);
    }

    const ktx2Loader = this.createKTX2Loader(renderer);
    if (ktx2Loader) {
      loader.setKTX2Loader(ktx2Loader);
    }

    return loader;
  }

  private static async tryLoadMeshoptDecoder(): Promise<any | null> {
    try {
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      return MeshoptDecoder;
    } catch (error) {
      this.emitError(error);
      return null;
    }
  }

  private static createKTX2Loader(renderer: THREE.WebGLRenderer | null): KTX2Loader | null {
    if (!renderer) {
      return null;
    }

    try {
      const ktx2Loader = new KTX2Loader();
      ktx2Loader.setTranscoderPath(this.resolveAssetUrl('/assets/ktx2/'));
      ktx2Loader.detectSupport(renderer);
      return ktx2Loader;
    } catch (error) {
      this.emitError(error);
      return null;
    }
  }

  private static resolveAssetUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

    if (typeof document !== 'undefined' && document.baseURI) {
      return new URL(normalizedPath, document.baseURI).toString();
    }

    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/${normalizedPath}`;
    }

    return `http://localhost:4200/${normalizedPath}`;
  }

  private static emitError(error: unknown): void {
    this.errorSubject.next(error);
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

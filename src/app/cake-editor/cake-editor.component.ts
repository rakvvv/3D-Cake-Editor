import { Component, AfterViewInit, ElementRef, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FontLoader, Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

@Component({
  selector: 'app-cake-editor',
  templateUrl: './cake-editor.component.html',
  styleUrls: ['./cake-editor.component.css']
})
export class CakeEditorComponent implements AfterViewInit {

  @ViewChild('canvasContainer', { static: false }) container!: ElementRef;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  async ngAfterViewInit(): Promise<void> {
    if (isPlatformBrowser(this.platformId)) {

      const dat = await import('dat.gui');
      this.init3DScene(dat);
      
    }
  }

  private textMesh: THREE.Mesh | null = null; // napis dla tortu
  private font: Font | null = null; // przechowujemy zaladowana czcionke

  private init3DScene(dat: any): void {
   
    const scene = new THREE.Scene();  // scena

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.setSize(
      this.container.nativeElement.clientWidth, 
      this.container.nativeElement.clientHeight
    );

    const camera = new THREE.PerspectiveCamera(
      45, 
      this.container.nativeElement.clientWidth / this.container.nativeElement.clientHeight, 
      0.1, 
      1000
    );
    this.container.nativeElement.appendChild(renderer.domElement);

    // Kontrola kamery
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enablePan = false; // wyłaczenie możliwości proszuania kamera
    orbit.minDistance = 10;
    orbit.maxDistance = 20;

    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);
    camera.position.set(-10, 30, 30);


    // Światło
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0, 1, 1);
    scene.add(light);

    const gridHelper = new THREE.GridHelper(30);
    scene.add(gridHelper);

    

    // cylinder 
    const geometry = new THREE.CylinderGeometry(2, 2, 2, 100);
    const material = new THREE.MeshPhongMaterial({ color: 0xffc0cb });
    const cakeLayer = new THREE.Mesh(geometry, material);
    cakeLayer.position.set(0,1,0)
    scene.add(cakeLayer);

    const loader = new FontLoader();
    

    // Opcje
    const gui = new dat.GUI();
 
    const options = {
      cake_size: 1,
      cake_color:'#ffea00',
      cake_text: false,           
      cake_text_value: 'Urodziny'  
    };

    gui.add(options, 'cake_size', 1, 2).onChange((e: number) => {
      cakeLayer.scale.set(e, e, e);
      cakeLayer.position.set(0, e*1, 0);
      // Jeżeli napis jest włączony (options.cake_text == true),
      // musimy go odświeżyć, żeby 'depth' także się zaktualizowało
      if (options.cake_text) {
        if (this.textMesh) {
          scene.remove(this.textMesh);
          this.textMesh.geometry.dispose();
          (this.textMesh.material as THREE.Material).dispose();
          this.textMesh = null;
        }
        const size = cakeLayer.geometry.parameters.radiusTop * 0.2 * options.cake_size;
        const height = cakeLayer.geometry.parameters.height / 2 + 0.5;
        /*
          depth=1.1+4×(size−1)
          gdy size = 1: depth = 1.1 + 4×(1−1) = 1.1
          gdy size = 2: depth = 1.1 + 4×(2−1) = 1.1 + 4 = 5.1
        */
        const depth = 1.1 + 4 * (options.cake_size - 1);

        this.loadAndAddText(scene, cakeLayer, options.cake_text_value, size, height, depth);
      }
    });

    gui.addColor(options, 'cake_color').onChange((e: number) => {
      cakeLayer.material.color.set(e);
    });

    gui.add(options, 'cake_text').onChange((value: boolean) => {
      if (value) {
        // ladowanie napisu na podstawie wartosci boolean
        const size = cakeLayer.geometry.parameters.radiusTop * 0.2 * options.cake_size;
        const height = cakeLayer.geometry.parameters.height / 2 + 0.5;
        const depth =  1.1 + 4 * (options.cake_size - 1);
        this.loadAndAddText(scene, cakeLayer, options.cake_text_value, size, height, depth);
      } else {
        // Jeśli chcemy usunąć napis 
        if (this.textMesh) {
          scene.remove(this.textMesh);
          this.textMesh.geometry.dispose();
          (this.textMesh.material as THREE.Material).dispose();
          this.textMesh = null;
        }
      }
    });

    gui.add(options, 'cake_text_value').onChange((newText: string) => {
      if (options.cake_text) {
        // usuwanie napisu
        if (this.textMesh) {
          scene.remove(this.textMesh);
          this.textMesh.geometry.dispose();
          (this.textMesh.material as THREE.Material).dispose();
          this.textMesh = null;
        }
        // dodawanie napisu
        const size = cakeLayer.geometry.parameters.radiusTop * 0.2 * options.cake_size;
        const height = cakeLayer.geometry.parameters.height / 2 + 0.5;
        const depth =  1.1 + 4 * (options.cake_size - 1);
        this.loadAndAddText(scene, cakeLayer, newText, size, height, depth);
      }
    });
  
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
      orbit.update()
    };
    animate();

    window.addEventListener('resize', () => {
      camera.aspect = this.container.nativeElement.clientWidth / this.container.nativeElement.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(
        this.container.nativeElement.clientWidth, 
        this.container.nativeElement.clientHeight
      );
    });
  }
  
  private async loadFont(): Promise<void> {
    if (this.font) return; // Font już załadowany

    const loader = new FontLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        '/fonts/helvetiker_regular.typeface.json',
        (font) => {
          this.font = font;
          console.log('Font zaladowany', font);
          resolve();
        },
        undefined,
        (err) => {
          console.error('Error ladowania font:', err);
          reject(err);
        }
      );
    });
  }

  
  private async loadAndAddText( scene: THREE.Scene, cakeLayer: THREE.Mesh, text: string, size: number, height: number, depth: number): Promise<void> {

    
    if (!this.font) {
      await this.loadFont(); // czekam az zaladuje sie font
    }

    if (!this.font) {
      console.error('Font nie zostal zaladowany');
      return;
    }

  const textGeometry = new TextGeometry(text, {  // geometria tortu
      font: this.font,
      size: size,
      depth: depth,        
      curveSegments: 12,
      
    });
    textGeometry.center();

    const textMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    const newTextMesh = new THREE.Mesh(textGeometry, textMaterial);

    newTextMesh.position.y = height;
    newTextMesh.rotation.x = -0.5 * Math.PI; 

    scene.add(newTextMesh);

    this.textMesh = newTextMesh;
  }
}

import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';

export interface PaintingShaderUniforms {
  gradientMap: { value: THREE.Texture };
  useGradient: { value: boolean };
  gradientMinY: { value: number };
  gradientHeight: { value: number };
  gradientFlip: { value: number };
}

export interface GradientTextureConfig {
  enabled: boolean;
  startColor: string;
  endColor: string;
  flip: boolean;
}

@Injectable({ providedIn: 'root' })
export class GradientTextureService {
  public gradientEnabled = false;
  public gradientFlip = false;
  public gradientStart = '#ffffff';
  public gradientEnd = '#ffe3f3';

  private readonly isBrowser: boolean;
  private gradientCanvas?: HTMLCanvasElement;
  private gradientContext?: CanvasRenderingContext2D | null;
  private gradientTexture?: THREE.CanvasTexture;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  public updateConfig(config: Partial<GradientTextureConfig>): void {
    if (!this.isBrowser) return;

    if (config.enabled !== undefined) {
      this.gradientEnabled = config.enabled;
    }
    if (config.flip !== undefined) {
      this.gradientFlip = config.flip;
    }
    if (config.startColor) {
      this.gradientStart = config.startColor;
    }
    if (config.endColor) {
      this.gradientEnd = config.endColor;
    }

    this.updateGradientTexture();
  }

  public refreshTexture(): void {
    this.updateGradientTexture();
  }

  public updateUniformsFromBounds(
    bbox: THREE.Box3,
    existing?: PaintingShaderUniforms,
  ): PaintingShaderUniforms | null {
    this.ensureResources();
    if (!this.gradientTexture) return null;

    const gradientHeight = Math.max(0.001, bbox.max.y - bbox.min.y);
    const gradientMinY = bbox.min.y;

    const uniforms: PaintingShaderUniforms =
      existing ?? {
        gradientMap: { value: this.gradientTexture },
        useGradient: { value: this.gradientEnabled },
        gradientMinY: { value: gradientMinY },
        gradientHeight: { value: gradientHeight },
        gradientFlip: { value: this.gradientFlip ? 1 : 0 },
      };

    uniforms.gradientMap.value = this.gradientTexture;
    uniforms.useGradient.value = this.gradientEnabled;
    uniforms.gradientMinY.value = gradientMinY;
    uniforms.gradientHeight.value = gradientHeight;
    uniforms.gradientFlip.value = this.gradientFlip ? 1 : 0;

    return uniforms;
  }

  public getDataUrl(): string | null {
    if (!this.isBrowser) return null;
    this.ensureResources();
    if (!this.gradientCanvas) return null;
    return this.gradientCanvas.toDataURL('image/png');
  }

  public get texture(): THREE.Texture | null {
    return this.gradientTexture ?? null;
  }

  private ensureResources(): void {
    if (!this.isBrowser || this.gradientCanvas) return;
    this.gradientCanvas = document.createElement('canvas');
    this.gradientCanvas.width = 1024;
    this.gradientCanvas.height = 1024;
    this.gradientContext = this.gradientCanvas.getContext('2d');
    this.gradientTexture = new THREE.CanvasTexture(this.gradientCanvas);
    this.gradientTexture.colorSpace = THREE.SRGBColorSpace;
  }

  private updateGradientTexture(): void {
    this.ensureResources();
    if (!this.gradientContext || !this.gradientCanvas || !this.gradientTexture) return;

    const ctx = this.gradientContext;
    const { width, height } = this.gradientCanvas;
    ctx.clearRect(0, 0, width, height);

    if (!this.gradientEnabled) {
      this.gradientTexture.needsUpdate = true;
      return;
    }

    const startY = this.gradientFlip ? height : 0;
    const endY = this.gradientFlip ? 0 : height;
    const gradient = ctx.createLinearGradient(width / 2, startY, width / 2, endY);
    gradient.addColorStop(0, this.gradientStart);
    gradient.addColorStop(1, this.gradientEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    this.gradientTexture.needsUpdate = true;
  }
}

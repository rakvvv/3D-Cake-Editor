import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {PointerSample} from '../types/interaction-types';

@Injectable({providedIn: 'root'})
export class PointerInputService {
  public normalizeEvent(
    event: PointerEvent | MouseEvent | TouchEvent,
    target: HTMLElement | DOMRect,
    now: number = performance.now(),
  ): PointerSample {
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : target;
    const clientX = 'clientX' in event ? event.clientX : 'touches' in event && event.touches.length ? event.touches[0].clientX : 0;
    const clientY = 'clientY' in event ? event.clientY : 'touches' in event && event.touches.length ? event.touches[0].clientY : 0;

    const xNdc = ((clientX - rect.left) / rect.width) * 2 - 1;
    const yNdc = -(((clientY - rect.top) / rect.height) * 2 - 1);

    const pointerEvent = event as PointerEvent;
    const modifiers = {
      alt: !!(event as KeyboardEvent).altKey,
      ctrl: !!(event as KeyboardEvent).ctrlKey,
      shift: !!(event as KeyboardEvent).shiftKey,
      meta: !!(event as KeyboardEvent).metaKey,
    };

    return {
      xNdc,
      yNdc,
      buttons: pointerEvent.buttons ?? ('buttons' in event ? (event as PointerEvent).buttons : 0),
      pressure: 'pressure' in event ? pointerEvent.pressure : undefined,
      pointerType: 'pointerType' in event ? pointerEvent.pointerType : undefined,
      modifiers,
      time: now,
      originalEvent: event,
    };
  }

  public createSample(
    event: PointerEvent | MouseEvent | TouchEvent,
    target: HTMLElement | DOMRect,
    now: number = performance.now(),
  ): PointerSample {
    return this.normalizeEvent(event, target, now);
  }

  public updateRaycasterFromSample(sample: PointerSample, camera: THREE.Camera, raycaster: THREE.Raycaster): void {
    const ndc = new THREE.Vector2(sample.xNdc, sample.yNdc);
    raycaster.setFromCamera(ndc, camera);
  }
}

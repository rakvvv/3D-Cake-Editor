import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PaintMaterialHooksService {
  public readonly sceneChanged$ = new Subject<void>();

  public notifySceneChanged(): void {
    this.sceneChanged$.next();
  }
}

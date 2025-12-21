import * as THREE from 'three';

import { SurfacePaintingService } from '../surface-painting.service';
import { PaintService } from '../paint.service';
import { TransformControlsService } from '../transform-controls-service';
import { SceneInitService } from '../scene-init.service';
import { ThreeSceneState } from './three-scene.state';

interface SceneInteractionDependencies {
  state: ThreeSceneState;
  mouse: THREE.Vector2;
  raycaster: THREE.Raycaster;
  paintService: PaintService;
  surfacePainting: SurfacePaintingService;
  transformControlsService: TransformControlsService;
  sceneInitService: SceneInitService;
  pickPaintableHit: (intersects: THREE.Intersection[]) => THREE.Intersection | null;
  isPaintable: (object: THREE.Object3D) => boolean;
  onClickDown: (event: MouseEvent) => void;
  stopPaintingStroke: () => void;
  handleAnchorOptionHistory: (object: THREE.Object3D | undefined, redo: boolean) => void;
  requestRender: () => void;
  getCamera: () => THREE.Camera;
  getRenderer: () => THREE.WebGLRenderer;
  getScene: () => THREE.Scene;
}

export class SceneInteractionController {
  private readonly state: ThreeSceneState;
  private readonly mouse: THREE.Vector2;
  private readonly raycaster: THREE.Raycaster;
  private readonly paintService: PaintService;
  private readonly surfacePainting: SurfacePaintingService;
  private readonly transformControlsService: TransformControlsService;
  private readonly sceneInitService: SceneInitService;
  private readonly pickPaintableHit: SceneInteractionDependencies['pickPaintableHit'];
  private readonly isPaintable: SceneInteractionDependencies['isPaintable'];
  private readonly onClickDown: SceneInteractionDependencies['onClickDown'];
  private readonly stopPaintingStroke: SceneInteractionDependencies['stopPaintingStroke'];
  private readonly handleAnchorOptionHistory: SceneInteractionDependencies['handleAnchorOptionHistory'];
  private readonly requestRender: SceneInteractionDependencies['requestRender'];
  private readonly getCamera: SceneInteractionDependencies['getCamera'];
  private readonly getRenderer: SceneInteractionDependencies['getRenderer'];
  private readonly getScene: SceneInteractionDependencies['getScene'];

  // Prevent multiple undo/redo executions from a single physical keydown.
  private lastUndoEventStamp: number | null = null;
  private lastRedoEventStamp: number | null = null;

  constructor(deps: SceneInteractionDependencies) {
    this.state = deps.state;
    this.mouse = deps.mouse;
    this.raycaster = deps.raycaster;
    this.paintService = deps.paintService;
    this.surfacePainting = deps.surfacePainting;
    this.transformControlsService = deps.transformControlsService;
    this.sceneInitService = deps.sceneInitService;
    this.pickPaintableHit = deps.pickPaintableHit;
    this.isPaintable = deps.isPaintable;
    this.onClickDown = deps.onClickDown;
    this.stopPaintingStroke = deps.stopPaintingStroke;
    this.handleAnchorOptionHistory = deps.handleAnchorOptionHistory;
    this.requestRender = deps.requestRender;
    this.getCamera = deps.getCamera;
    this.getRenderer = deps.getRenderer;
    this.getScene = deps.getScene;
  }

  public attach(container: HTMLElement): void {
    this.detach();
    this.state.container = container;
    this.state.ownerDocument = container.ownerDocument ?? document;

    container.addEventListener('mousedown', this.handleMouseDown);
    container.addEventListener('mousemove', this.handleMouseMove);
    container.addEventListener('mouseup', this.handleMouseUp);
    container.addEventListener('mouseleave', this.handleMouseLeave);
    container.addEventListener('contextmenu', this.handleContextMenu);

    this.state.ownerDocument?.addEventListener('keydown', this.handleKeyDown);
  }

  public detach(): void {
    if (this.state.container) {
      this.state.container.removeEventListener('mousedown', this.handleMouseDown);
      this.state.container.removeEventListener('mousemove', this.handleMouseMove);
      this.state.container.removeEventListener('mouseup', this.handleMouseUp);
      this.state.container.removeEventListener('mouseleave', this.handleMouseLeave);
      this.state.container.removeEventListener('contextmenu', this.handleContextMenu);
    }

    if (this.state.ownerDocument) {
      this.state.ownerDocument.removeEventListener('keydown', this.handleKeyDown);
    }

    this.state.container = undefined;
    this.state.ownerDocument = undefined;
  }

  private handleMouseDown = (event: MouseEvent) => {
    if (!this.state.container) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (this.surfacePainting.enabled && this.state.cakeBase) {
      const rect = this.getRenderer().domElement.getBoundingClientRect();
      this.updatePointer(event, rect);
      const intersectsCake = this.raycaster.intersectObject(this.state.cakeBase, true);
      const paintHit = this.pickPaintableHit(intersectsCake);
      if (!paintHit || this.transformControlsService.isDragging()) {
        this.onClickDown(event);
        return;
      }

      if (!this.isPaintable(paintHit.object)) {
        this.onClickDown(event);
        return;
      }

      this.surfacePainting.startStroke();
      this.sceneInitService.setOrbitEnabled(false);
      void this.surfacePainting.handlePointer(paintHit, this.getScene());
      this.requestRender();
      return;
    }

    if (this.paintService.paintMode && this.state.cakeBase) {
      const rect = this.getRenderer().domElement.getBoundingClientRect();
      this.updatePointer(event, rect);
      const intersectsCake = this.raycaster.intersectObject(this.state.cakeBase, true);
      if (!intersectsCake.length || this.transformControlsService.isDragging()) {
        this.onClickDown(event);
        return;
      }

      this.paintService.beginStroke(rect);
      this.sceneInitService.setOrbitEnabled(false);
      void this.paintService.handlePaint(
        event,
        this.getRenderer(),
        this.getCamera(),
        this.getScene(),
        this.state.cakeBase,
        this.mouse,
        this.raycaster,
      );
      this.requestRender();
      return;
    }

    this.onClickDown(event);
  };

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.state.container) {
      return;
    }

    if (this.surfacePainting.enabled && this.surfacePainting.isPainting() && this.state.cakeBase) {
      if (event.buttons !== undefined && (event.buttons & 1) === 0) {
        this.stopPaintingStroke();
        return;
      }

      if (this.transformControlsService.isDragging()) {
        this.stopPaintingStroke();
        return;
      }

      const rect = this.getRenderer().domElement.getBoundingClientRect();
      this.updatePointer(event, rect);
      const intersectsCake = this.raycaster.intersectObject(this.state.cakeBase, true);
      const paintHit = this.pickPaintableHit(intersectsCake);
      if (!paintHit) {
        return;
      }
      if (!this.isPaintable(paintHit.object)) {
        return;
      }
      void this.surfacePainting.handlePointer(paintHit, this.getScene());
      this.requestRender();
      return;
    }

    if (!this.paintService.paintMode || !this.paintService.isPainting || !this.state.cakeBase) {
      return;
    }

    if (event.buttons !== undefined && (event.buttons & 1) === 0) {
      this.stopPaintingStroke();
      return;
    }

    if (this.transformControlsService.isDragging()) {
      this.stopPaintingStroke();
      return;
    }

    void this.paintService.handlePaint(
      event,
      this.getRenderer(),
      this.getCamera(),
      this.getScene(),
      this.state.cakeBase,
      this.mouse,
      this.raycaster,
    );
    this.requestRender();
  };

  private handleMouseUp = () => this.stopPaintingStroke();

  private handleMouseLeave = () => this.stopPaintingStroke();

  private handleContextMenu = (event: MouseEvent) => {
    const painting =
      (this.paintService.paintMode && this.paintService.isPainting) ||
      (this.surfacePainting.enabled && this.surfacePainting.isPainting());
    const orbitActive = this.sceneInitService.isOrbitBusy(200);
    if (painting || orbitActive) {
      event.preventDefault();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if (!ctrlOrMeta) {
      return;
    }

    if (event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();
    const wantsUndo = key === 'z' && !event.shiftKey;
    const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);

    if (wantsUndo) {
      if (this.paintService.canUndo()) {
        if (this.lastUndoEventStamp === event.timeStamp) {
          return;
        }
        this.lastUndoEventStamp = event.timeStamp;
        const undone = this.paintService.undo();
        this.handleAnchorOptionHistory(undone, false);
        event.preventDefault();
      }
    } else if (wantsRedo) {
      if (this.paintService.canRedo()) {
        if (this.lastRedoEventStamp === event.timeStamp) {
          return;
        }
        this.lastRedoEventStamp = event.timeStamp;
        const redone = this.paintService.redo();
        this.handleAnchorOptionHistory(redone, true);
        event.preventDefault();
      }
    }
  };

  private updatePointer(event: MouseEvent, rect: DOMRect): void {
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.getCamera());
  }
}

import * as THREE from 'three';
import { SelectionService } from '../selection.service';
import { SnapService } from '../snap.service';
import { TransformManagerState } from './transform-manager.state';

export class TransformEventHandler {
  constructor(
    private readonly state: TransformManagerState,
    private readonly selectionService: SelectionService,
    private readonly snapService: SnapService,
    private readonly renderScene: () => void,
  ) {}

  public readonly onTransformChange = () => {
    this.renderScene();

    if (this.state.boxHelperCallback) {
      this.state.boxHelperCallback();
    }

    const selectedObject = this.selectionService.getSelectedObject();
    const transformControls = this.state.transformControls;
    if (!selectedObject || !transformControls) {
      return;
    }

    if (!transformControls.dragging) {
      return;
    }

    const anchorId = selectedObject.userData['anchorId'] as string | undefined;

    if (this.state.lockedSelection.object === selectedObject) {
      this.state.lockedSelection.position.copy(selectedObject.position);
      this.state.lockedSelection.quaternion.copy(selectedObject.quaternion);
      this.state.lockedSelection.scale.copy(selectedObject.scale);
      selectedObject.updateMatrixWorld(true);
      this.snapService.enforceSnappedPosition(selectedObject);
      return;
    }

    const mode = transformControls.mode;
    if (!anchorId && (mode === 'translate' || mode === 'scale')) {
      this.snapService.updateSnapFromObjectPosition(selectedObject);
      this.snapService.enforceSnappedPosition(selectedObject);
    }
  };

  public readonly onDraggingChanged = (event: THREE.Event) => {
    const draggingValue = (event as THREE.Event & { value: boolean }).value;

    if (this.state.orbit) {
      this.state.orbit.enabled = !draggingValue;
    }

    if (draggingValue) {
      this.state.wasDragging = true;
      return;
    }

    if (!this.state.wasDragging) {
      return;
    }

    this.state.wasDragging = false;

    const transformControls = this.state.transformControls;
    if (!draggingValue && transformControls) {
      const selectedObject = this.selectionService.getSelectedObject();
      if (!selectedObject) {
        return;
      }

      const mode = transformControls.mode;
      const anchorId = selectedObject.userData['anchorId'] as string | undefined;

      if (mode === 'rotate') {
        this.snapService.captureSnappedOrientation(selectedObject);
      } else if (!anchorId && (mode === 'translate' || mode === 'scale')) {
        this.snapService.enforceSnappedPosition(selectedObject);
      }

      if (this.state.anchorSnapshotCallback) {
        this.state.anchorSnapshotCallback(selectedObject);
      }
    }
  };

  public readonly onKeyDown = (event: KeyboardEvent): void => {
    const selectedObject = this.selectionService.getSelectedObject();

    if ((event.key === 'c' || event.key === 'C') && (event.ctrlKey || event.metaKey)) {
      if (this.state.copyDecorationCallback && selectedObject) {
        event.preventDefault();
        this.state.copyDecorationCallback();
      }
      return;
    }

    if ((event.key === 'v' || event.key === 'V') && (event.ctrlKey || event.metaKey)) {
      if (this.state.pasteDecorationCallback) {
        event.preventDefault();
        this.state.pasteDecorationCallback();
      }
      return;
    }

    if (!selectedObject) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const cakeBase = this.snapService.getCakeBase();
      this.selectionService.removeSelectedObject(
        this.state.scene!,
        cakeBase,
        (object) => {
          if (this.state.removeDecorationCallback) {
            this.state.removeDecorationCallback(object);
            return;
          }

          if (cakeBase && object.parent === cakeBase) {
            this.state.scene?.attach(object);
          }

          this.state.scene?.remove(object);
        },
        this.state.transformControls!,
        this.state.boxHelperCallback,
      );
    }
  };
}

import { Injectable } from '@angular/core';
import { Command, HistoryDomain } from '../types/interaction-types';

@Injectable({ providedIn: 'root' })
export class CommandFactoryService {
  public createAddRemoveCommand<T extends { parent?: any; userData?: Record<string, any> }>(
    domain: HistoryDomain,
    object: T,
    parent: any,
    projectId: string | null,
    onChanged?: () => void,
  ): Command<T | null> {
    return {
      description: `${domain}-add-remove`,
      do: () => {
        if (projectId && object?.userData?.['projectId'] && object.userData['projectId'] !== projectId) {
          return null;
        }
        if (parent && object && object.parent !== parent) {
          parent.add?.(object);
        } else if (parent && !parent.children?.includes?.(object)) {
          parent.add?.(object);
        }
        if (object?.userData) {
          delete object.userData['removedByUndo'];
        }
        onChanged?.();
        return object;
      },
      undo: () => {
        if (object?.parent) {
          object.parent.remove?.(object);
          if (object.userData) {
            object.userData['removedByUndo'] = true;
          }
        }
        onChanged?.();
        return object;
      },
    };
  }

  public createClearCommand<T>(
    domain: HistoryDomain,
    clearFn: () => T,
    restoreFn: (snapshot: T) => void,
    onChanged?: () => void,
  ): Command<T> {
    return {
      description: `${domain}-clear`,
      do: () => {
        const snapshot = clearFn();
        onChanged?.();
        return snapshot;
      },
      undo: (snapshot?: T) => {
        if (snapshot !== undefined) {
          restoreFn(snapshot);
          onChanged?.();
        }
        return snapshot as T;
      },
    };
  }
}

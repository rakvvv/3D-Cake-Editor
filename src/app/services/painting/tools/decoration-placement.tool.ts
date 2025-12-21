import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {DecorationInfo} from '../../../models/decorationInfo';
import {DecorationFactory} from '../../../factories/decoration.factory';
import {DecorationsService} from '../../decorations.service';
import {DecorationRegistryService} from '../../decoration-registry.service';
import {CommandFactoryService} from '../../interaction/history/command-factory.service';
import {HistoryService} from '../../interaction/history/history.service';
import {HistoryDomain, HitResult} from '../../interaction/types/interaction-types';
import {PaintingContext} from '../common/painting-context';
import {markSceneStroke, tagNode} from '../common/painting-metadata';
import {DecorationRendererService} from '../decorations/decoration-renderer.service';
import {DecorationStrokeBuilderService} from '../decorations/decoration-stroke-builder.service';
import {environment} from '../../../../environments/environment';

class DecorationPlacementState {
  activeDecorationGroup: THREE.Group | null = null;
  brushCache = new Map<string, THREE.Object3D>();
  brushPromises = new Map<string, Promise<THREE.Object3D>>();
  brushSizes = new Map<string, THREE.Vector3>();
  brushScaleMultipliers = new Map<string, number>();
  brushMetadata = new Map<string, Partial<DecorationInfo> & { initialScale?: number }>();
  decorationVariants = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; name: string }[]>();
  decorationVariantCursor = new Map<string, number>();
  debugMarker?: THREE.Mesh;
  debugNormal?: THREE.Line;
}

@Injectable({ providedIn: 'root' })
export class DecorationPlacementTool {
  private readonly state = new DecorationPlacementState();
  private readonly historyDomain = HistoryDomain.Decorations;

  constructor(
    private readonly decorationRenderer: DecorationRendererService,
    private readonly decorationStrokeBuilder: DecorationStrokeBuilderService,
    private readonly commandFactory: CommandFactoryService,
    private readonly historyService: HistoryService,
    private readonly decorationRegistry: DecorationRegistryService,
    private readonly decorationsService: DecorationsService,
  ) {}

  public getActiveDecorationGroup(): THREE.Group | null {
    return this.state.activeDecorationGroup;
  }

  public setActiveDecorationGroup(group: THREE.Group | null): void {
    this.state.activeDecorationGroup = group;
  }

  public resetStrokeState(): void {
    this.state.activeDecorationGroup = null;
  }

  public clearVariantCursor(): void {
    this.state.decorationVariantCursor.clear();
  }

  public clearInstances(): void {
    this.state.decorationVariantCursor.clear();
    this.state.decorationVariants.forEach((_, brushId) => this.decorationRenderer.removeDecorationGroup(brushId));
    this.state.activeDecorationGroup = null;
  }

  public setBrushMetadata(brushId: string, metadata: Partial<DecorationInfo> & { initialScale?: number } | null): void {
    const previous = this.state.brushMetadata.get(brushId);
    const previousKey = previous ? JSON.stringify(previous) : null;
    const nextKey = metadata ? JSON.stringify(metadata) : null;
    if (previousKey === nextKey) {
      return;
    }

    if (metadata) {
      this.state.brushMetadata.set(brushId, metadata);
      this.state.brushScaleMultipliers.set(brushId, metadata.initialScale ?? 1);
    } else {
      this.state.brushMetadata.delete(brushId);
      this.state.brushScaleMultipliers.delete(brushId);
    }

    this.state.brushCache.delete(brushId);
    this.state.brushPromises.delete(brushId);
    this.state.decorationVariants.delete(brushId);
    this.decorationRenderer.disposeDecorationAssets(brushId);
    this.state.brushSizes.delete(brushId);
  }

  public getDecorationSpacing(brushId: string, baseMinDistance: number): number {
    const templateSize = this.state.brushSizes.get(brushId);
    const scale = this.state.brushScaleMultipliers.get(brushId) ?? 1;

    if (templateSize) {
      const maxDim = Math.max(templateSize.x, templateSize.y, templateSize.z);
      const scaledMax = maxDim * scale;
      const spacing = scaledMax * 0.4; // 40% rozmiaru dekoracji
      return Math.max(baseMinDistance, spacing);
    }

    return baseMinDistance * 2;
  }

  public getDecorationScale(brushId: string): number {
    return this.state.brushScaleMultipliers.get(brushId) ?? 1;
  }

  public async getDecorationVariantsForBrush(brushId: string) {
    return this.getDecorationVariants(brushId);
  }

  public async placeDecorationBrush(
    brushId: string,
    hit: HitResult,
    penSurfaceOffset: number,
    context: PaintingContext,
    maxInstances: number,
  ): Promise<void> {
    if (!context.scene) {
      return;
    }

    const decorationGroup = this.ensureActiveDecorationGroup(context, brushId);
    const variants = await this.getDecorationVariants(brushId);
    if (!variants.length) {
      return;
    }

    const scale = this.getDecorationScale(brushId);
    const decorationInfo = this.getDecorationInfoForBrush(brushId);
    const parent = decorationGroup;
    const matrix = this.decorationStrokeBuilder.buildPlacementMatrix(
      hit,
      decorationInfo,
      scale,
      penSurfaceOffset,
      parent ?? null,
    );
    const selectedVariant = this.getNextDecorationVariantIndex(brushId, variants.length);
    this.decorationRenderer.addDecorationInstances(
      brushId,
      variants,
      decorationGroup,
      matrix,
      maxInstances,
      selectedVariant,
    );
    this.state.activeDecorationGroup = decorationGroup;
  }

  public createAddRemoveCommand(
    object: THREE.Object3D,
    parent: THREE.Object3D | null,
    context: PaintingContext,
  ) {
    const targetParent = parent ?? context.scene;
    const instanceId = this.tagDecoration(object, context.projectId ?? null, context.cakeRoot?.uuid);
    const base = this.commandFactory.createAddRemoveCommand(
      this.historyDomain,
      object,
      targetParent,
      context.projectId,
      context.onSceneChanged,
    );
    return {
      description: base.description,
      do: () => {
        const result = base.do();
        if (result) {
          this.decorationRegistry.register(context.projectId ?? null, instanceId, object);
        }
        return result;
      },
      undo: () => {
        const result = base.undo();
        this.decorationRegistry.unregister(instanceId, context.projectId ?? null);
        return result;
      },
    };
  }

  public seedHistoryFromExistingDecorations(
    context: PaintingContext,
    projectId: string | null,
    objects?: THREE.Object3D[],
  ): void {
    if (!context.scene || !projectId) {
      return;
    }

    const parent = context.cakeRoot ?? context.scene;
    const decorations = objects ?? this.collectDecorationRootsFromScene(parent);
    decorations.forEach((object) => {
      this.tagDecoration(object, projectId, context.cakeRoot?.uuid);
      const command = this.createAddRemoveCommand(object, object.parent ?? parent, context);
      this.historyService.seed(this.historyDomain, command);
    });
  }

  private collectDecorationRootsFromScene(root: THREE.Object3D): THREE.Object3D[] {
    const result: THREE.Object3D[] = [];
    const visited = new Set<THREE.Object3D>();

    const traverse = (object: THREE.Object3D) => {
      object.children.forEach((child) => {
        if (child.userData['decorationType'] || child.userData['isPaintStroke'] || child.userData['isPaintDecoration']) {
          const rootNode = this.resolveDecorationRoot(child);
          if (!visited.has(rootNode)) {
            visited.add(rootNode);
            result.push(rootNode);
          }
        }
        traverse(child);
      });
    };

    traverse(root);
    return result;
  }

  public updateDebugHit(hit: HitResult, context: PaintingContext): void {
    if (!environment.debugInteractionNormals || !context.scene) {
      return;
    }
    const point = hit.pointWorld ?? hit.point;
    const normal = hit.normalWorld ?? hit.normal;
    if (!point || !normal) {
      return;
    }

    if (!this.state.debugMarker) {
      const geometry = new THREE.SphereGeometry(0.01, 8, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0xff00ff });
      this.state.debugMarker = new THREE.Mesh(geometry, material);
      this.state.debugMarker.name = 'debug-hit-marker';
      context.scene.add(this.state.debugMarker);
    }

    if (!this.state.debugNormal) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const material = new THREE.LineBasicMaterial({ color: 0x00ffff });
      this.state.debugNormal = new THREE.Line(geometry, material);
      this.state.debugNormal.name = 'debug-hit-normal';
      context.scene.add(this.state.debugNormal);
    }

    this.state.debugMarker.position.copy(point);

    const positions = (this.state.debugNormal.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, point.x, point.y, point.z);
    const endPoint = point.clone().addScaledVector(normal, 0.05);
    positions.setXYZ(1, endPoint.x, endPoint.y, endPoint.z);
    positions.needsUpdate = true;
  }

  private resolveDecorationRoot(node: THREE.Object3D): THREE.Object3D {
    let current: THREE.Object3D | null = node;
    while (current?.parent) {
      if (current.parent.name === 'cake-root' || current.parent.userData['belongsToCakeId']) {
        return current;
      }
      current = current.parent;
    }
    return node;
  }

  private ensureActiveDecorationGroup(context: PaintingContext, brushId: string): THREE.Group {
    const group =
      this.state.activeDecorationGroup ?? this.decorationRenderer.ensureActiveDecorationGroup(context, brushId);
    if (!group) {
      throw new Error('Brak grupy dekoracji');
    }
    this.state.activeDecorationGroup = group;
    return group;
  }

  private getDecorationInfoForBrush(brushId: string): DecorationInfo {
    const fallback: DecorationInfo = {
      id: brushId,
      name: brushId,
      modelFileName: brushId,
      type: 'BOTH',
    };

    const base = this.decorationsService.getDecorationInfo(brushId) ?? fallback;
    const overrides = this.state.brushMetadata.get(brushId);
    if (!overrides) {
      return base;
    }

    return {
      ...base,
      ...overrides,
      id: base.id ?? fallback.id,
      name: base.name ?? fallback.name,
      modelFileName: base.modelFileName ?? fallback.modelFileName,
      type: base.type ?? fallback.type,
    };
  }

  private getNextDecorationVariantIndex(brushId: string, total: number): number {
    if (total <= 0) {
      return 0;
    }

    const next = this.state.decorationVariantCursor.get(brushId) ?? 0;
    const index = next % total;
    this.state.decorationVariantCursor.set(brushId, index + 1);
    return index;
  }

  private async getDecorationVariants(brushId: string) {
    const cached = this.state.decorationVariants.get(brushId);
    if (cached) {
      return cached;
    }

    const variants = await this.loadDecorationVariants(brushId);
    this.state.decorationVariants.set(brushId, variants);
    return variants;
  }

  private async loadDecorationVariants(brushId: string) {
    const template = await this.loadBrushTemplate(brushId);
    const variants: { geometry: THREE.BufferGeometry; material: THREE.Material; name: string }[] = [];

    template.updateMatrixWorld(true);

    template.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld.clone());
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.clone();

      if (!material) {
        return;
      }

      variants.push({
        geometry,
        material,
        name: mesh.name || 'Dekoracja',
      });
    });

    return variants;
  }

  private loadBrushTemplate(brushId: string): Promise<THREE.Object3D> {
    const cached = this.state.brushCache.get(brushId);
    if (cached) {
      return Promise.resolve(cached);
    }

    const inFlight = this.state.brushPromises.get(brushId);
    if (inFlight) {
      return inFlight;
    }

    const promise = DecorationFactory.loadDecorationModel(`/models/${brushId}`)
      .then((model) => {
        const metadata = this.state.brushMetadata.get(brushId);
        if (metadata) {
          this.applyBrushMetadataToTemplate(model, metadata);
        }
        this.state.brushCache.set(brushId, model);
        this.state.brushSizes.set(brushId, this.computeBrushSize(model));
        this.state.brushPromises.delete(brushId);
        return model;
      })
      .catch((error) => {
        this.state.brushPromises.delete(brushId);
        throw error;
      });

    this.state.brushPromises.set(brushId, promise);
    return promise;
  }

  private applyBrushMetadataToTemplate(model: THREE.Object3D, metadata: Partial<DecorationInfo>): void {
    if (metadata.initialRotation) {
      const [x, y, z] = metadata.initialRotation;
      model.rotation.set(
        THREE.MathUtils.degToRad(x ?? 0),
        THREE.MathUtils.degToRad(y ?? 0),
        THREE.MathUtils.degToRad(z ?? 0),
      );
    }

    if (metadata.material) {
      this.applyMaterialOverrides(model, metadata.material);
    }

    model.updateMatrixWorld(true);
  }

  private computeBrushSize(model: THREE.Object3D): THREE.Vector3 {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size;
  }

  private applyMaterialOverrides(
    object: THREE.Object3D,
    materialConfig?: { roughness?: number; metalness?: number },
  ): void {
    if (!materialConfig) {
      return;
    }

    object.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) {
        return;
      }

      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((material) => {
        const hasUnlitExtension = !!(material as any).userData?.gltfExtensions?.KHR_materials_unlit;
        if (hasUnlitExtension) {
          return;
        }

        if (materialConfig.roughness !== undefined && 'roughness' in material) {
          (material as any).roughness = materialConfig.roughness;
          material.needsUpdate = true;
        }

        if (materialConfig.metalness !== undefined && 'metalness' in material) {
          (material as any).metalness = materialConfig.metalness;
          material.needsUpdate = true;
        }
      });
    });
  }

  private tagDecoration(object: THREE.Object3D, projectId: string | null, cakeId?: string): string {
    const instanceId = (object.userData['instanceId'] as string | undefined) ?? object.uuid;
    object.userData['instanceId'] = instanceId;
    object.userData['belongsToCakeId'] = cakeId;
    markSceneStroke(object, 'decoration', instanceId, projectId ?? undefined, 'decoration');
    tagNode(object, { projectId: projectId ?? undefined, cakeId });
    this.decorationRegistry.register(projectId, instanceId, object);
    return instanceId;
  }
}

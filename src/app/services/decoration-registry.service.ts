import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({ providedIn: 'root' })
export class DecorationRegistryService {
  private readonly registry = new Map<string, Map<string, THREE.Object3D>>();

  public register(projectId: string | null, instanceId: string, object: THREE.Object3D): void {
    if (!projectId) return;
    const byProject = this.registry.get(projectId) ?? new Map<string, THREE.Object3D>();
    byProject.set(instanceId, object);
    this.registry.set(projectId, byProject);
  }

  public unregister(instanceId: string, projectId: string | null): void {
    if (!projectId) return;
    const byProject = this.registry.get(projectId);
    if (!byProject) return;
    byProject.delete(instanceId);
  }

  public get(instanceId: string, projectId: string | null): THREE.Object3D | undefined {
    if (!projectId) return undefined;
    return this.registry.get(projectId)?.get(instanceId);
  }

  public listByProject(projectId: string | null): THREE.Object3D[] {
    if (!projectId) return [];
    return Array.from(this.registry.get(projectId)?.values() ?? []);
  }

  public clearForProject(projectId: string | null): void {
    if (!projectId) return;
    this.registry.delete(projectId);
  }

  public clearAll(): void {
    this.registry.clear();
  }
}


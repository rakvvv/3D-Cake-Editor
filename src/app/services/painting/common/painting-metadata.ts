import * as THREE from 'three';

export interface PaintingMetadata {
  projectId?: string | null;
  cakeId?: string | null;
  strokeId?: string;
  domain?: 'surface' | 'decoration';
  type?: string;
  displayName?: string;
  [key: string]: unknown;
}

const USER_DATA_KEYS = {
  projectId: 'projectId',
  cakeId: 'cakeId',
  domain: 'domain',
  type: 'paintStrokeType',
  strokeId: 'strokeId',
  displayName: 'displayName',
  isPaintStroke: 'isPaintStroke',
};

export function tagNode(node: THREE.Object3D, meta: PaintingMetadata): void {
  const data = node.userData ?? {};
  data[USER_DATA_KEYS.isPaintStroke] = true;
  if (meta.projectId !== undefined) {
    data[USER_DATA_KEYS.projectId] = meta.projectId ?? undefined;
  }
  if (meta.cakeId !== undefined) {
    data[USER_DATA_KEYS.cakeId] = meta.cakeId ?? undefined;
  }
  if (meta.domain) {
    data[USER_DATA_KEYS.domain] = meta.domain;
  }
  if (meta.type) {
    data[USER_DATA_KEYS.type] = meta.type;
  }
  if (meta.strokeId) {
    data[USER_DATA_KEYS.strokeId] = meta.strokeId;
  }
  if (meta.displayName) {
    data[USER_DATA_KEYS.displayName] = meta.displayName;
  }
  Object.assign(data, meta);
  node.userData = data;
}

export function readMeta(node: THREE.Object3D): PaintingMetadata {
  const data = node.userData ?? {};
  return {
    projectId: data[USER_DATA_KEYS.projectId] ?? data['projectId'],
    cakeId: data[USER_DATA_KEYS.cakeId] ?? data['cakeId'],
    domain: data[USER_DATA_KEYS.domain] ?? data['domain'],
    type: data[USER_DATA_KEYS.type] ?? data['paintStrokeType'],
    strokeId: data[USER_DATA_KEYS.strokeId] ?? data['strokeId'],
    displayName: data[USER_DATA_KEYS.displayName] ?? data['displayName'],
  } as PaintingMetadata;
}

export function assertProjectOwnership(node: THREE.Object3D, projectId: string | null): boolean {
  if (!projectId) {
    return true;
  }
  const meta = readMeta(node);
  return !meta.projectId || meta.projectId === projectId;
}

export function markSceneStroke(
  node: THREE.Object3D,
  domain: 'surface' | 'decoration',
  strokeId?: string,
  projectId?: string | null,
  type?: string,
  displayName?: string,
): void {
  tagNode(node, { domain, strokeId, projectId, type, displayName });
}

import * as THREE from 'three';

export type PaintingKind =
  | 'DECORATION_MANUAL'
  | 'DECORATION_STAMP'
  | 'PEN_STROKE'
  | 'SURFACE_STROKE'
  | string;

export interface PaintingMetadata {
  projectId?: string | null;
  cakeId?: string | null;
  strokeId?: string;
  domain?: 'surface' | 'decoration';
  type?: string;
  displayName?: string;
  kind?: PaintingKind;
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
  kind: 'paintKind',
};

function isStrokeKind(kind: PaintingKind | undefined): boolean {
  return kind === 'DECORATION_STAMP' || kind === 'PEN_STROKE' || kind === 'SURFACE_STROKE';
}

export function tagNode(node: THREE.Object3D, meta: PaintingMetadata): void {
  const data = node.userData ?? {};
  const kind = meta.kind ?? data[USER_DATA_KEYS.kind];
  const isStroke = isStrokeKind(kind) || meta.domain === 'surface';
  if (isStroke) {
    data[USER_DATA_KEYS.isPaintStroke] = true;
  }
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
  if (kind) {
    data[USER_DATA_KEYS.kind] = kind;
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
    kind: data[USER_DATA_KEYS.kind] ?? data['kind'] ?? data['paintKind'],
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
  kind: PaintingKind = domain === 'surface' ? 'SURFACE_STROKE' : 'DECORATION_STAMP',
): void {
  tagNode(node, { domain, strokeId, projectId, type, displayName, kind });
}

export function readKind(node: THREE.Object3D): PaintingKind | undefined {
  const meta = readMeta(node);
  if (meta.kind) {
    return meta.kind;
  }
  if (node.userData['isDecoration'] === true && !node.userData['isPaintStroke']) {
    return 'DECORATION_MANUAL';
  }
  if (meta.type === 'pen') {
    return 'PEN_STROKE';
  }
  if (meta.domain === 'surface') {
    return 'SURFACE_STROKE';
  }
  if (meta.domain === 'decoration' || meta.type === 'decoration' || node.userData['isPaintStroke']) {
    return 'DECORATION_STAMP';
  }
  return undefined;
}

export function isStrokeObject(object: THREE.Object3D | null): boolean {
  if (!object) {
    return false;
  }
  const meta = readMeta(object);
  const kind = meta.kind ?? (object.userData['isPaintStroke'] ? meta.kind ?? 'SURFACE_STROKE' : undefined);
  return isStrokeKind(kind);
}

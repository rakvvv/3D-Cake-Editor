export type SceneOutlineNodeType = 'cake' | 'layer' | 'group' | 'decoration';

export interface SceneOutlineNode {
  id: string;
  name: string;
  type: SceneOutlineNodeType;
  attached: boolean;
  visible: boolean;
  parentId: string | null;
  layerIndex: number | null;
  surface: 'TOP' | 'SIDE' | 'NONE' | null;
  children: SceneOutlineNode[];
}

import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SceneOutlineNode } from '../../models/scene-outline';
import { ThreeSceneService } from '../../services/three-scene.service';

@Component({
  selector: 'app-scene-outline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scene-outline.component.html',
  styleUrls: ['../sidebar-panel.css', './scene-outline.component.css'],
})
export class SceneOutlineComponent implements OnInit {
  outline: SceneOutlineNode | null = null;
  selectedId: string | null = null;
  groupingSelection = new Set<string>();
  expandedNodes = new Set<string>();
  statusMessage: string | null = null;
  statusPositive = true;
  groupName = '';

  constructor(private readonly sceneService: ThreeSceneService) {}

  ngOnInit(): void {
    this.refreshOutline();
  }

  refreshOutline(): void {
    this.outline = this.sceneService.getSceneOutline();
    this.selectedId = this.sceneService.getSelectedDecorationId();
    this.ensureRootExpanded(this.outline);
  }

  toggleExpanded(nodeId: string): void {
    if (this.expandedNodes.has(nodeId)) {
      this.expandedNodes.delete(nodeId);
    } else {
      this.expandedNodes.add(nodeId);
    }
  }

  isExpanded(nodeId: string): boolean {
    return this.expandedNodes.has(nodeId);
  }

  isSelectable(node: SceneOutlineNode): boolean {
    return node.type === 'decoration' || node.type === 'group';
  }

  onSelect(node: SceneOutlineNode): void {
    if (!this.isSelectable(node)) {
      return;
    }

    const success = this.sceneService.selectDecorationById(node.id);
    this.selectedId = success ? node.id : this.selectedId;
  }

  toggleVisibility(node: SceneOutlineNode): void {
    if (!this.isSelectable(node)) {
      return;
    }

    const targetState = !node.visible;
    const success = this.sceneService.setDecorationVisibility(node.id, targetState);
    if (success) {
      this.refreshOutline();
    }
  }

  toggleGrouping(node: SceneOutlineNode, checked: boolean): void {
    if (!this.isSelectable(node)) {
      return;
    }

    if (checked) {
      this.groupingSelection.add(node.id);
    } else {
      this.groupingSelection.delete(node.id);
    }
  }

  groupSelected(): void {
    const ids = Array.from(this.groupingSelection);
    const result = this.sceneService.groupDecorationsByIds(ids, this.groupName || undefined);
    this.statusMessage = result.message;
    this.statusPositive = result.success;

    if (result.success) {
      this.groupingSelection.clear();
      this.groupName = '';
      this.selectedId = result.groupId ?? this.selectedId;
      this.refreshOutline();
    }
  }

  attachmentLabel(node: SceneOutlineNode): string {
    if (node.type === 'layer' || node.type === 'cake') {
      return node.name;
    }

    return node.attached ? 'Przyczepione' : 'Nieprzyczepione';
  }

  surfaceLabel(node: SceneOutlineNode): string | null {
    if (!node.attached || !node.surface || node.surface === 'NONE') {
      return null;
    }

    if (node.surface === 'TOP') {
      return 'góra tortu';
    }

    if (node.surface === 'SIDE') {
      return 'bok tortu';
    }

    return null;
  }

  private ensureRootExpanded(node: SceneOutlineNode | null): void {
    if (!node) {
      return;
    }

    this.expandedNodes.add(node.id);
    node.children.forEach((child) => this.expandedNodes.add(child.id));
  }
}

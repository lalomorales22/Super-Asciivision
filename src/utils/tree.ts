import type { WorkspaceItem } from "../types";
import { isSameOrDescendantPath, leafName, relativeWorkspacePath } from "./paths";

export interface IdeTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  file?: WorkspaceItem;
  children?: IdeTreeNode[];
}

export function buildIdeTree(items: WorkspaceItem[], roots: string[]) {
  const rootNodes = new Map<string, IdeTreeNode>();

  for (const root of roots) {
    rootNodes.set(root, {
      id: `root:${root}`,
      name: leafName(root),
      path: root,
      kind: "folder",
      children: [],
    });
  }

  items.forEach((item) => {
    const rootPath = roots.find((root) => isSameOrDescendantPath(item.path, root));
    const rootKey = rootPath ?? roots[0] ?? item.workspaceId;
    const rootNode =
      rootNodes.get(rootKey) ??
      {
        id: `root:${rootKey}`,
        name: leafName(rootKey),
        path: rootKey,
        kind: "folder" as const,
        children: [],
      };
    rootNodes.set(rootKey, rootNode);

    const parts = relativeWorkspacePath(item.path, roots).split("/").filter(Boolean);
    let currentNode = rootNode;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      currentNode.children ??= [];
      let nextNode = currentNode.children.find((child) => child.name === part);
      if (!nextNode) {
        const nodePath = isLeaf ? item.path : `${currentNode.path}/${part}`;
        nextNode = {
          id: isLeaf ? `file:${item.id}` : `folder:${nodePath}`,
          name: part,
          path: nodePath,
          kind: isLeaf ? "file" : "folder",
          file: isLeaf ? item : undefined,
          children: isLeaf ? undefined : [],
        };
        currentNode.children.push(nextNode);
        currentNode.children.sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "folder" ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });
      }
      currentNode = nextNode;
    });
  });

  return Array.from(rootNodes.values());
}

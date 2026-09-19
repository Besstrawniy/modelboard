import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ClipboardPaste, Copy, Database, Eraser, Grid3X3, Hand, LayoutDashboard, MessageSquare, MousePointer2, Network, PenLine, Pencil, Plus, Redo2, Search, Shapes, StickyNote, Trash2, Type, Undo2, UploadCloud, X } from 'lucide-react';
import {
  DEMO_BOARD_ID,
  DEMO_ROLES_DATASET_ID,
  DEMO_USERS_DATASET_ID,
  canEditBoard,
  type AuthSession,
  type BoardDatasetLocation,
  type BoardMeta,
  type CreateDatasetInput,
  type DatasetRelation,
  type DatasetRelationCardinality,
  type DatasetRelationType,
  type DatasetRow,
  type DatasetSnapshot,
  type DeviceKind,
  type FreehandPoint,
  type FreehandStroke,
  type ObjectBindingRecord,
  type VisualTemplateRef,
  type WorkspaceObjectTemplate,
} from '@modelboard/shared';
import { BoardActionsProvider } from './BoardContext';
import { TableNode } from './TableNode';
import { StickyNode } from './StickyNode';
import { TextNode } from './TextNode';
import { ShapeNode } from './ShapeNode';
import { CommentsPanel } from './CommentsPanel';
import { DatasetsPanel } from './DatasetsPanel';
import { CsvImportDialog } from './CsvImportDialog';
import { parseCsvFile, type ParsedCsv } from '../lib/csv';
import { api } from '../lib/api';
import { RelationDialog, type PendingRelation } from './RelationDialog';
import { InspectorPanel } from './InspectorPanel';
import { DatasetSheet } from './DatasetSheet';
import { DeviceNode } from './DeviceNode';
import { DevicePalette } from './DevicePalette';
import { TemplateNode } from './TemplateNode';
import { RelationViewNode } from './RelationViewNode';
import { WorkspaceSearch } from './WorkspaceSearch';

type PresenceState = {
  user?: { id: string; name: string; role: string };
  cursor?: { x: number; y: number } | null;
};

type CsvDropState = {
  parsed: ParsedCsv;
  position: { x: number; y: number };
};

type BoardClipboard = {
  nodes: Node[];
  edges: Edge[];
};

type ToolMode = 'select' | 'hand' | 'pen' | 'eraser';

const USERS_ROLE_ID_COLUMN = '41000000-0000-0000-0000-000000000003';
const ROLES_ID_COLUMN = '42000000-0000-0000-0000-000000000001';
const DEMO_RELATION_ID = '43000000-0000-0000-0000-000000000001';

const nodeTypes: any = {
  table: TableNode,
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  device: DeviceNode,
  template: TemplateNode,
  relationView: RelationViewNode,
};

function freehandPath(points: FreehandPoint[]) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y} l 0.01 0.01`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

function pointDistance(left: FreehandPoint, right: FreehandPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function seedDocument(nodesMap: Y.Map<any>, edgesMap: Y.Map<any>) {
  const usersId = 'seed-users';
  const rolesId = 'seed-roles';
  const stickyId = 'seed-sticky';

  nodesMap.set(usersId, {
    id: usersId,
    type: 'table',
    position: { x: 180, y: 170 },
    style: { width: 520, height: 260 },
    data: { datasetId: DEMO_USERS_DATASET_ID },
  } satisfies Node);

  nodesMap.set(rolesId, {
    id: rolesId,
    type: 'table',
    position: { x: 860, y: 220 },
    style: { width: 430, height: 240 },
    data: { datasetId: DEMO_ROLES_DATASET_ID },
  } satisfies Node);

  nodesMap.set(stickyId, {
    id: stickyId,
    type: 'sticky',
    position: { x: 570, y: 520 },
    style: { width: 260, height: 170 },
    data: {
      text: 'The tables now reference independent datasets. Place users twice from Datasets and edit either copy.',
    },
  } satisfies Node);

  const edgeId = 'seed-users-role-fk';
  edgesMap.set(edgeId, {
    id: edgeId,
    source: usersId,
    target: rolesId,
    sourceHandle: `source:${USERS_ROLE_ID_COLUMN}`,
    targetHandle: `target:${ROLES_ID_COLUMN}`,
    type: 'smoothstep',
    label: 'FK  N:1',
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      relationType: 'FOREIGN_KEY',
      cardinality: 'N:1',
      relationId: DEMO_RELATION_ID,
    },
  } satisfies Edge);
}

function migrateKnownDemoNodes(nodesMap: Y.Map<any>) {
  const users = nodesMap.get('seed-users') as Node | undefined;
  const roles = nodesMap.get('seed-roles') as Node | undefined;

  if (users && !(users.data as any)?.datasetId) {
    nodesMap.set('seed-users', {
      ...users,
      data: { datasetId: DEMO_USERS_DATASET_ID },
    });
  }

  if (roles && !(roles.data as any)?.datasetId) {
    nodesMap.set('seed-roles', {
      ...roles,
      data: { datasetId: DEMO_ROLES_DATASET_ID },
    });
  }
}

function BoardInner({
  meta,
  session,
  boards,
  onSwitchBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
}: {
  meta: BoardMeta;
  session: AuthSession;
  boards: BoardMeta[];
  onSwitchBoard: (boardId: string) => void | Promise<void>;
  onCreateBoard: (name: string) => Promise<void>;
  onRenameBoard: (boardId: string, name: string) => Promise<void>;
  onDeleteBoard: (boardId: string) => Promise<void>;
}) {
  const readOnly = !canEditBoard(meta.role);
  const ydoc = useMemo(() => new Y.Doc(), [meta.id, session.user.id]);
  const nodesMap = useMemo(() => ydoc.getMap<any>('nodes'), [ydoc]);
  const edgesMap = useMemo(() => ydoc.getMap<any>('edges'), [ydoc]);
  const strokesMap = useMemo(
    () => ydoc.getMap<FreehandStroke>('strokes'),
    [ydoc],
  );
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(
        [nodesMap, edgesMap, strokesMap],
        { captureTimeout: 350 },
      ),
    [edgesMap, nodesMap, strokesMap],
  );
  const initialSyncDone = useRef(false);
  const pasteOffsetRef = useRef(0);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [strokes, setStrokes] = useState<FreehandStroke[]>([]);
  const [draftStroke, setDraftStroke] =
    useState<FreehandStroke | null>(null);
  const [penColor, setPenColor] = useState('#344054');
  const [penWidth, setPenWidth] = useState(2.6);
  const erasingRef = useRef(false);
  const [status, setStatus] = useState('connecting');
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [presence, setPresence] = useState<Array<[number, PresenceState]>>([]);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [datasetsOpen, setDatasetsOpen] = useState(false);
  const [csvDrop, setCsvDrop] = useState<CsvDropState | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [dropError, setDropError] = useState('');
  const [pendingRelation, setPendingRelation] = useState<PendingRelation | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<BoardClipboard | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(() =>
    localStorage.getItem('modelboard:snap-to-grid') !== 'false',
  );
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [historyTick, setHistoryTick] = useState(0);
  const [sheetTarget, setSheetTarget] = useState<{
    datasetId: string;
    rowId?: string;
  } | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [workspaceTemplates, setWorkspaceTemplates] =
    useState<WorkspaceObjectTemplate[]>([]);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardBusy, setNewBoardBusy] = useState(false);
  const [newBoardError, setNewBoardError] = useState('');
  const [renameBoardOpen, setRenameBoardOpen] = useState(false);
  const [renameBoardName, setRenameBoardName] = useState('');
  const [boardActionBusy, setBoardActionBusy] = useState(false);
  const [deleteBoardConfirm, setDeleteBoardConfirm] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<{
    location: BoardDatasetLocation;
    rowId?: string;
  } | null>(null);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSheetTarget(null);
    setPendingRelation(null);
    setCommentsOpen(false);
    setDatasetsOpen(false);
    setDevicesOpen(false);
    setBoardMenuOpen(false);
    setToolMode('select');
    setDraftStroke(null);
  }, [meta.id]);

  const refreshWorkspaceTemplates = useCallback(async () => {
    const templates = await api.templates(
      meta.workspaceId,
      session.token,
    );
    setWorkspaceTemplates(templates);
  }, [meta.workspaceId, session.token]);

  useEffect(() => {
    void refreshWorkspaceTemplates().catch((error) =>
      setDropError(
        error instanceof Error ? error.message : String(error),
      ),
    );
  }, [refreshWorkspaceTemplates]);

  useEffect(() => {
    const collabUrl = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:1234';
    const instance = new HocuspocusProvider({
      url: collabUrl,
      name: `board:${meta.id}`,
      document: ydoc,
      token: session.token,
      flushDelay: 40,
      onStatus: ({ status }) => setStatus(status),
      onSynced: () => {
        if (
          !readOnly &&
          meta.id === DEMO_BOARD_ID &&
          nodesMap.size === 0
        ) {
          ydoc.transact(() => seedDocument(nodesMap, edgesMap));
        } else if (
          !readOnly &&
          meta.id === DEMO_BOARD_ID
        ) {
          ydoc.transact(() => migrateKnownDemoNodes(nodesMap));
        }

        if (!initialSyncDone.current) {
          undoManager.clear();
          initialSyncDone.current = true;
          setHistoryTick((value) => value + 1);
        }
      },
      onAwarenessChange: ({ states }) => {
        setPresence(Array.from(states.entries()) as Array<[number, PresenceState]>);
      },
    });

    instance.awareness?.setLocalStateField('user', {
      id: session.user.id,
      name: session.user.displayName,
      role: meta.role,
    });
    setProvider(instance);

    const syncNodes = () =>
      setNodes((current) => {
        const selected = new Set(
          current
            .filter((node) => node.selected)
            .map((node) => node.id),
        );

        return Array.from(nodesMap.values()).map(
          (node: Node) => ({
            ...node,
            selected: selected.has(node.id),
          }),
        );
      });
    const syncEdges = () => setEdges(Array.from(edgesMap.values()));
    const syncStrokes = () =>
      setStrokes(Array.from(strokesMap.values()));
    nodesMap.observe(syncNodes);
    edgesMap.observe(syncEdges);
    strokesMap.observe(syncStrokes);
    syncNodes();
    syncEdges();
    syncStrokes();

    return () => {
      nodesMap.unobserve(syncNodes);
      edgesMap.unobserve(syncEdges);
      strokesMap.unobserve(syncStrokes);
      instance.destroy();
      ydoc.destroy();
    };
  }, [
    edgesMap,
    meta.id,
    meta.role,
    nodesMap,
    readOnly,
    session.token,
    session.user.displayName,
    session.user.id,
    strokesMap,
    undoManager,
    ydoc,
  ]);

  useEffect(() => {
    const refreshHistory = () => setHistoryTick((value) => value + 1);
    undoManager.on('stack-item-added', refreshHistory);
    undoManager.on('stack-item-popped', refreshHistory);
    undoManager.on('stack-cleared', refreshHistory);
    undoManager.on('stack-item-updated', refreshHistory);

    return () => {
      undoManager.off('stack-item-added', refreshHistory);
      undoManager.off('stack-item-popped', refreshHistory);
      undoManager.off('stack-cleared', refreshHistory);
      undoManager.off('stack-item-updated', refreshHistory);
    };
  }, [undoManager]);

  void historyTick;
  const canUndo = undoManager.undoStack.length > 0;
  const canRedo = undoManager.redoStack.length > 0;

  useEffect(() => {
    localStorage.setItem(
      'modelboard:snap-to-grid',
      String(snapToGrid),
    );
  }, [snapToGrid]);

  const clearSelection = useCallback(() => {
    setNodes((current) =>
      current.map((node) =>
        node.selected
          ? { ...node, selected: false }
          : node,
      ),
    );
    setSelectedNodeIds([]);
    setSelectedNodeId(null);
  }, []);

  const copySelection = useCallback(() => {
    if (selectedNodeIds.length === 0) return;

    const selected = new Set(selectedNodeIds);
    const sourceNodes = nodes
      .filter((node) => selected.has(node.id))
      .map((node) => {
        const copy = structuredClone(node);
        copy.selected = false;
        return copy;
      });

    const sourceEdges = edges
      .filter(
        (edge) =>
          selected.has(edge.source) &&
          selected.has(edge.target),
      )
      .map((edge) => structuredClone(edge));

    if (sourceNodes.length === 0) return;

    setClipboard({
      nodes: sourceNodes,
      edges: sourceEdges,
    });
    pasteOffsetRef.current = 0;
  }, [edges, nodes, selectedNodeIds]);

  const cloneToBoard = useCallback(
    async (
      sourceNodes: Node[],
      sourceEdges: Edge[],
      offset: number,
    ) => {
      if (readOnly || sourceNodes.length === 0) {
        return [] as string[];
      }

      const idMap = new Map<string, string>();
      for (const source of sourceNodes) {
        idMap.set(source.id, crypto.randomUUID());
      }

      const clonedNodes = await Promise.all(
        sourceNodes.map(async (source) => {
          const id = idMap.get(source.id)!;
          const data = structuredClone(
            (source.data ?? {}) as Record<string, any>,
          );

          delete data.generatedFrom;

          if (data.parentNodeId) {
            data.parentNodeId =
              idMap.get(String(data.parentNodeId)) ??
              undefined;
          }

          const oldBinding =
            data.binding as ObjectBindingRecord | undefined;

          if (oldBinding) {
            const binding = await api.upsertObjectBinding(
              meta.id,
              id,
              session.token,
              {
                type: oldBinding.type,
                datasetId: oldBinding.datasetId,
                rowId: oldBinding.rowId,
                columnId: oldBinding.columnId,
                relationPath: oldBinding.relationPath,
                presentation: oldBinding.presentation,
              },
            );

            data.binding = binding;
          }

          const clone = structuredClone(source);
          clone.id = id;
          clone.position = {
            x: source.position.x + offset,
            y: source.position.y + offset,
          };
          clone.data = data;
          clone.selected = false;

          return clone;
        }),
      );

      const clonedEdges = sourceEdges.map((source) => {
        const clone = structuredClone(source);
        clone.id = crypto.randomUUID();
        clone.source =
          idMap.get(source.source) ?? source.source;
        clone.target =
          idMap.get(source.target) ?? source.target;
        clone.selected = false;
        return clone;
      });

      ydoc.transact(() => {
        for (const node of clonedNodes) {
          const persisted = {
            ...node,
            selected: undefined,
          } as Node;
          nodesMap.set(node.id, persisted);
        }

        for (const edge of clonedEdges) {
          edgesMap.set(edge.id, edge);
        }
      });

      const ids = clonedNodes.map((node) => node.id);

      requestAnimationFrame(() => {
        setNodes((current) =>
          current.map((node) => ({
            ...node,
            selected: ids.includes(node.id),
          })),
        );
        setSelectedNodeIds(ids);
        setSelectedNodeId(
          ids.length === 1 ? ids[0] : null,
        );
      });

      return ids;
    },
    [
      edgesMap,
      meta.id,
      nodesMap,
      readOnly,
      session.token,
      ydoc,
    ],
  );

  const pasteClipboard = useCallback(async () => {
    if (!clipboard || readOnly) return;

    pasteOffsetRef.current += 1;
    const offset = 28 + pasteOffsetRef.current * 12;

    await cloneToBoard(
      clipboard.nodes,
      clipboard.edges,
      offset,
    );
  }, [clipboard, cloneToBoard, readOnly]);

  const duplicateSelection = useCallback(async () => {
    if (readOnly || selectedNodeIds.length === 0) {
      return;
    }

    const selected = new Set(selectedNodeIds);
    const sourceNodes = nodes.filter((node) =>
      selected.has(node.id),
    );
    const sourceEdges = edges.filter(
      (edge) =>
        selected.has(edge.source) &&
        selected.has(edge.target),
    );

    await cloneToBoard(
      sourceNodes,
      sourceEdges,
      32,
    );
  }, [
    cloneToBoard,
    edges,
    nodes,
    readOnly,
    selectedNodeIds,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (typing) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'k') {
        event.preventDefault();
        setWorkspaceSearchOpen(true);
        return;
      }

      if (!readOnly && mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) undoManager.redo();
        else undoManager.undo();
        return;
      }

      if (!readOnly && mod && key === 'y') {
        event.preventDefault();
        undoManager.redo();
        return;
      }

      if (mod && key === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }

      if (!readOnly && mod && key === 'v') {
        event.preventDefault();
        void pasteClipboard();
        return;
      }

      if (!readOnly && mod && key === 'd') {
        event.preventDefault();
        void duplicateSelection();
        return;
      }

      if (mod && key === 'a') {
        event.preventDefault();
        const ids = nodes.map((node) => node.id);
        setNodes((current) =>
          current.map((node) => ({
            ...node,
            selected: true,
          })),
        );
        setSelectedNodeIds(ids);
        setSelectedNodeId(
          ids.length === 1 ? ids[0] : null,
        );
        return;
      }

      if (event.key === 'Escape') {
        clearSelection();
        setPendingRelation(null);
        setToolMode('select');
      }

      if (event.key === 'v') setToolMode('select');
      if (event.key === 'h') setToolMode('hand');
      if (!readOnly && event.key === 'p') {
        setSelectedNodeId(null);
        setToolMode('pen');
      }
      if (!readOnly && event.key === 'e') {
        setSelectedNodeId(null);
        setToolMode('eraser');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clearSelection,
    copySelection,
    duplicateSelection,
    nodes,
    pasteClipboard,
    readOnly,
    undoManager,
  ]);

  const persistNodeChanges = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const changedIds = new Set(changes.map((change: any) => change.id).filter(Boolean));
      ydoc.transact(() => {
        for (const change of changes as any[]) {
          if (change.type === 'remove') nodesMap.delete(change.id);
          if (change.type === 'add') nodesMap.set(change.item.id, change.item);
        }
        for (const id of changedIds) {
          const change = changes.find((entry: any) => entry.id === id) as any;
          if (change?.type === 'select' || change?.type === 'remove') continue;
          const node = next.find((entry) => entry.id === id);
          if (node) nodesMap.set(id, node);
        }
      });
      return next;
    });
  }, [nodesMap, ydoc]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (readOnly) {
      setNodes((current) => applyNodeChanges(changes.filter((c: any) => c.type === 'select'), current));
      return;
    }

    for (const change of changes as any[]) {
      if (change.type !== 'remove') continue;
      const removedNode = nodesMap.get(change.id) as Node | undefined;
      if ((removedNode?.data as any)?.binding) {
        void api
          .deleteObjectBinding(meta.id, change.id, session.token)
          .catch((error) =>
            console.error('Failed to delete object binding', error),
          );
      }
    }

    persistNodeChanges(changes);
  }, [
    meta.id,
    nodesMap,
    persistNodeChanges,
    readOnly,
    session.token,
  ]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (readOnly) return;
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      ydoc.transact(() => {
        for (const change of changes as any[]) {
          if (change.type === 'remove') edgesMap.delete(change.id);
          if (change.type === 'add') edgesMap.set(change.item.id, change.item);
        }
      });
      return next;
    });
  }, [edgesMap, readOnly, ydoc]);

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly) return;
    if (!connection.source || !connection.target) return;

    const sourceNode = nodesMap.get(connection.source) as Node | undefined;
    const targetNode = nodesMap.get(connection.target) as Node | undefined;
    const sourceDatasetId = (sourceNode?.data as any)?.datasetId as string | undefined;
    const targetDatasetId = (targetNode?.data as any)?.datasetId as string | undefined;
    const sourceColumnId = connection.sourceHandle?.replace(/^source:/, '');
    const targetColumnId = connection.targetHandle?.replace(/^target:/, '');

    if (
      sourceNode?.type === 'table' &&
      targetNode?.type === 'table' &&
      sourceDatasetId &&
      targetDatasetId &&
      sourceColumnId &&
      targetColumnId
    ) {
      setPendingRelation({
        connection,
        sourceDatasetId,
        sourceColumnId,
        targetDatasetId,
        targetColumnId,
      });
      return;
    }

    const edge: Edge = {
      ...connection,
      id: crypto.randomUUID(),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { relationType: 'VISUAL' },
    };
    setEdges((current) => addEdge(edge, current));
    edgesMap.set(edge.id, edge);
  }, [edgesMap, nodesMap, readOnly]);

  const confirmRelation = useCallback(async (
    relationType: DatasetRelationType,
    cardinality: DatasetRelationCardinality | null,
  ) => {
    if (!pendingRelation) return;

    const relation = await api.createRelation(meta.workspaceId, session.token, {
      sourceDatasetId: pendingRelation.sourceDatasetId,
      sourceColumnId: pendingRelation.sourceColumnId,
      targetDatasetId: pendingRelation.targetDatasetId,
      targetColumnId: pendingRelation.targetColumnId,
      relationType,
      cardinality,
    });

    const edge: Edge = {
      ...pendingRelation.connection,
      id: crypto.randomUUID(),
      type: 'smoothstep',
      label: cardinality
        ? `${relationType === 'FOREIGN_KEY' ? 'FK' : relationType}  ${cardinality}`
        : relationType === 'FOREIGN_KEY'
          ? 'FK'
          : relationType,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        relationId: relation.id,
        relationType,
        cardinality,
      },
    };

    setEdges((current) => addEdge(edge, current));
    edgesMap.set(edge.id, edge);
    setPendingRelation(null);
  }, [edgesMap, meta.workspaceId, pendingRelation, session.token]);

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    if (readOnly) return;
    const current = nodesMap.get(nodeId) as Node | undefined;
    if (!current) return;
    nodesMap.set(nodeId, { ...current, data: { ...(current.data as any), ...patch } });
  }, [nodesMap, readOnly]);

  const materializeRelated = useCallback(async ({
    parentNodeId,
    relation,
    dataset,
    rows,
    visualTemplate,
  }: {
    parentNodeId: string;
    relation: DatasetRelation;
    dataset: DatasetSnapshot;
    rows: DatasetRow[];
    visualTemplate?: VisualTemplateRef;
  }) => {
    if (readOnly) return 0;

    const parent = nodesMap.get(parentNodeId) as Node | undefined;
    if (!parent) return 0;

    const limitedRows = rows.slice(0, 20);
    const titleCandidates = ['hostname', 'name', 'title', 'label', 'service'];
    const subtitleCandidates = ['ip', 'ip_address', 'address', 'port', 'status'];

    const byNames = (candidates: string[]) =>
      dataset.columns.find((column) =>
        candidates.includes(column.name.trim().toLowerCase()),
      )?.id;

    const titleColumnId =
      byNames(titleCandidates) ??
      dataset.columns.find((column) => !/^(id|.*_id)$/i.test(column.name))?.id ??
      dataset.columns[0]?.id;

    const subtitleColumnId =
      byNames(subtitleCandidates) ??
      dataset.columns.find((column) => column.id !== titleColumnId)?.id;

    const columnsPerBand = 6;
    const createdNodes: Node[] = [];
    const createdEdges: Edge[] = [];

    for (let index = 0; index < limitedRows.length; index += 1) {
      const row = limitedRows[index];
      const childId = `related:${parentNodeId}:${relation.id}:${row.id}`;
      const edgeId = `related-edge:${parentNodeId}:${relation.id}:${row.id}`;

      if (nodesMap.has(childId)) {
        continue;
      }

      const binding = await api.upsertObjectBinding(
        meta.id,
        childId,
        session.token,
        {
          type: 'ROW',
          datasetId: dataset.id,
          rowId: row.id,
          presentation: {
            ...(titleColumnId ? { titleColumnId } : {}),
            ...(subtitleColumnId && subtitleColumnId !== titleColumnId
              ? { subtitleColumnId }
              : {}),
          },
        },
      );

      const columnIndex = Math.floor(index / columnsPerBand);
      const rowIndex = index % columnsPerBand;
      const rowsInColumn = Math.min(
        columnsPerBand,
        limitedRows.length - columnIndex * columnsPerBand,
      );
      const verticalOffset = (rowIndex - (rowsInColumn - 1) / 2) * 138;

      const inferredKind: DeviceKind =
        /(^|[_\s-])(vm|machine|virtual)([_\s-]|$)/i.test(dataset.name)
          ? 'VM'
          : /server|host/i.test(dataset.name)
            ? 'SERVER'
            : /database|db|postgres|mysql|sql/i.test(dataset.name)
              ? 'DATABASE'
              : /firewall|fw/i.test(dataset.name)
                ? 'FIREWALL'
                : /switch/i.test(dataset.name)
                  ? 'SWITCH'
                  : /router|gateway/i.test(dataset.name)
                    ? 'ROUTER'
                    : 'VM';

      const templateRef = visualTemplate ?? {
        source: 'BUILTIN' as const,
        deviceKind: inferredKind,
      };

      const generatedFrom = {
        parentNodeId,
        relationId: relation.id,
        rowId: row.id,
      };

      if (templateRef.source === 'WORKSPACE') {
        const template = workspaceTemplates.find(
          (item) => item.id === templateRef.templateId,
        );

        if (!template) {
          throw new Error('Workspace SVG template not found');
        }

        createdNodes.push({
          id: childId,
          type: 'template',
          position: {
            x: parent.position.x + 330 + columnIndex * 270,
            y: parent.position.y + verticalOffset,
          },
          style: {
            width: template.defaultWidth,
            height: Math.max(100, template.defaultHeight + 54),
          },
          data: {
            templateId: template.id,
            binding,
            generatedFrom,
          },
        });
      } else {
        createdNodes.push({
          id: childId,
          type: 'device',
          position: {
            x: parent.position.x + 330 + columnIndex * 270,
            y: parent.position.y + verticalOffset,
          },
          style: { width: 220, height: 130 },
          data: {
            deviceKind: templateRef.deviceKind,
            binding,
            generatedFrom,
          },
        });
      }

      if (!edgesMap.has(edgeId)) {
        createdEdges.push({
          id: edgeId,
          source: parentNodeId,
          target: childId,
          type: 'smoothstep',
          label: relation.cardinality
            ? `${relation.relationType === 'FOREIGN_KEY' ? 'FK' : relation.relationType}  ${relation.cardinality}`
            : relation.relationType,
          markerEnd: { type: MarkerType.ArrowClosed },
          data: {
            relationId: relation.id,
            relationType: relation.relationType,
            cardinality: relation.cardinality ?? null,
            generated: true,
          },
        });
      }
    }

    if (createdNodes.length === 0) {
      return 0;
    }

    ydoc.transact(() => {
      for (const node of createdNodes) {
        nodesMap.set(node.id, node);
      }
      for (const edge of createdEdges) {
        edgesMap.set(edge.id, edge);
      }
    });

    return createdNodes.length;
  }, [
    edgesMap,
    meta.id,
    nodesMap,
    readOnly,
    session.token,
    workspaceTemplates,
    ydoc,
  ]);

  const createRelationView = useCallback(async ({
    parentNodeId,
    relation,
    dataset,
    row,
  }: {
    parentNodeId: string;
    relation: DatasetRelation;
    dataset: DatasetSnapshot;
    row: DatasetRow;
  }) => {
    if (readOnly) return false;

    const parent = nodesMap.get(parentNodeId) as Node | undefined;
    if (!parent) return false;

    const nodeId = `relation-view:${parentNodeId}:${relation.id}`;
    if (nodesMap.has(nodeId)) return false;

    const binding = await api.upsertObjectBinding(
      meta.id,
      nodeId,
      session.token,
      {
        type: 'RELATION_VIEW',
        datasetId: dataset.id,
        rowId: row.id,
        relationPath: [relation.id],
        presentation: {
          maxRows: 8,
        },
      },
    );

    const node: Node = {
      id: nodeId,
      type: 'relationView',
      position: {
        x: parent.position.x + 60,
        y: parent.position.y + 220,
      },
      style: {
        width: 360,
        height: 290,
      },
      data: {
        relationId: relation.id,
        parentNodeId,
        binding,
      },
    };

    const edgeId = `relation-view-edge:${parentNodeId}:${relation.id}`;
    const edge: Edge = {
      id: edgeId,
      source: parentNodeId,
      target: nodeId,
      type: 'smoothstep',
      label: 'RELATION VIEW',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        strokeDasharray: '6 4',
      },
      data: {
        relationId: relation.id,
        relationType: relation.relationType,
        generated: true,
        relationView: true,
      },
    };

    ydoc.transact(() => {
      nodesMap.set(node.id, node);
      edgesMap.set(edge.id, edge);
    });

    setSelectedNodeId(nodeId);
    return true;
  }, [
    edgesMap,
    meta.id,
    nodesMap,
    readOnly,
    session.token,
    ydoc,
  ]);

  const materializedRelatedCount = useCallback((
    parentNodeId: string,
    relationId: string,
  ) => {
    let count = 0;

    for (const node of nodesMap.values() as Iterable<Node>) {
      const generatedFrom = (node.data as any)?.generatedFrom;
      if (
        generatedFrom?.parentNodeId === parentNodeId &&
        generatedFrom?.relationId === relationId
      ) {
        count += 1;
      }
    }

    return count;
  }, [nodesMap]);

  const hideMaterializedRelated = useCallback(async (
    parentNodeId: string,
    relationId: string,
  ) => {
    if (readOnly) return 0;

    const childIds: string[] = [];

    for (const node of nodesMap.values() as Iterable<Node>) {
      const generatedFrom = (node.data as any)?.generatedFrom;
      if (
        generatedFrom?.parentNodeId === parentNodeId &&
        generatedFrom?.relationId === relationId
      ) {
        childIds.push(node.id);
      }
    }

    if (childIds.length === 0) return 0;

    const childSet = new Set(childIds);

    await Promise.all(
      childIds.map((childId) =>
        api.deleteObjectBinding(
          meta.id,
          childId,
          session.token,
        ),
      ),
    );

    ydoc.transact(() => {
      for (const childId of childIds) {
        nodesMap.delete(childId);
      }

      for (const edge of edgesMap.values() as Iterable<Edge>) {
        const generated = (edge.data as any)?.generated;
        const edgeRelationId = (edge.data as any)?.relationId;

        if (
          generated &&
          edgeRelationId === relationId &&
          edge.source === parentNodeId &&
          childSet.has(edge.target)
        ) {
          edgesMap.delete(edge.id);
        }
      }
    });

    return childIds.length;
  }, [
    edgesMap,
    meta.id,
    nodesMap,
    readOnly,
    session.token,
    ydoc,
  ]);

  const viewportCenter = useCallback(() => {
    if (!rf) return { x: 360, y: 220 };
    return rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  }, [rf]);

  const placeDataset = useCallback((
    datasetId: string,
    position?: { x: number; y: number },
  ) => {
    if (readOnly) return;
    const id = crypto.randomUUID();
    const center = position ?? viewportCenter();
    nodesMap.set(id, {
      id,
      type: 'table',
      position: { x: center.x - 310, y: center.y - 150 },
      style: { width: 620, height: 300 },
      data: { datasetId },
    } satisfies Node);
  }, [nodesMap, readOnly, viewportCenter]);

  const addNode = useCallback((type: string) => {
    if (readOnly) return;
    const id = crypto.randomUUID();
    const center = viewportCenter();

    let node: Node;

    if (type === 'sticky') {
      node = {
        id,
        type,
        position: { x: center.x - 120, y: center.y - 80 },
        style: { width: 240, height: 160 },
        data: { text: 'Новая заметка' },
      };
    } else if (type === 'shape') {
      node = {
        id,
        type,
        position: { x: center.x - 110, y: center.y - 55 },
        style: { width: 220, height: 110 },
        data: { text: 'Объект' },
      };
    } else {
      node = {
        id,
        type,
        position: { x: center.x - 80, y: center.y - 20 },
        data: { text: 'Текст' },
      };
    }

    nodesMap.set(id, node);
    setSelectedNodeId(id);
    setToolMode('select');
  }, [nodesMap, readOnly, viewportCenter]);

  const addDevice = useCallback((kind: DeviceKind) => {
    if (readOnly) return;

    const id = crypto.randomUUID();
    const center = viewportCenter();

    nodesMap.set(id, {
      id,
      type: 'device',
      position: {
        x: center.x - 110,
        y: center.y - 65,
      },
      style: { width: 220, height: 130 },
      data: {
        deviceKind: kind,
        label: '',
      },
    } satisfies Node);

    setSelectedNodeId(id);
    setDevicesOpen(false);
    setToolMode('select');
  }, [nodesMap, readOnly, viewportCenter]);

  const addTemplateNode = useCallback((templateId: string) => {
    if (readOnly) return;

    const template = workspaceTemplates.find(
      (item) => item.id === templateId,
    );
    if (!template) return;

    const id = crypto.randomUUID();
    const center = viewportCenter();

    nodesMap.set(id, {
      id,
      type: 'template',
      position: {
        x: center.x - template.defaultWidth / 2,
        y: center.y - Math.max(100, template.defaultHeight + 54) / 2,
      },
      style: {
        width: template.defaultWidth,
        height: Math.max(100, template.defaultHeight + 54),
      },
      data: {
        templateId: template.id,
        label: template.name,
      },
    } satisfies Node);

    setSelectedNodeId(id);
    setDevicesOpen(false);
    setToolMode('select');
  }, [
    nodesMap,
    readOnly,
    viewportCenter,
    workspaceTemplates,
  ]);

  const beginFreehand = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly || toolMode !== 'pen' || !rf) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = rf.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      setDraftStroke({
        id: crypto.randomUUID(),
        points: [point],
        width: penWidth,
        color: penColor,
        createdBy: session.user.id,
      });
    },
    [
      penColor,
      penWidth,
      readOnly,
      rf,
      session.user.id,
      toolMode,
    ],
  );

  const moveFreehand = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (toolMode !== 'pen' || !rf) return;

      const point = rf.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      setDraftStroke((current) => {
        if (!current) return current;
        const previous = current.points[current.points.length - 1];
        if (previous && pointDistance(previous, point) < 1.8) {
          return current;
        }

        return {
          ...current,
          points: [...current.points, point],
        };
      });
    },
    [rf, toolMode],
  );

  const finishFreehand = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (toolMode !== 'pen') return;

      setDraftStroke((current) => {
        if (current && current.points.length > 1) {
          strokesMap.set(current.id, current);
        }
        return null;
      });

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [strokesMap, toolMode],
  );

  const eraseAtPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!rf) return;

      const point = rf.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      let closestId: string | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const stroke of strokesMap.values()) {
        for (const strokePoint of stroke.points) {
          const distance = pointDistance(strokePoint, point);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestId = stroke.id;
          }
        }
      }

      if (closestId && closestDistance <= 10) {
        strokesMap.delete(closestId);
      }
    },
    [rf, strokesMap],
  );

  const beginErase = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly || toolMode !== 'eraser') return;

      event.preventDefault();
      erasingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      eraseAtPointer(event);
    },
    [eraseAtPointer, readOnly, toolMode],
  );

  const moveErase = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        toolMode !== 'eraser' ||
        !erasingRef.current
      ) {
        return;
      }
      eraseAtPointer(event);
    },
    [eraseAtPointer, toolMode],
  );

  const finishErase = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      erasingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!provider || !rf) return;
    const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    provider.awareness?.setLocalStateField('cursor', point);
  }, [provider, rf]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }, [readOnly]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) return;

    event.preventDefault();
    setDropActive(false);
    setDropError('');

    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      setDropError('Drop exactly one CSV file at a time.');
      return;
    }

    const position = rf?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    }) ?? { x: 320, y: 220 };

    try {
      const parsed = await parseCsvFile(files[0]);
      setCsvDrop({ parsed, position });
    } catch (error) {
      setDropError(error instanceof Error ? error.message : String(error));
    }
  }, [readOnly, rf]);

  const importCsv = useCallback(async (input: CreateDatasetInput) => {
    if (!csvDrop) return;

    const dataset = await api.createDataset(
      meta.workspaceId,
      session.token,
      input,
    );

    placeDataset(dataset.id, csvDrop.position);
    setCsvDrop(null);
  }, [csvDrop, meta.workspaceId, placeDataset, session.token]);

  const navigateToDatasetLocation = useCallback(
    async (
      location: BoardDatasetLocation,
      rowId?: string,
    ) => {
      setNavigationTarget({ location, rowId });
      setSheetTarget(null);
      setBoardMenuOpen(false);

      if (location.boardId !== meta.id) {
        await onSwitchBoard(location.boardId);
      }
    },
    [meta.id, onSwitchBoard],
  );

  useEffect(() => {
    if (
      !navigationTarget ||
      navigationTarget.location.boardId !== meta.id ||
      !rf
    ) {
      return;
    }

    const node = nodes.find(
      (item) =>
        item.id === navigationTarget.location.objectId,
    );

    if (!node) return;

    const nodeId = node.id;

    setNodes((current) =>
      current.map((item) => ({
        ...item,
        selected: item.id === nodeId,
      })),
    );
    setSelectedNodeIds([nodeId]);
    setSelectedNodeId(nodeId);
    setToolMode('select');

    void rf.fitView({
      nodes: [node],
      padding: 0.35,
      duration: 450,
    });

    if (navigationTarget.rowId) {
      setSheetTarget({
        datasetId:
          navigationTarget.location.datasetId,
        rowId: navigationTarget.rowId,
      });
    }

    setNavigationTarget(null);
  }, [
    meta.id,
    navigationTarget,
    nodes,
    rf,
  ]);

  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;

  const remotePresence = presence.filter(([clientId, state]) =>
    clientId !== ydoc.clientID && state.user,
  );

  return (
    <BoardActionsProvider
      value={{
        readOnly,
        sessionToken: session.token,
        boardId: meta.id,
        workspaceId: meta.workspaceId,
        workspaceTemplates,
        refreshWorkspaceTemplates,
        updateNodeData,
        materializeRelated,
        createRelationView,
        hideMaterializedRelated,
        materializedRelatedCount,
        openDatasetSheet: (datasetId, rowId) =>
          setSheetTarget({ datasetId, rowId }),
        navigateToDatasetLocation,
      }}
    >
      <div
        className="board-shell"
        onPointerMove={onPointerMove}
        onPointerLeave={() => provider?.awareness?.setLocalStateField('cursor', null)}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        <header className="topbar">
          <div className="brand"><span className="brand-mark">M</span> ModelBoard</div>

          <div className="board-switcher">
            <button
              className="board-switcher__trigger"
              onClick={() => {
                setBoardMenuOpen((value) => !value);
                setNewBoardOpen(false);
                setNewBoardError('');
              }}
            >
              <LayoutDashboard size={15} />
              <span>
                <strong>{meta.name}</strong>
                <small>{meta.workspaceName}</small>
              </span>
              <ChevronDown size={14} />
            </button>

            {boardMenuOpen && (
              <div className="board-switcher__menu">
                <div className="board-switcher__menu-title">
                  Доски Workspace
                </div>

                <div className="board-switcher__list">
                  {boards.map((board) => (
                    <button
                      key={board.id}
                      className={
                        board.id === meta.id ? 'is-active' : ''
                      }
                      onClick={() => {
                        setBoardMenuOpen(false);
                        void onSwitchBoard(board.id);
                      }}
                    >
                      <LayoutDashboard size={14} />
                      <span>{board.name}</span>
                    </button>
                  ))}
                </div>

                {!readOnly && (
                  <div className="board-switcher__create">
                    {!newBoardOpen ? (
                      <button
                        onClick={() => {
                          setNewBoardOpen(true);
                          setNewBoardName('');
                          setNewBoardError('');
                        }}
                      >
                        <Plus size={14} />
                        Новая доска
                      </button>
                    ) : (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const name = newBoardName.trim();
                          if (!name || newBoardBusy) return;

                          setNewBoardBusy(true);
                          setNewBoardError('');
                          void onCreateBoard(name)
                            .then(() => {
                              setBoardMenuOpen(false);
                              setNewBoardOpen(false);
                              setNewBoardName('');
                            })
                            .catch((error) =>
                              setNewBoardError(
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                              ),
                            )
                            .finally(() => setNewBoardBusy(false));
                        }}
                      >
                        <input
                          autoFocus
                          maxLength={120}
                          value={newBoardName}
                          placeholder="Название доски"
                          onChange={(event) =>
                            setNewBoardName(event.target.value)
                          }
                        />
                        <button
                          type="submit"
                          disabled={!newBoardName.trim() || newBoardBusy}
                        >
                          <Plus size={14} />
                        </button>
                      </form>
                    )}

                    {newBoardError && (
                      <div className="board-switcher__error">
                        {newBoardError}
                      </div>
                    )}
                  </div>
                )}

                {!readOnly && (
                  <div className="board-switcher__manage">
                    {!renameBoardOpen ? (
                      <button
                        disabled={boardActionBusy}
                        onClick={() => {
                          setRenameBoardOpen(true);
                          setRenameBoardName(meta.name);
                          setDeleteBoardConfirm(false);
                          setNewBoardError('');
                        }}
                      >
                        <Pencil size={13} />
                        Переименовать текущую
                      </button>
                    ) : (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const name = renameBoardName.trim();
                          if (!name || boardActionBusy) return;

                          setBoardActionBusy(true);
                          setNewBoardError('');
                          void onRenameBoard(meta.id, name)
                            .then(() => {
                              setRenameBoardOpen(false);
                              setRenameBoardName('');
                            })
                            .catch((error) =>
                              setNewBoardError(
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                              ),
                            )
                            .finally(() => setBoardActionBusy(false));
                        }}
                      >
                        <input
                          autoFocus
                          maxLength={120}
                          value={renameBoardName}
                          onChange={(event) =>
                            setRenameBoardName(event.target.value)
                          }
                        />
                        <button
                          type="submit"
                          disabled={
                            !renameBoardName.trim() ||
                            boardActionBusy
                          }
                        >
                          <Pencil size={13} />
                        </button>
                      </form>
                    )}

                    {meta.role === 'OWNER' && boards.length > 1 && (
                      <button
                        className={deleteBoardConfirm ? 'is-danger-confirm' : 'is-danger'}
                        disabled={boardActionBusy}
                        onClick={() => {
                          if (!deleteBoardConfirm) {
                            setDeleteBoardConfirm(true);
                            setRenameBoardOpen(false);
                            return;
                          }

                          setBoardActionBusy(true);
                          setNewBoardError('');
                          void onDeleteBoard(meta.id)
                            .then(() => {
                              setBoardMenuOpen(false);
                              setDeleteBoardConfirm(false);
                            })
                            .catch((error) =>
                              setNewBoardError(
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                              ),
                            )
                            .finally(() => setBoardActionBusy(false));
                        }}
                      >
                        <Trash2 size={13} />
                        {deleteBoardConfirm
                          ? 'Подтвердить удаление'
                          : 'Удалить текущую'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="presence-strip">
            <button
              className="global-search-trigger"
              onClick={() => setWorkspaceSearchOpen(true)}
              title="Поиск по Workspace (Ctrl+K)"
            >
              <Search size={14} />
              <span>Поиск</span>
              <kbd>Ctrl K</kbd>
            </button>

            {remotePresence.slice(0, 5).map(([clientId, state]) => (
              <span className="avatar" key={clientId} title={`${state.user?.name} · ${state.user?.role}`}>
                {state.user?.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            <span className={`connection-status connection-status--${status}`}>{status}</span>
            <span className="role-pill">{meta.role}</span>
          </div>
        </header>

        <ReactFlow
          className={`canvas-flow canvas-flow--${toolMode}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setRf}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => {
            if (node.type !== 'table') return;
            const datasetId = (node.data as any)?.datasetId as string | undefined;
            if (datasetId) setSheetTarget({ datasetId });
          }}
          onSelectionChange={({ nodes: selectedNodes }) => {
            const ids = selectedNodes.map((node) => node.id);
            setSelectedNodeIds(ids);
            setSelectedNodeId(
              ids.length === 1 ? ids[0] : null,
            );
          }}
          onPaneClick={clearSelection}
          nodesDraggable={!readOnly && toolMode === 'select'}
          nodesConnectable={!readOnly && toolMode === 'select'}
          elementsSelectable={toolMode === 'select'}
          deleteKeyCode={readOnly || toolMode !== 'select' ? null : ['Backspace', 'Delete']}
          fitView
          snapToGrid={snapToGrid}
          snapGrid={[22, 22]}
          panOnScroll
          selectionOnDrag={toolMode === 'select'}
          panOnDrag={toolMode === 'hand' ? true : [1, 2]}
          minZoom={0.15}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <Controls />
          <MiniMap pannable zoomable />

          <Panel position="center-left" className="toolbar-panel">
            <div className="toolbar">
              <button
                className={toolMode === 'select' ? 'is-active' : ''}
                title="Выбор (V)"
                onClick={() => setToolMode('select')}
              >
                <MousePointer2 size={19} />
              </button>
              <button
                className={toolMode === 'hand' ? 'is-active' : ''}
                title="Рука / перемещение canvas (H)"
                onClick={() => {
                  clearSelection();
                  setToolMode('hand');
                }}
              >
                <Hand size={19} />
              </button>
              <button
                className={toolMode === 'pen' ? 'is-active' : ''}
                disabled={readOnly}
                title="Перо / свободное рисование (P)"
                onClick={() => {
                  clearSelection();
                  setToolMode('pen');
                }}
              >
                <PenLine size={19} />
              </button>
              <button
                className={toolMode === 'eraser' ? 'is-active' : ''}
                disabled={readOnly}
                title="Ластик для рисунков (E)"
                onClick={() => {
                  clearSelection();
                  setToolMode('eraser');
                }}
              >
                <Eraser size={19} />
              </button>
              <div className="toolbar-separator" />
              <button
                title="Отменить (Ctrl+Z)"
                disabled={readOnly || !canUndo}
                onClick={() => undoManager.undo()}
              >
                <Undo2 size={18} />
              </button>
              <button
                title="Повторить (Ctrl+Y / Ctrl+Shift+Z)"
                disabled={readOnly || !canRedo}
                onClick={() => undoManager.redo()}
              >
                <Redo2 size={18} />
              </button>
              <button
                title="Копировать (Ctrl+C)"
                disabled={selectedNodeIds.length === 0}
                onClick={copySelection}
              >
                <Copy size={17} />
              </button>
              <button
                title="Вставить (Ctrl+V)"
                disabled={readOnly || !clipboard}
                onClick={() => void pasteClipboard()}
              >
                <ClipboardPaste size={17} />
              </button>
              <button
                className={snapToGrid ? 'is-active' : ''}
                title="Привязка к сетке"
                onClick={() =>
                  setSnapToGrid((value) => !value)
                }
              >
                <Grid3X3 size={17} />
              </button>
              <div className="toolbar-separator" />
              <button onClick={() => setDatasetsOpen(true)} title="Данные"><Database size={19} /></button>
              <button onClick={() => setDevicesOpen(true)} title="Инфраструктура"><Network size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('sticky')} title="Стикер"><StickyNote size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('text')} title="Текст"><Type size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('shape')} title="Фигура"><Shapes size={19} /></button>
              <div className="toolbar-separator" />
              <button onClick={() => setCommentsOpen(true)} title="Комментарии"><MessageSquare size={19} /></button>
            </div>
          </Panel>

          <ViewportPortal>
            <svg
              className="freehand-layer"
              aria-hidden="true"
            >
              {[...strokes, ...(draftStroke ? [draftStroke] : [])].map(
                (stroke) => (
                  <path
                    key={stroke.id}
                    d={freehandPath(stroke.points)}
                    fill="none"
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ),
              )}
            </svg>

            {remotePresence.map(([clientId, state]) => state.cursor ? (
              <div
                key={clientId}
                className="remote-cursor"
                style={{ transform: `translate(${state.cursor.x}px, ${state.cursor.y}px)` }}
              >
                <svg width="18" height="24" viewBox="0 0 18 24" aria-hidden="true">
                  <path d="M2 1L16 14H9L6 22L2 1Z" fill="currentColor" stroke="white" strokeWidth="1.5" />
                </svg>
                <span>{state.user?.name}</span>
              </div>
            ) : null)}
          </ViewportPortal>
        </ReactFlow>

        {(toolMode === 'pen' || toolMode === 'eraser') && !readOnly && (
          <div
            className={`freehand-capture freehand-capture--${toolMode}`}
            onPointerDown={
              toolMode === 'pen' ? beginFreehand : beginErase
            }
            onPointerMove={
              toolMode === 'pen' ? moveFreehand : moveErase
            }
            onPointerUp={
              toolMode === 'pen' ? finishFreehand : finishErase
            }
            onPointerCancel={
              toolMode === 'pen' ? finishFreehand : finishErase
            }
          />
        )}

        {(toolMode === 'pen' || toolMode === 'eraser') && !readOnly && (
          <div className="freehand-options">
            <div className="freehand-options__mode">
              {toolMode === 'pen' ? (
                <PenLine size={14} />
              ) : (
                <Eraser size={14} />
              )}
              <strong>
                {toolMode === 'pen' ? 'Перо' : 'Ластик'}
              </strong>
            </div>

            <label title="Цвет пера">
              <span>Цвет</span>
              <input
                type="color"
                value={penColor}
                disabled={toolMode !== 'pen'}
                onChange={(event) => setPenColor(event.target.value)}
              />
            </label>

            <label className="freehand-options__width">
              <span>Толщина</span>
              <input
                type="range"
                min="1"
                max="12"
                step="0.5"
                value={penWidth}
                disabled={toolMode !== 'pen'}
                onChange={(event) =>
                  setPenWidth(Number(event.target.value))
                }
              />
              <output>{penWidth.toFixed(1)} px</output>
            </label>
          </div>
        )}

        {workspaceSearchOpen && (
          <WorkspaceSearch
            workspaceId={meta.workspaceId}
            token={session.token}
            onClose={() => setWorkspaceSearchOpen(false)}
            onSwitchBoard={onSwitchBoard}
            onOpenDataset={(datasetId, rowId) =>
              setSheetTarget({ datasetId, rowId })
            }
            onNavigateObject={navigateToDatasetLocation}
          />
        )}

        {sheetTarget && (
          <DatasetSheet
            datasetId={sheetTarget.datasetId}
            focusRowId={sheetTarget.rowId}
            token={session.token}
            readOnly={readOnly}
            onClose={() => setSheetTarget(null)}
          />
        )}

        {dropActive && !readOnly && (
          <div className="csv-drop-overlay">
            <div>
              <UploadCloud size={34} />
              <strong>Drop CSV to create a Dataset</strong>
              <span>The table will be placed here after preview.</span>
            </div>
          </div>
        )}

        {dropError && (
          <div className="csv-drop-error">
            <span>{dropError}</span>
            <button onClick={() => setDropError('')}><X size={15} /></button>
          </div>
        )}

        {pendingRelation && (
          <RelationDialog
            relation={pendingRelation}
            token={session.token}
            onCancel={() => setPendingRelation(null)}
            onConfirm={confirmRelation}
          />
        )}

        {csvDrop && (
          <CsvImportDialog
            parsed={csvDrop.parsed}
            onCancel={() => setCsvDrop(null)}
            onImport={importCsv}
          />
        )}

        {readOnly && (
          <div className="readonly-banner">
            Board editing is read-only for {meta.role}. Comments follow the role policy.
          </div>
        )}

        {selectedNode && (
          <InspectorPanel
            node={selectedNode}
            boardId={meta.id}
            workspaceId={meta.workspaceId}
            token={session.token}
            readOnly={readOnly}
            onClose={() => setSelectedNodeId(null)}
            onUpdateNodeData={updateNodeData}
          />
        )}

        {devicesOpen && (
          <DevicePalette
            readOnly={readOnly}
            onAdd={addDevice}
            onAddTemplate={addTemplateNode}
            onClose={() => setDevicesOpen(false)}
          />
        )}

        {commentsOpen && (
          <CommentsPanel
            boardId={meta.id}
            token={session.token}
            role={meta.role}
            onClose={() => setCommentsOpen(false)}
          />
        )}

        {datasetsOpen && (
          <DatasetsPanel
            workspaceId={meta.workspaceId}
            token={session.token}
            readOnly={readOnly}
            onPlace={placeDataset}
            onClose={() => setDatasetsOpen(false)}
          />
        )}
      </div>
    </BoardActionsProvider>
  );
}

export function CollaborativeBoard(props: {
  meta: BoardMeta;
  session: AuthSession;
  boards: BoardMeta[];
  onSwitchBoard: (boardId: string) => void | Promise<void>;
  onCreateBoard: (name: string) => Promise<void>;
  onRenameBoard: (boardId: string, name: string) => Promise<void>;
  onDeleteBoard: (boardId: string) => Promise<void>;
}) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}

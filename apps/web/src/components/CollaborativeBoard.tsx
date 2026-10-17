import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
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
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { ChevronDown, ClipboardPaste, Copy, Database, Eraser, Frame as FrameIcon, Grid3X3, Hand, LayoutDashboard, HelpCircle, Maximize2, MessageSquare, MousePointer2, Network, PenLine, Pencil, Plus, Redo2, Search, Shapes, StickyNote, Trash2, Type, Undo2, UploadCloud, X, ZoomIn, ZoomOut } from 'lucide-react';
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
import { reconcileCanvasNodes, persistedCanvasGeometry, shouldPersistCanvasNodeChange, type CanvasPreview } from '../lib/canvasInteraction';
import { api } from '../lib/api';
import { RelationDialog, type PendingRelation } from './RelationDialog';
import { InspectorPanel } from './InspectorPanel';
import { DatasetSheet } from './DatasetSheet';
import { DeviceNode } from './DeviceNode';
import { DevicePalette } from './DevicePalette';
import { TemplateNode } from './TemplateNode';
import { RelationViewNode } from './RelationViewNode';
import { WorkspaceSearch } from './WorkspaceSearch';
import { FrameNode } from './FrameNode';
import { appendFreehandPoint, eraserHitsStroke, freehandPath, prepareFreehandStroke } from '../lib/freehandGeometry';
import { CanvasSelectionActions } from './CanvasSelectionActions';
import { CanvasContextMenu } from './CanvasContextMenu';
import { canvasPasteOffset, selectCanvasContextTarget, type CanvasContextCommand } from '../lib/canvasContextMenu';
import {
  alignCanvasNodes, distributeCanvasNodes, includeCanvasFrameContents, reorderCanvasLayers,
  canvasNodeSize, type CanvasAlignment, type CanvasDistribution, type CanvasLayerAction,
} from '../lib/canvasGeometry';

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

type DrawingGesture = {
  pointerId: number;
  target: HTMLDivElement;
  zoom: number;
} & ({ mode: 'pen'; stroke: FreehandStroke } | {
  mode: 'eraser'; lastPoint: FreehandPoint;
  erased: Map<string, FreehandStroke>;
  cache: Map<string, { stroke: FreehandStroke; geometry: ReturnType<typeof prepareFreehandStroke> }>;
});


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
  frame: FrameNode,
};

const nodeSize = canvasNodeSize;

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
  const [nodes, setNodesState] = useState<Node[]>([]);
  const nodesRef = useRef<Node[]>([]);
  const previewsRef = useRef(new Map<string, CanvasPreview>());
  // Event handlers and synchronous Yjs observers share the latest local state.
  // Document writes must stay outside React state updater functions.
  const setNodes = useCallback((update: SetStateAction<Node[]>) => {
    const next = typeof update === 'function' ? update(nodesRef.current) : update;
    nodesRef.current = next;
    setNodesState(next);
  }, []);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [strokes, setStrokes] = useState<FreehandStroke[]>([]);
  const [draftStroke, setDraftStroke] =
    useState<FreehandStroke | null>(null);
  const [penColor, setPenColor] = useState('#344054');
  const [penWidth, setPenWidth] = useState(2.6);
  const drawingGestureRef = useRef<DrawingGesture | null>(null);
  const drawingFrameRef = useRef<number | null>(null);
  const [erasedStrokeIds, setErasedStrokeIds] = useState<Set<string>>(new Set());
  const cancelDrawing = useCallback(() => {
    const gesture = drawingGestureRef.current;
    drawingGestureRef.current = null;
    if (drawingFrameRef.current !== null) cancelAnimationFrame(drawingFrameRef.current);
    drawingFrameRef.current = null;
    setDraftStroke(null);
    setErasedStrokeIds(new Set());
    if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  }, []);
  const queueDrawingPreview = useCallback(() => {
    if (drawingFrameRef.current !== null) return;
    drawingFrameRef.current = requestAnimationFrame(() => {
      drawingFrameRef.current = null;
      const gesture = drawingGestureRef.current;
      if (gesture?.mode === 'pen') setDraftStroke({ ...gesture.stroke, points: [...gesture.stroke.points] });
      else if (gesture?.mode === 'eraser') setErasedStrokeIds(new Set(gesture.erased.keys()));
    });
  }, []);
  const frameDragRef = useRef<{
    frameId: string;
    startX: number;
    startY: number;
    positions: Map<string, { x: number; y: number }>;
  } | null>(null);
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
  const [spacePressed, setSpacePressed] = useState(false);
  const [canvasHelpOpen, setCanvasHelpOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; kind: 'pane' | 'selection'; flowPosition: { x: number; y: number };
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const effectiveToolMode: ToolMode = spacePressed ? 'hand' : toolMode;
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
    setContextMenu(null);
    setSpacePressed(false);
    setToolMode('select');
    setSheetTarget(null);
    setPendingRelation(null);
    setCommentsOpen(false);
    setDatasetsOpen(false);
    setDevicesOpen(false);
    setBoardMenuOpen(false);
    setToolMode('select');
    cancelDrawing();
  }, [meta.id, cancelDrawing]);

  useEffect(() => {
    cancelDrawing();
  }, [effectiveToolMode, readOnly, cancelDrawing]);

  useEffect(() => {
    window.addEventListener('blur', cancelDrawing);
    return () => {
      window.removeEventListener('blur', cancelDrawing);
      cancelDrawing();
    };
  }, [cancelDrawing]);

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
      setNodes((current) => reconcileCanvasNodes(
        Array.from(nodesMap.values()) as Node[], current, previewsRef.current,
      ));
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
      offset: number | { x: number; y: number },
    ) => {
      if (readOnly || sourceNodes.length === 0) {
        return [] as string[];
      }

      const translation = typeof offset === 'number' ? { x: offset, y: offset } : offset;
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
            x: source.position.x + translation.x,
            y: source.position.y + translation.y,
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();

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
      undoManager,
      ydoc,
    ],
  );

  const pasteClipboard = useCallback(async (target?: { x: number; y: number }) => {
    if (!clipboard || readOnly) return;

    if (!target) pasteOffsetRef.current += 1;
    const offset = 28 + pasteOffsetRef.current * 12;

    await cloneToBoard(
      clipboard.nodes,
      clipboard.edges,
      target ? canvasPasteOffset(clipboard.nodes, target) : offset,
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

  const deleteSelection = useCallback(async () => {
    if (readOnly || selectedNodeIds.length === 0) return;

    const selected = new Set(selectedNodeIds);
    const selectedNodes = nodes.filter((node) =>
      selected.has(node.id),
    );

    await Promise.all(
      selectedNodes
        .filter((node) => (node.data as any)?.binding)
        .map((node) =>
          api
            .deleteObjectBinding(
              meta.id,
              node.id,
              session.token,
            )
            .catch(() => undefined),
        ),
    );

    undoManager.stopCapturing();
    ydoc.transact(() => {
      for (const nodeId of selectedNodeIds) {
        nodesMap.delete(nodeId);
      }

      for (const edge of edgesMap.values()) {
        if (
          selected.has(edge.source) ||
          selected.has(edge.target)
        ) {
          edgesMap.delete(edge.id);
        }
      }
    });

    undoManager.stopCapturing();

    clearSelection();
  }, [
    clearSelection,
    edgesMap,
    meta.id,
    nodes,
    nodesMap,
    readOnly,
    selectedNodeIds,
    session.token,
    undoManager,
    ydoc,
  ]);

  const wrapSelectionInFrame = useCallback(() => {
    if (
      readOnly ||
      selectedNodeIds.length === 0
    ) {
      return;
    }

    const selected = nodes.filter((node) =>
      selectedNodeIds.includes(node.id),
    );
    if (selected.length === 0) return;

    const bounds = selected.reduce(
      (result, node) => {
        const width = nodeSize(
          node,
          'width',
          180,
        );
        const height = nodeSize(
          node,
          'height',
          90,
        );

        return {
          left: Math.min(
            result.left,
            node.position.x,
          ),
          top: Math.min(
            result.top,
            node.position.y,
          ),
          right: Math.max(
            result.right,
            node.position.x + width,
          ),
          bottom: Math.max(
            result.bottom,
            node.position.y + height,
          ),
        };
      },
      {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      },
    );

    const paddingX = 70;
    const paddingTop = 78;
    const paddingBottom = 55;
    const frameId = crypto.randomUUID();

    const frame: Node = {
      id: frameId,
      type: 'frame',
      position: {
        x: bounds.left - paddingX,
        y: bounds.top - paddingTop,
      },
      style: {
        width:
          bounds.right -
          bounds.left +
          paddingX * 2,
        height:
          bounds.bottom -
          bounds.top +
          paddingTop +
          paddingBottom,
      },
      zIndex: -10,
      data: {
        title: 'Новая группа',
        description: '',
      },
    };

    undoManager.stopCapturing();
    nodesMap.set(frameId, frame);
    undoManager.stopCapturing();
    setSelectedNodeIds([frameId]);
    setSelectedNodeId(frameId);

    requestAnimationFrame(() => {
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          selected: node.id === frameId,
        })),
      );
    });
  }, [
    nodes,
    nodesMap,
    readOnly,
    selectedNodeIds,
    undoManager,
  ]);


  const layoutSelection = useCallback((mode: CanvasAlignment | CanvasDistribution) => {
    if (readOnly || previewsRef.current.size > 0) return;
    const current = nodesRef.current;
    const selected = new Set(current.filter((node) => node.selected).map((node) => node.id));
    const positions = mode === 'horizontal' || mode === 'vertical'
      ? distributeCanvasNodes(current, selected, mode)
      : alignCanvasNodes(current, selected, mode);
    const targets = includeCanvasFrameContents(current, positions, selected);
    if (!targets.size) return;
    undoManager.stopCapturing();
    ydoc.transact(() => {
      for (const [id, position] of targets) {
        const node = nodesMap.get(id) as Node | undefined;
        if (node) nodesMap.set(id, { ...node, position, dragging: false });
      }
    });
    undoManager.stopCapturing();
  }, [nodesMap, readOnly, undoManager, ydoc]);

  const changeSelectionLayer = useCallback((action: CanvasLayerAction) => {
    if (readOnly || previewsRef.current.size > 0) return;
    const current = nodesRef.current;
    const selected = new Set(current.filter((node) => node.selected).map((node) => node.id));
    const layers = reorderCanvasLayers(current, selected, action);
    if (!layers.size) return;
    undoManager.stopCapturing();
    ydoc.transact(() => {
      for (const [id, zIndex] of layers) {
        const node = nodesMap.get(id) as Node | undefined;
        if (node) nodesMap.set(id, { ...node, zIndex });
      }
    });
    undoManager.stopCapturing();
  }, [nodesMap, readOnly, undoManager, ydoc]);

  const activateTool = useCallback(
    (next: ToolMode) => {
      setContextMenu(null);
      cancelDrawing();
      setSpacePressed(false);
      if (next !== 'select') clearSelection();
      setToolMode(next);
    },
    [cancelDrawing, clearSelection],
  );

  const fitCanvas = useCallback(
    (selectionOnly = false) => {
      if (!rf) return;
      const selectedNodes = selectionOnly
        ? nodes.filter((node) => selectedNodeIds.includes(node.id))
        : [];
      if (selectionOnly && selectedNodes.length === 0) return;
      void rf.fitView({
        ...(selectedNodes.length > 0 ? { nodes: selectedNodes } : {}),
        padding: 0.22,
        duration: 260,
      });
    },
    [nodes, rf, selectedNodeIds],
  );

  const openContextMenu = useCallback((event: React.MouseEvent | MouseEvent, targetId?: string) => {
    // Keep native spelling, selection and clipboard actions in editable fields.
    if (event.shiftKey || (event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if (effectiveToolMode !== 'select' || !rf || previewsRef.current.size > 0) return;
    if (targetId && !nodesRef.current.some((node) => node.id === targetId)) return;
    event.preventDefault();
    event.stopPropagation();
    if (targetId) {
      const next = selectCanvasContextTarget(nodesRef.current, targetId);
      setNodes(next);
      const ids = next.filter((node) => node.selected).map((node) => node.id);
      setSelectedNodeIds(ids);
      setSelectedNodeId(ids.length === 1 ? ids[0] : null);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, kind: targetId ? 'selection' : 'pane',
      flowPosition: rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [effectiveToolMode, rf, setNodes]);

  const runContextCommand = useCallback((command: CanvasContextCommand) => {
    const run = async () => {
      if (command === 'fit-board') { fitCanvas(); return; }
      if (command === 'fit-selection') { fitCanvas(true); return; }
      if (command === 'copy') { copySelection(); return; }
      if (readOnly) return;
      if (command === 'paste') await pasteClipboard(contextMenu?.flowPosition);
      else if (command === 'duplicate') await duplicateSelection();
      else if (command === 'frame') wrapSelectionInFrame();
      else if (command === 'delete') await deleteSelection();
      else if (command === 'undo') undoManager.undo();
      else if (command === 'redo') undoManager.redo();
      else if (command.startsWith('align:')) layoutSelection(command.slice(6) as CanvasAlignment);
      else if (command.startsWith('distribute:')) layoutSelection(command.slice(11) as CanvasDistribution);
      else if (command.startsWith('layer:')) changeSelectionLayer(command.slice(6) as CanvasLayerAction);
    };
    void run().catch((error) => setDropError(error instanceof Error ? error.message : String(error)));
  }, [changeSelectionLayer, contextMenu, copySelection, deleteSelection, duplicateSelection, fitCanvas,
    layoutSelection, pasteClipboard, readOnly, undoManager, wrapSelectionInFrame]);

  const changeZoom = useCallback(
    (direction: 'in' | 'out' | 'reset') => {
      if (!rf) return;
      if (direction === 'reset') {
        void rf.zoomTo(1, { duration: 180 });
      } else if (direction === 'in') {
        void rf.zoomIn({ duration: 180 });
      } else {
        void rf.zoomOut({ duration: 180 });
      }
    },
    [rf],
  );

  useEffect(() => {
    const modalOpen = Boolean(
      sheetTarget ||
      workspaceSearchOpen ||
      datasetsOpen ||
      devicesOpen ||
      commentsOpen ||
      csvDrop ||
      pendingRelation ||
      boardMenuOpen,
    );

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null;

      if (canvasHelpOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setCanvasHelpOpen(false);
        }
        return;
      }

      if (contextMenu) return;
      if (typing || modalOpen) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.code === 'Space' && !mod && !event.altKey) {
        event.preventDefault();
        if (!event.repeat) {
          cancelDrawing();
          setSpacePressed(true);
        }
        return;
      }

      if (mod && key === 'k') {
        event.preventDefault();
        cancelDrawing();
        setWorkspaceSearchOpen(true);
        return;
      }

      if (mod && key === '0') {
        event.preventDefault();
        fitCanvas();
        return;
      }
      if (mod && key === '1') {
        event.preventDefault();
        changeZoom('reset');
        return;
      }

      if (!readOnly && effectiveToolMode === 'select' && mod && !event.altKey &&
        (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
        event.preventDefault();
        changeSelectionLayer(event.code === 'BracketRight'
          ? (event.shiftKey ? 'front' : 'forward')
          : (event.shiftKey ? 'back' : 'backward'));
        return;
      }
      if (!readOnly && mod && key === 'z') {
        event.preventDefault();
        if (drawingGestureRef.current) { cancelDrawing(); return; }
        if (event.shiftKey) undoManager.redo();
        else undoManager.undo();
        return;
      }
      if (!readOnly && mod && key === 'y') {
        event.preventDefault();
        if (drawingGestureRef.current) { cancelDrawing(); return; }
        undoManager.redo();
        return;
      }
      if (mod && key === 'c') {
        if (selectedNodeIds.length === 0) return;
        event.preventDefault();
        copySelection();
        return;
      }
      if (!readOnly && mod && key === 'v') {
        if (!clipboard) return;
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
          current.map((node) => ({ ...node, selected: true })),
        );
        setSelectedNodeIds(ids);
        setSelectedNodeId(ids.length === 1 ? ids[0] : null);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        activateTool('select');
        setPendingRelation(null);
        clearSelection();
        return;
      }

      if (mod || event.altKey) return;

      if (event.key === '?' || (event.shiftKey && event.code === 'Slash')) {
        event.preventDefault();
        cancelDrawing();
        setCanvasHelpOpen(true);
        return;
      }

      if (key === 'v') {
        activateTool('select');
      } else if (key === 'h') {
        activateTool('hand');
      } else if (!readOnly && key === 'p') {
        activateTool('pen');
      } else if (!readOnly && key === 'e') {
        activateTool('eraser');
      } else if (key === 'f') {
        fitCanvas(selectedNodeIds.length > 0);
      } else if (key === '+' || key === '=') {
        event.preventDefault();
        changeZoom('in');
      } else if (key === '-' || key === '_') {
        event.preventDefault();
        changeZoom('out');
      }
    };

    const stopTemporaryHand = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePressed(false);
      }
    };

    const resetTemporaryHand = () => setSpacePressed(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', stopTemporaryHand);
    window.addEventListener('blur', resetTemporaryHand);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', stopTemporaryHand);
      window.removeEventListener('blur', resetTemporaryHand);
    };
  }, [
    activateTool,
    boardMenuOpen,
    canvasHelpOpen,
    cancelDrawing,
    contextMenu,
    changeZoom,
    changeSelectionLayer,
    effectiveToolMode,
    clearSelection,
    clipboard,
    commentsOpen,
    copySelection,
    csvDrop,
    datasetsOpen,
    devicesOpen,
    duplicateSelection,
    fitCanvas,
    nodes,
    pasteClipboard,
    pendingRelation,
    readOnly,
    selectedNodeIds.length,
    sheetTarget,
    undoManager,
    workspaceSearchOpen,
  ]);

  const persistNodeChanges = useCallback((changes: NodeChange[]) => {
    const resizeState = new Map<string, boolean>();
    for (const change of changes) {
      if (change.type === 'dimensions' && change.resizing !== undefined) {
        resizeState.set(change.id, change.resizing);
      }
    }
    // Resizing from a top/left handle also emits position changes without a
    // dragging flag. Keep those local until the dimensions gesture completes.
    const gestureChanges = changes.map((change) =>
      change.type === 'position' && (resizeState.get(change.id) === true ||
        (previewsRef.current.get(change.id)?.resizing && resizeState.get(change.id) !== false))
        ? { ...change, dragging: true } : change);
    const current = nodesRef.current;
    const next = applyNodeChanges<Node>(gestureChanges, current);
    for (const change of gestureChanges) {
      if (change.type === 'position' || change.type === 'dimensions') {
        const active = change.type === 'position' ? change.dragging : change.resizing;
        if (active === true) {
          if (!previewsRef.current.size) undoManager.stopCapturing();
          const node = next.find((entry) => entry.id === change.id);
          if (node) {
            const preview = previewsRef.current.get(change.id) ?? {};
            previewsRef.current.set(change.id, { ...preview,
              ...(change.type === 'position'
                ? { position: node.position, dragging: true }
                : { measured: node.measured, width: node.width, height: node.height,
                    resizing: true }),
            });
          }
        } else {
          previewsRef.current.delete(change.id);
        }
      } else if (change.type === 'remove') {
        previewsRef.current.delete(change.id);
      }
    }
    setNodes(next);
    const persistent = gestureChanges.filter(shouldPersistCanvasNodeChange);
    if (!persistent.length) return;

    ydoc.transact(() => {
      for (const change of persistent) {
        if (change.type === 'remove') nodesMap.delete(change.id);
        else if (change.type === 'add' || change.type === 'replace') {
          nodesMap.set(change.item.id, { ...change.item, selected: false, dragging: false });
        } else if (change.type === 'position' || change.type === 'dimensions') {
          const shared = nodesMap.get(change.id) as Node | undefined;
          const local = next.find((node) => node.id === change.id);
          // A remote deletion wins; a move must never resurrect a removed node.
          if (shared && local) nodesMap.set(change.id, persistedCanvasGeometry(shared, local, change.type));
        }
      }
    });
    if (!previewsRef.current.size && !frameDragRef.current) undoManager.stopCapturing();
  }, [nodesMap, setNodes, undoManager, ydoc]);

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

  const createBoundRowObject = useCallback(
    async (
      dataset: DatasetSnapshot,
      row: DatasetRow,
    ) => {
      if (readOnly) return null;

      const titleCandidates = [
        'hostname',
        'name',
        'title',
        'label',
        'service',
        'device',
        'server',
        'id',
      ];
      const subtitleCandidates = [
        'ip',
        'ip_address',
        'address',
        'fqdn',
        'status',
        'port',
      ];

      const findColumn = (names: string[]) =>
        dataset.columns.find((column) =>
          names.includes(
            column.name.trim().toLowerCase(),
          ),
        )?.id;

      const titleColumnId =
        findColumn(titleCandidates) ??
        dataset.columns[0]?.id;
      const subtitleColumnId =
        findColumn(subtitleCandidates) ??
        dataset.columns.find(
          (column) =>
            column.id !== titleColumnId,
        )?.id;

      const nodeId = crypto.randomUUID();
      const binding = await api.upsertObjectBinding(
        meta.id,
        nodeId,
        session.token,
        {
          type: 'ROW',
          datasetId: dataset.id,
          rowId: row.id,
          presentation: {
            ...(titleColumnId
              ? { titleColumnId }
              : {}),
            ...(subtitleColumnId
              ? { subtitleColumnId }
              : {}),
          },
        },
      );

      const center = rf
        ? rf.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
        : { x: 480, y: 320 };
      const datasetName =
        dataset.name.trim().toLowerCase();

      const deviceKind: DeviceKind | null =
        /(^|[_\s-])(vm|machine|virtual)([_\s-]|$)/i.test(
          datasetName,
        )
          ? 'VM'
          : /server|host|node/i.test(datasetName)
            ? 'SERVER'
            : /database|db|postgres|mysql|sql/i.test(
                  datasetName,
                )
              ? 'DATABASE'
              : /firewall|(^|[_\s-])fw([_\s-]|$)/i.test(
                    datasetName,
                  )
                ? 'FIREWALL'
                : /switch/i.test(datasetName)
                  ? 'SWITCH'
                  : /router|gateway/i.test(datasetName)
                    ? 'ROUTER'
                    : /cloud/i.test(datasetName)
                      ? 'CLOUD'
                      : null;

      const node: Node = deviceKind
        ? {
            id: nodeId,
            type: 'device',
            position: {
              x: center.x - 110,
              y: center.y - 65,
            },
            style: {
              width: 220,
              height: 130,
            },
            data: {
              deviceKind,
              binding,
            },
          }
        : {
            id: nodeId,
            type: 'shape',
            position: {
              x: center.x - 110,
              y: center.y - 60,
            },
            style: {
              width: 220,
              height: 120,
            },
            data: {
              binding,
            },
          };

      nodesMap.set(nodeId, node);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds([nodeId]);
      setToolMode('select');

      return nodeId;
    },
    [
      meta.id,
      nodesMap,
      readOnly,
      rf,
      session.token,
    ],
  );

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
    } else if (type === 'frame') {
      node = {
        id,
        type,
        position: {
          x: center.x - 360,
          y: center.y - 230,
        },
        style: {
          width: 720,
          height: 460,
        },
        zIndex: -10,
        data: {
          title: 'Новая секция',
          description: '',
        },
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

  const eraseGestureSegment = useCallback((gesture: Extract<DrawingGesture, { mode: 'eraser' }>, point: FreehandPoint) => {
    for (const stroke of strokesMap.values()) {
      if (gesture.erased.has(stroke.id)) continue;
      let cached = gesture.cache.get(stroke.id);
      if (!cached || cached.stroke !== stroke) {
        cached = { stroke, geometry: prepareFreehandStroke(stroke, gesture.zoom) };
        gesture.cache.set(stroke.id, cached);
      }
      if (eraserHitsStroke(stroke, gesture.lastPoint, point, gesture.zoom, cached.geometry)) {
        gesture.erased.set(stroke.id, stroke);
      }
    }
    gesture.lastPoint = point;
  }, [strokesMap]);

  const beginDrawing = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || !rf || event.button !== 0 || !event.isPrimary || drawingGestureRef.current ||
      (effectiveToolMode !== 'pen' && effectiveToolMode !== 'eraser')) return;
    event.preventDefault();
    const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    const base = { pointerId: event.pointerId, target: event.currentTarget, zoom: rf.getZoom() };
    const gesture: DrawingGesture = effectiveToolMode === 'pen'
      ? { ...base, mode: 'pen', stroke: { id: crypto.randomUUID(), points: [point], width: penWidth,
          color: penColor, createdBy: session.user.id } }
      : { ...base, mode: 'eraser', lastPoint: point, erased: new Map(), cache: new Map() };
    drawingGestureRef.current = gesture;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (gesture.mode === 'pen') setDraftStroke({ ...gesture.stroke, points: [...gesture.stroke.points] });
    else {
      eraseGestureSegment(gesture, point);
      setErasedStrokeIds(new Set(gesture.erased.keys()));
    }
  }, [effectiveToolMode, eraseGestureSegment, penColor, penWidth, readOnly, rf, session.user.id]);

  const moveDrawing = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = drawingGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || readOnly || !rf) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of [...coalesced, event.nativeEvent]) {
      const point = rf.screenToFlowPosition({ x: sample.clientX, y: sample.clientY }, { snapToGrid: false });
      if (gesture.mode === 'pen') appendFreehandPoint(gesture.stroke.points, point, gesture.zoom);
      else eraseGestureSegment(gesture, point);
    }
    queueDrawingPreview();
  }, [eraseGestureSegment, queueDrawingPreview, readOnly, rf]);

  const finishDrawing = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = drawingGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (readOnly || !rf) { cancelDrawing(); return; }
    const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    if (gesture.mode === 'pen') appendFreehandPoint(gesture.stroke.points, point, gesture.zoom, true);
    else eraseGestureSegment(gesture, point);
    undoManager.stopCapturing();
    ydoc.transact(() => {
      if (gesture.mode === 'pen') strokesMap.set(gesture.stroke.id, gesture.stroke);
      else for (const [id, original] of gesture.erased) {
        // Keep a stroke that another participant changed during the gesture.
        if (strokesMap.get(id) === original) strokesMap.delete(id);
      }
    });
    undoManager.stopCapturing();
    cancelDrawing();
  }, [cancelDrawing, eraseGestureSegment, readOnly, rf, strokesMap, undoManager, ydoc]);

  const cancelPointerDrawing = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (drawingGestureRef.current?.pointerId === event.pointerId) cancelDrawing();
  }, [cancelDrawing]);

  const handleFrameDragStart = useCallback(
    (_event: any, frame: Node) => {
      if (readOnly) return;
      undoManager.stopCapturing();
      if (frame.type !== 'frame') {
        frameDragRef.current = null;
        return;
      }

      const left = frame.position.x;
      const top = frame.position.y;
      const right = left + nodeSize(frame, 'width', 720);
      const bottom = top + nodeSize(frame, 'height', 460);
      const selected = new Set(selectedNodeIds);

      const nodeIds = nodes
        .filter((candidate) => {
          if (
            candidate.id === frame.id ||
            candidate.type === 'frame' ||
            selected.has(candidate.id)
          ) {
            return false;
          }

          const centerX =
            candidate.position.x +
            nodeSize(candidate, 'width', 180) / 2;
          const centerY =
            candidate.position.y +
            nodeSize(candidate, 'height', 90) / 2;

          return (
            centerX >= left &&
            centerX <= right &&
            centerY >= top &&
            centerY <= bottom
          );
        })
        .map((candidate) => candidate.id);

      frameDragRef.current = {
        frameId: frame.id,
        startX: frame.position.x,
        startY: frame.position.y,
        positions: new Map(nodes.filter((node) => nodeIds.includes(node.id))
          .map((node) => [node.id, { ...node.position }])),
      };
    },
    [nodes, readOnly, selectedNodeIds, undoManager],
  );

  const handleFrameDrag = useCallback(
    (_event: any, frame: Node) => {
      const state = frameDragRef.current;
      if (!state || state.frameId !== frame.id) return;

      const dx = frame.position.x - state.startX;
      const dy = frame.position.y - state.startY;
      setNodes((current) => current.map((node) => {
        const start = state.positions.get(node.id);
        if (!start) return node;
        const position = { x: start.x + dx, y: start.y + dy };
        previewsRef.current.set(node.id, { position, dragging: true });
        return { ...node, position, dragging: true };
      }));
    },
    [setNodes],
  );

  const handleFrameDragStop = useCallback((_event: any, frame: Node) => {
    const state = frameDragRef.current;
    if (state && state.frameId === frame.id) {
      // Include the final pointer position even if there was no last move callback.
      handleFrameDrag(_event, frame);
      const local = new Map(nodesRef.current.map((node) => [node.id, node]));
      for (const id of state.positions.keys()) previewsRef.current.delete(id);
      ydoc.transact(() => {
        for (const id of state.positions.keys()) {
          const shared = nodesMap.get(id) as Node | undefined;
          const node = local.get(id);
          if (shared && node) nodesMap.set(id, persistedCanvasGeometry(shared, node, 'position'));
        }
      });
    }
    frameDragRef.current = null;
    undoManager.stopCapturing();
  }, [handleFrameDrag, nodesMap, undoManager, ydoc]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!provider || !rf) return;
    const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
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
        createBoundRowObject,
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
          className={`canvas-flow canvas-flow--${effectiveToolMode}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            setRf(instance);
            setCanvasZoom(instance.getZoom());
          }}
          onMoveStart={() => { closeContextMenu(); cancelDrawing(); }}
          onMoveEnd={(_, viewport) => setCanvasZoom(viewport.zoom)}
          onNodeContextMenu={(event, node) => openContextMenu(event, node.id)}
          onSelectionContextMenu={(event, selection) => {
            if (selection[0]) openContextMenu(event, selection[0].id);
          }}
          onPaneContextMenu={(event) => openContextMenu(event)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={handleFrameDragStart}
          onNodeDrag={handleFrameDrag}
          onNodeDragStop={handleFrameDragStop}
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
          onPaneClick={effectiveToolMode === 'select' ? clearSelection : undefined}
          nodesDraggable={!readOnly && effectiveToolMode === 'select'}
          nodesConnectable={!readOnly && effectiveToolMode === 'select'}
          elementsSelectable={effectiveToolMode === 'select'}
          multiSelectionKeyCode="Shift"
          elevateNodesOnSelect={false}
          deleteKeyCode={readOnly || effectiveToolMode !== 'select' || sheetTarget || workspaceSearchOpen ? null : ['Backspace', 'Delete']}
          fitView
          snapToGrid={snapToGrid}
          snapGrid={[22, 22]}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={effectiveToolMode === 'select'}
          panOnDrag={effectiveToolMode === 'hand' ? true : [1]}
          minZoom={0.15}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <MiniMap pannable zoomable />

          <Panel position="bottom-left" className="canvas-navigation-panel">
            <div className="canvas-navigation" aria-label="Масштаб и навигация">
              <button
                title="Уменьшить масштаб (-)"
                onClick={() => changeZoom('out')}
                disabled={!rf || canvasZoom <= 0.151}
              >
                <ZoomOut size={16} />
              </button>
              <button
                className="canvas-navigation__zoom"
                title="Масштаб 100% (Ctrl+1)"
                onClick={() => changeZoom('reset')}
                disabled={!rf}
              >
                {Math.round(canvasZoom * 100)}%
              </button>
              <button
                title="Увеличить масштаб (+)"
                onClick={() => changeZoom('in')}
                disabled={!rf || canvasZoom >= 2.49}
              >
                <ZoomIn size={16} />
              </button>
              <span className="canvas-navigation__separator" />
              <button
                title="Вписать все объекты (Ctrl+0)"
                onClick={() => fitCanvas()}
                disabled={!rf || nodes.length === 0}
              >
                <Maximize2 size={15} />
              </button>
              <button
                title="Управление Canvas (?)"
                onClick={() => setCanvasHelpOpen(true)}
              >
                <HelpCircle size={16} />
              </button>
            </div>
          </Panel>

          <Panel position="center-left" className="toolbar-panel">
            <div className="toolbar">
              <button
                className={toolMode === 'select' ? 'is-active' : ''}
                title="Выбор (V)"
                onClick={() => activateTool('select')}
              >
                <MousePointer2 size={19} />
              </button>
              <button
                className={toolMode === 'hand' ? 'is-active' : ''}
                title="Рука / перемещение canvas (H)"
                onClick={() => activateTool('hand')}
              >
                <Hand size={19} />
              </button>
              <button
                className={toolMode === 'pen' ? 'is-active' : ''}
                disabled={readOnly}
                title="Перо / свободное рисование (P)"
                onClick={() =>
                  activateTool(toolMode === 'pen' ? 'select' : 'pen')
                }
              >
                <PenLine size={19} />
              </button>
              <button
                className={toolMode === 'eraser' ? 'is-active' : ''}
                disabled={readOnly}
                title="Ластик для рисунков (E)"
                onClick={() =>
                  activateTool(toolMode === 'eraser' ? 'select' : 'eraser')
                }
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
              <button disabled={readOnly} onClick={() => addNode('frame')} title="Frame / секция"><FrameIcon size={19} /></button>
              <div className="toolbar-separator" />
              <button onClick={() => setCommentsOpen(true)} title="Комментарии"><MessageSquare size={19} /></button>
            </div>
          </Panel>

          <ViewportPortal>
            <svg
              className="freehand-layer"
              aria-hidden="true"
            >
              {[...strokes.filter((stroke) => !erasedStrokeIds.has(stroke.id)), ...(draftStroke ? [draftStroke] : [])].map(
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

        {contextMenu && (
          <CanvasContextMenu
            key={`${contextMenu.kind}:${contextMenu.x}:${contextMenu.y}`}
            x={contextMenu.x} y={contextMenu.y}
            options={{ readOnly, selectionCount: contextMenu.kind === 'selection' ? selectedNodeIds.length : 0,
              canPaste: Boolean(clipboard), canUndo, canRedo,
              busy: nodes.some((node) => node.dragging || node.resizing) }}
            onCommand={runContextCommand}
            onClose={closeContextMenu}
          />
        )}

        {effectiveToolMode === 'select' && selectedNodeIds.length > 0 && !readOnly && (
          <CanvasSelectionActions
            key={selectedNodeIds.join(':')}
            count={selectedNodeIds.length}
            busy={nodes.some((node) => node.dragging || node.resizing)}
            onAlign={layoutSelection}
            onDistribute={layoutSelection}
            onLayer={changeSelectionLayer}
            onDuplicate={() => void duplicateSelection()}
            onFrame={wrapSelectionInFrame}
            onDelete={() => void deleteSelection()}
          />
        )}

        {(effectiveToolMode === 'pen' || effectiveToolMode === 'eraser') && !readOnly && (
          <div
            className={`freehand-capture freehand-capture--${effectiveToolMode}`}
            onPointerDown={beginDrawing}
            onPointerMove={moveDrawing}
            onPointerUp={finishDrawing}
            onPointerCancel={cancelPointerDrawing}
            onLostPointerCapture={cancelPointerDrawing}
          />
        )}

        {(toolMode === 'pen' || toolMode === 'eraser') && !readOnly && (
          <div className="freehand-options">
            <div className="freehand-options__mode"
              title={toolMode === 'pen' ? 'Рисуйте свободно; Esc отменяет текущий штрих.' :
                'Удаляет целые штрихи. Отпустите кнопку для сохранения; Esc отменяет текущий жест.'}>
              {toolMode === 'pen' ? (
                <PenLine size={14} />
              ) : (
                <Eraser size={14} />
              )}
              <strong>
                {toolMode === 'pen' ? 'Перо' : 'Ластик штрихов'}
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

            <button
              className="freehand-options__done"
              onClick={() => {
                activateTool('select');
              }}
            >
              <MousePointer2 size={13} />
              Готово
            </button>
          </div>
        )}

        {canvasHelpOpen && (
          <div
            className="canvas-help-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setCanvasHelpOpen(false);
              }
            }}
          >
            <section
              className="canvas-help"
              role="dialog"
              aria-modal="true"
              aria-label="Управление Canvas"
            >
              <header>
                <div>
                  <strong>Управление Canvas</strong>
                  <p>Основные действия и горячие клавиши ModelBoard</p>
                </div>
                <button
                  aria-label="Закрыть справку"
                  onClick={() => setCanvasHelpOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="canvas-help__groups">
                <section>
                  <h3>Инструменты</h3>
                  <dl>
                    <div><dt>Выбрать объект</dt><dd>V</dd></div>
                    <div><dt>Постоянный режим руки</dt><dd>H</dd></div>
                    <div><dt>Рука на время удержания</dt><dd>Пробел</dd></div>
                    <div><dt>Перо / ластик</dt><dd>P / E</dd></div>
                    <div><dt>Выход из инструмента</dt><dd>Esc</dd></div>
                    <div><dt>Дополнительное выделение</dt><dd>Shift + клик</dd></div>
                    <div><dt>Действия с объектом / доской</dt><dd>Правая кнопка</dd></div>
                    <div><dt>Меню браузера</dt><dd>Shift + правая кнопка</dd></div>
                  </dl>
                </section>
                <section>
                  <h3>Доска и масштаб</h3>
                  <dl>
                    <div><dt>Увеличить / уменьшить</dt><dd>Колесо / + / −</dd></div>
                    <div><dt>Передвигать доску</dt><dd>Рука / средняя кнопка</dd></div>
                    <div><dt>Показать всё</dt><dd>Ctrl + 0</dd></div>
                    <div><dt>Масштаб 100%</dt><dd>Ctrl + 1</dd></div>
                    <div><dt>Фокус на выделении</dt><dd>F</dd></div>
                    <div><dt>Поиск по Workspace</dt><dd>Ctrl + K</dd></div>
                  </dl>
                </section>
                <section>
                  <h3>Работа с объектами</h3>
                  <dl>
                    <div><dt>Копировать / вставить</dt><dd>Ctrl + C / V</dd></div>
                    <div><dt>Дублировать</dt><dd>Ctrl + D</dd></div>
                    <div><dt>Выбрать все объекты</dt><dd>Ctrl + A</dd></div>
                    <div><dt>Отменить / повторить</dt><dd>Ctrl + Z / Y</dd></div>
                    <div><dt>На слой назад / вперёд</dt><dd>Ctrl + [ / ]</dd></div>
                    <div><dt>На задний / передний план</dt><dd>Ctrl + Shift + [ / ]</dd></div>
                    <div><dt>Удалить объект</dt><dd>Delete</dd></div>
                  </dl>
                </section>
              </div>
              <footer>
                <span>Во время ввода текста горячие клавиши доски отключаются.</span>
                <button onClick={() => setCanvasHelpOpen(false)}>
                  Понятно
                </button>
              </footer>
            </section>
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

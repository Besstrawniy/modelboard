import { createId } from '../lib/uuid.ts';
import { COLLAB_URL } from '../lib/config';
import { shortcutKey } from '../lib/keyboard';
import { ColorControl } from './ColorControl';
import { useDialogFocus } from '../lib/useDialogFocus';
import { CanvasEdgeProperties } from './CanvasEdgeProperties';
import { reconcileCanvasPresence, type CanvasPresence } from '../lib/canvasPresence';
import { ImageNode } from './ImageNode';
import { SessionTools } from './SessionTools';
import { presenceColor } from '@modelboard/shared';
import { FilesPanel } from './FilesPanel';
import { FileImportDialog, type ImportedFilesResult } from './FileImportDialog';
import { parseImportFiles, type ParsedFiles } from '../lib/fileFormats';
import { exportCanvasImage } from '../lib/exportCanvasImage';
import type { StoredFile } from '../lib/api';
import { canvasInsertionPosition } from '../lib/canvasGeometry';
import { receiveResourceMessage } from '../lib/resources';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useStoreApi,
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
import { ChevronDown, Layers3, ClipboardPaste, Copy, Database, Eraser, Frame as FrameIcon, Grid3X3, Hand, LayoutDashboard, HelpCircle, Maximize2, MessageSquare, MousePointer2, Network, PenLine, Pencil, Plus, Redo2, Search, Shapes, StickyNote, Trash2, Type, Undo2, UploadCloud, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  CanvasNodeStore,
  DEMO_BOARD_ID,
  DEMO_ROLES_DATASET_ID,
  DEMO_USERS_DATASET_ID,
  canEditBoard,
  type AuthSession,
  type BoardDatasetLocation,
  type BoardMeta,
  type CreateDatasetInput,
  type DatasetRelation,
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
import { FreehandNode } from './FreehandNode';
import { createCanvasDemo } from '../lib/canvasDemo';
import { snapCanvasGuides } from '../lib/canvasGuides';
import { strokeCanvasNode, canvasNodeStroke } from '../lib/canvasStrokes';
import { canvasDescendants, canvasSelectionRoots, containerId, enclosingCanvasFrame, moveCanvasDescendants } from '../lib/canvasHierarchy';
import { useCanvasModifiers } from '../lib/useCanvasModifiers';
import { appendFreehandPoint, eraserHitsStroke, freehandPath, prepareFreehandStroke } from '../lib/freehandGeometry';
import { CanvasSelectionActions } from './CanvasSelectionActions';
import { CanvasContextMenu } from './CanvasContextMenu';
import { CanvasObjectsPanel } from './CanvasObjectsPanel';
import { canvasPasteOffset, selectCanvasContextTarget, type CanvasContextCommand } from '../lib/canvasContextMenu';
import {
  alignCanvasNodes, distributeCanvasNodes, reorderCanvasLayers,
  canvasNodeSize, type CanvasAlignment, type CanvasDistribution, type CanvasLayerAction,
} from '../lib/canvasGeometry';

type CsvDropState = {
  parsed: ParsedFiles;
  position: { x: number; y: number };
};

type BoardClipboard = {
  nodes: Node[];
  edges: Edge[];
};

type ToolMode = 'select' | 'hand' | 'pen' | 'eraser' | 'shape' | 'sticky' | 'text' | 'connector';

type DrawingGesture = {
  pointerId: number;
  target: HTMLDivElement;
  zoom: number;
} & ({ mode: 'pen'; stroke: FreehandStroke } | {
  mode: 'eraser'; lastPoint: FreehandPoint;
  erased: Map<string, Node>;
  cache: Map<string, { stroke: Node; geometry: ReturnType<typeof prepareFreehandStroke> }>;
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
  image: ImageNode,
  template: TemplateNode,
  relationView: RelationViewNode,
  frame: FrameNode,
  group: FrameNode,
  freehand: FreehandNode,
};

const nodeSize = canvasNodeSize;

function seedDocument(nodesMap: CanvasNodeStore, edgesMap: Y.Map<any>) {
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

function migrateKnownDemoNodes(nodesMap: CanvasNodeStore) {
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
  const flowStore=useStoreApi();
  const modifiers = useCanvasModifiers();
  const ydoc = useMemo(() => new Y.Doc(), [meta.id, session.user.id]);
  const nodesMap = useMemo(() => new CanvasNodeStore(ydoc), [ydoc]);
  const edgesMap = useMemo(() => ydoc.getMap<any>('edges'), [ydoc]);
  const strokesMap = useMemo(
    () => ydoc.getMap<FreehandStroke>('strokes'),
    [ydoc],
  );
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(
        [nodesMap.type, edgesMap, strokesMap],
        { captureTimeout: 350 },
      ),
    [edgesMap, nodesMap, strokesMap],
  );
  const initialSyncDone = useRef(false);
  const pasteOffsetRef = useRef(0);
  const [nodes, setNodesState] = useState<Node[]>([]);
  const nodesRef = useRef<Node[]>([]);
  const [guides, setGuides] = useState<{axis: 'x' | 'y'; value: number}[]>([]);
  const groupResizeRef = useRef<{ id: string; root: Node; children: Node[] } | null>(null);
  const previewsRef = useRef(new Map<string, CanvasPreview>());
  // Event handlers and synchronous Yjs observers share the latest local state.
  // Document writes must stay outside React state updater functions.
  const setNodes = useCallback((update: SetStateAction<Node[]>) => {
    const next = typeof update === 'function' ? update(nodesRef.current) : update;
    nodesRef.current = next;
    setNodesState(next);
  }, []);
  const [edges, setEdges] = useState<Edge[]>([]);

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
    roots: Set<string>;
    startX: number;
    startY: number;
    positions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [synced, setSynced] = useState(false);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [presence, setPresence] = useState<CanvasPresence>([]);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const initialViewReady = useRef(false);
  useEffect(() => {
    if (!synced || !rf || initialViewReady.current) return;
    initialViewReady.current = true;
    // Fit only the loaded board. A queued fit on an empty board would move the
    // camera when the first object is placed and break the placement preview.
    if (nodesRef.current.length) void rf.fitView({ maxZoom: 1 });
  }, [synced, rf]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [datasetsOpen, setDatasetsOpen] = useState(false);
  const [csvDrop, setCsvDrop] = useState<CsvDropState | null>(null);
  const [filesOpen,setFilesOpen]=useState(false);
  const [fileParsing,setFileParsing]=useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [dropError, setDropError] = useState('');
  const [pendingRelation, setPendingRelation] = useState<PendingRelation | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<BoardClipboard | null>(null);
  const [trackpadMode, setTrackpadMode] = useState(() => localStorage.getItem('modelboard:trackpad') === 'true');
  const [snapToGrid, setSnapToGrid] = useState(() =>
    localStorage.getItem('modelboard:snap-to-grid') !== 'false',
  );
  const gridActive = snapToGrid && !modifiers.alt;
  const insertionPointRef = useRef<{ x: number; y: number } | null>(null);
  const connectorStartRef = useRef<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [shapeKind, setShapeKind] = useState('rectangle');
  const [shapeMenu, setShapeMenu] = useState(false);
  const [shapeMenuPosition,setShapeMenuPosition]=useState({left:80,top:300});
  const placementPreview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shapeMenu) return;
    const position=()=>{const rect=document.querySelector('.shape-picker')?.getBoundingClientRect();if(rect)setShapeMenuPosition({left:Math.min(rect.right+8,window.innerWidth-240),top:Math.min(rect.top,window.innerHeight-62)});};
    position();
    window.addEventListener('resize',position);
    document.addEventListener('scroll',position,true);
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.shape-picker,.shape-picker__menu')) setShapeMenu(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShapeMenu(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize',position);
      document.removeEventListener('scroll',position,true);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [shapeMenu]);
  const [spacePressed, setSpacePressed] = useState(false);
  const [canvasHelpOpen, setCanvasHelpOpen] = useState(false);
  const helpDialog = useDialogFocus({ open: canvasHelpOpen, onClose: () => setCanvasHelpOpen(false) });
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
  const [objectsOpen, setObjectsOpen] = useState(false);
  const objectsButtonRef = useRef<HTMLButtonElement>(null);
  const closeObjectsPanel = useCallback(() => {
    setObjectsOpen(false);
    objectsButtonRef.current?.focus({ preventScroll: true });
  }, []);
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
    setObjectsOpen(false);
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

  useEffect(()=>{const refresh=()=>void refreshWorkspaceTemplates().catch(error=>setDropError(error.message));window.addEventListener('modelboard:templates',refresh);return()=>window.removeEventListener('modelboard:templates',refresh);},[refreshWorkspaceTemplates]);

  useEffect(() => {
    void refreshWorkspaceTemplates().catch((error) =>
      setDropError(
        error instanceof Error ? error.message : String(error),
      ),
    );
  }, [refreshWorkspaceTemplates]);

  useEffect(() => {
    const collabUrl = COLLAB_URL;
    const instance = new HocuspocusProvider({
      url: collabUrl,
      name: `board:${meta.id}`,
      document: ydoc,
      token: session.token,
      flushDelay: 40,
      onStatus: ({ status }) => setStatus(status),
      onAuthenticationFailed: () => { setStatus('error'); setSynced(false); },
      onUnsyncedChanges: ({ number }) => setPendingChanges(number),
      onSynced: ({ state }) => {
        if (!state) return;
        setSynced(true);
        if (!readOnly && strokesMap.size) ydoc.transact(() => {
          for (const stroke of strokesMap.values()) {
            if (!nodesMap.has(stroke.id) && stroke.points.length) nodesMap.set(stroke.id, strokeCanvasNode(stroke));
            strokesMap.delete(stroke.id);
          }
        });
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
      onStateless: ({payload})=>{const message=receiveResourceMessage(payload);if(message?.kind==='dataset-deleted')setSheetTarget(current=>current?.datasetId===message.datasetId?null:current);},
      onAwarenessChange: ({ states }) => {
        setPresence(current => reconcileCanvasPresence(current, states, ydoc.clientID));
      },
    });

    instance.awareness?.setLocalStateField('user', {
      id: session.user.id,
      name: session.user.displayName,
      role: meta.role,
    });
    setProvider(instance);

    const syncNodes = () => {
      const stored = new Map(Array.from(nodesMap.values()).map((node: Node) => [node.id,node]));
      for (const stroke of strokesMap.values()) if (!stored.has(stroke.id) && stroke.points.length) stored.set(stroke.id,strokeCanvasNode(stroke));
      setNodes((current) => reconcileCanvasNodes(
        Array.from(stored.values()).map((node: Node) => ({ ...node, style: { ...node.style, '--canvas-rotation': `${Number(node.data.rotation ?? 0)}deg`, '--canvas-fill': node.data.fill, '--canvas-stroke': typeof node.data.stroke === 'string' ? node.data.stroke : undefined, '--canvas-color': node.data.color, '--canvas-font-size': node.data.fontSize ? `${node.data.fontSize}px` : undefined, '--canvas-font-family': node.data.fontFamily, '--canvas-font-weight': node.data.bold === undefined ? undefined : node.data.bold ? 700 : 400, '--canvas-font-style': node.data.italic === undefined ? undefined : node.data.italic ? 'italic' : 'normal', '--canvas-text-decoration': node.data.underline === undefined ? undefined : node.data.underline ? 'underline' : 'none', '--canvas-stroke-width': `${Number(node.data.strokeWidth ?? 2)}px`, '--canvas-stroke-style': node.data.strokeDash === 'dashed' ? 'dashed' : 'solid', opacity: Number(node.data.opacity ?? 100) / 100 } })) as Node[], current, previewsRef.current,
      ));
    };
    const syncEdges = () => setEdges((current) => { const selected = new Set(current.filter((edge) => edge.selected).map((edge) => edge.id)); return Array.from(edgesMap.values()).map((edge: Edge) => ({...edge,selected:selected.has(edge.id)})); });
    const syncStrokes = syncNodes;
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
    setEdges((current) => current.map((edge) => edge.selected ? {...edge,selected:false} : edge));
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

    const selected = canvasDescendants(nodes, new Set(selectedNodeIds));
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
        idMap.set(source.id, createId());
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
          if (data.containerId) data.containerId = idMap.get(String(data.containerId));
          if (source.type === 'freehand' && data.stroke && typeof data.stroke === 'object') data.stroke.id = id;
          clone.data = data;
          clone.selected = false;

          return clone;
        }),
      );

      const clonedEdges = sourceEdges.map((source) => {
        const clone = structuredClone(source);
        clone.id = createId();
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

      {
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
      }

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

    const selected = canvasDescendants(nodes, new Set(selectedNodeIds));
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
    if (readOnly || (selectedNodeIds.length === 0 && !edges.some((edge) => edge.selected))) return;

    const selected = canvasDescendants(nodes, new Set(selectedNodeIds));
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
      for (const nodeId of selected) {
        nodesMap.delete(nodeId);
      }

      for (const edge of edgesMap.values()) {
        if (
          selected.has(edge.source) ||
          selected.has(edge.target) || edges.some((item) => item.id === edge.id && item.selected)
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
    edges,
    meta.id,
    nodes,
    nodesMap,
    readOnly,
    selectedNodeIds,
    session.token,
    undoManager,
    ydoc,
  ]);

  const wrapSelectionInFrame = useCallback((kind: 'frame' | 'group' = 'frame') => {
    if (
      readOnly ||
      selectedNodeIds.length === 0
    ) {
      return;
    }

    const selected = nodes.filter((node) =>
      selectedNodeIds.includes(node.id),
    );
    if (selected.length === 0 || (kind === 'group' && selected.length < 2)) return;

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
    const frameId = createId();

    const frame: Node = {
      id: frameId,
      type: kind,
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
      zIndex: Math.min(0, ...selected.map((node) => node.zIndex ?? 0)) - 1,
      data: {
        containerId: (() => { const roots=canvasSelectionRoots(nodes,new Set(selectedNodeIds)); const parent=roots[0] && containerId(roots[0]); return roots.every((node)=>containerId(node)===parent) ? parent : undefined; })(),
        title: kind === 'group' ? 'Группа' : 'Секция',
        description: '',
      },
    };

    undoManager.stopCapturing();
    ydoc.transact(() => {
      nodesMap.set(frameId, frame);
      for (const item of canvasSelectionRoots(nodes, new Set(selectedNodeIds))) {
        const current = nodesMap.get(item.id);
        if (current) nodesMap.set(item.id, { ...current, data: { ...current.data, containerId: frameId } });
      }
    });
    undoManager.stopCapturing();
    setSelectedNodeIds([frameId]);
    setSelectedNodeId(frameId);

    {
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          selected: node.id === frameId,
        })),
      );
    }
  }, [
    nodes,
    nodesMap,
    readOnly,
    selectedNodeIds,
    undoManager,
    ydoc,
  ]);


  const changeContainer = useCallback((action: 'ungroup' | 'attach' | 'detach') => {
    if (readOnly) return;
    const current = nodesRef.current;
    const selected = new Set(current.filter((node) => node.selected).map((node) => node.id));
    const target = action === 'attach' ? enclosingCanvasFrame(current, selected) : undefined;
    if (action === 'attach' && !target) { setDropError('Выделенные объекты должны целиком находиться внутри Frame.'); return; }
    undoManager.stopCapturing();
    ydoc.transact(() => {
      for (const item of canvasSelectionRoots(current, selected)) {
        const node = nodesMap.get(item.id) as Node | undefined;
        if (!node) continue;
        if (action === 'ungroup' && (node.type === 'group' || node.type === 'frame')) {
          for (const child of Array.from(nodesMap.values()) as Node[]) {
            if (containerId(child) === node.id) nodesMap.set(child.id, { ...child, data: { ...child.data, containerId: containerId(node) } });
          }
          nodesMap.delete(node.id);
          for (const edge of Array.from(edgesMap.values())) if (edge.source === node.id || edge.target === node.id) edgesMap.delete(edge.id);
        } else if (action !== 'ungroup') nodesMap.set(node.id, { ...node, data: { ...node.data, containerId: target?.id } });
      }
    });
    undoManager.stopCapturing();
  }, [edgesMap, nodesMap, readOnly, undoManager, ydoc]);

  const layoutSelection = useCallback((mode: CanvasAlignment | CanvasDistribution) => {
    if (readOnly || previewsRef.current.size > 0) return;
    const current = nodesRef.current;
    const requested = new Set(current.filter((node) => node.selected).map((node) => node.id));
    const selected = new Set(canvasSelectionRoots(current,requested).map((node) => node.id));
    const positions = mode === 'horizontal' || mode === 'vertical'
      ? distributeCanvasNodes(current, selected, mode)
      : alignCanvasNodes(current, selected, mode);
    const targets = moveCanvasDescendants(current, positions);
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
    const selected = canvasDescendants(current, new Set(current.filter((node) => node.selected).map((node) => node.id)));
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
      connectorStartRef.current = null;
      if (next !== 'select') clearSelection();
      setToolMode(next);
    },
    [cancelDrawing, clearSelection],
  );

  const selectPanelObjects = useCallback((ids: string[]) => {
    if (previewsRef.current.size > 0) return;
    activateTool('select');
    const requested = new Set(ids);
    const next = nodesRef.current.map((node) => ({ ...node, selected: requested.has(node.id) }));
    const selected = next.filter((node) => node.selected).map((node) => node.id);
    setNodes(next);
    setSelectedNodeIds(selected);
    setSelectedNodeId(selected.length === 1 ? selected[0] : null);
  }, [activateTool, setNodes]);

  const focusPanelObject = useCallback((id: string) => {
    if (previewsRef.current.size > 0) return;
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node) return;
    selectPanelObjects([id]);
    const shell = objectsButtonRef.current?.closest('.board-shell');
    const listBounds = shell?.querySelector('.canvas-objects')?.getBoundingClientRect();
    const shellBounds = shell?.getBoundingClientRect();
    const left = listBounds && shellBounds ? listBounds.right - shellBounds.left + 16 : 32;
    void rf?.fitView({ nodes: [node], maxZoom: 1.5, duration: 280,
      padding: { left: `${left}px`, right: window.innerWidth > 1000 ? '360px' : '24px', top: '64px', bottom: '88px' },
    });
  }, [rf, selectPanelObjects]);

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
      else if (command === 'group') wrapSelectionInFrame('group');
      else if (command === 'ungroup' || command === 'attach' || command === 'detach') changeContainer(command);
      else if (command === 'delete') await deleteSelection();
      else if (command === 'undo') undoManager.undo();
      else if (command === 'redo') undoManager.redo();
      else if (command.startsWith('align:')) layoutSelection(command.slice(6) as CanvasAlignment);
      else if (command.startsWith('distribute:')) layoutSelection(command.slice(11) as CanvasDistribution);
      else if (command.startsWith('layer:')) changeSelectionLayer(command.slice(6) as CanvasLayerAction);
    };
    void run().catch((error) => setDropError(error instanceof Error ? error.message : String(error)));
  }, [changeSelectionLayer, contextMenu, copySelection, deleteSelection, duplicateSelection, fitCanvas,
    layoutSelection, pasteClipboard, readOnly, undoManager, wrapSelectionInFrame, changeContainer]);

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
      csvDrop || fileParsing ||
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
      const key = shortcutKey(event);

      if (event.code === 'Space' && !mod && !event.altKey) {
        if (target?.closest('button')) return;
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
      if (!readOnly && mod && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) changeContainer('ungroup'); else wrapSelectionInFrame('group');
        return;
      }
      if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault(); void deleteSelection(); return;
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
      } else if (!readOnly && key === 's') {
        activateTool('shape');
      } else if (!readOnly && key === 't') {
        activateTool('text');
      } else if (!readOnly && key === 'c') {
        activateTool('connector');
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
    changeContainer,
    wrapSelectionInFrame,
    deleteSelection,
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
    let next = applyNodeChanges<Node>(gestureChanges, current);
    const resized = gestureChanges.find((change) => change.type === 'dimensions' && change.resizing !== undefined);
    const resizeTargets: Node[] = [];
    if (resized && resized.type === 'dimensions') {
      const root = current.find((node) => node.id === resized.id);
      if (root?.type === 'group') {
        if (!groupResizeRef.current) {
          const ids = canvasDescendants(current, new Set([root.id]));
          groupResizeRef.current = { id: root.id, root, children: current.filter((node) => node.id !== root.id && ids.has(node.id)) };
        }
        const snapshot = groupResizeRef.current;
        const target = next.find((node) => node.id === root.id)!;
        const sx = nodeSize(target, 'width', 1) / nodeSize(snapshot.root, 'width', 1);
        const sy = nodeSize(target, 'height', 1) / nodeSize(snapshot.root, 'height', 1);
        for (const child of snapshot.children) {
          const existing = next.find((node) => node.id === child.id);
          if (!existing) continue;
          const width = nodeSize(child, 'width', 180) * sx, height = nodeSize(child, 'height', 90) * sy;
          const updated = { ...existing, position: { x: target.position.x+(child.position.x-snapshot.root.position.x)*sx,
            y: target.position.y+(child.position.y-snapshot.root.position.y)*sy }, width, height, measured: { width,height }, style: { ...existing.style,width,height } };
          resizeTargets.push(updated);
          previewsRef.current.set(child.id, { position: updated.position, width, height, measured: updated.measured, resizing: true });
        }
        const byId = new Map(resizeTargets.map((node) => [node.id,node]));
        next = next.map((node) => byId.get(node.id) ?? node);
        if (resized.resizing === false) {
          for (const child of snapshot.children) previewsRef.current.delete(child.id);
          groupResizeRef.current = null;
        }
      }
    }
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
      if (resized?.type === 'dimensions' && resized.resizing === false) for (const local of resizeTargets) {
        const shared = nodesMap.get(local.id);
        if (shared) nodesMap.set(local.id, { ...shared, position: local.position, width: local.width, height: local.height, style: local.style });
      }
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
      setNodes((current) => applyNodeChanges(changes.filter((c) => c.type === 'select' || (c.type === 'dimensions' && c.resizing === undefined && !c.setAttributes)), current));
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
    // React Flow includes every incident edge when a node enters a marquee.
    // Object selection must not implicitly open an FK connector's properties.
    const marquee=flowStore.getState().userSelectionRect!==null;
    const selectedChanges=marquee?changes.map(change=>change.type==='select'&&change.selected?{...change,selected:false}:change):changes;
    const allowed = readOnly ? selectedChanges.filter((change) => change.type === 'select') : selectedChanges;
    setEdges((current) => applyEdgeChanges(allowed, current));
    const persistent = allowed.filter((change) => change.type !== 'select');
    if (!persistent.length || readOnly) return;
    undoManager.stopCapturing();
    ydoc.transact(() => {
      for (const change of persistent) {
        if (change.type === 'remove') edgesMap.delete(change.id);
        if (change.type === 'add' || change.type === 'replace') edgesMap.set(change.item.id,change.item);
      }
    });
    undoManager.stopCapturing();
  }, [edgesMap, readOnly, ydoc, undoManager, flowStore]);

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly) return;
    if (!connection.source || !connection.target) return;

    const sourceNode = nodesMap.get(connection.source) as Node | undefined;
    const targetNode = nodesMap.get(connection.target) as Node | undefined;
    const sourceDatasetId = ((sourceNode?.data as any)?.datasetId ?? (sourceNode?.data as any)?.binding?.datasetId) as string | undefined;
    const targetDatasetId = ((targetNode?.data as any)?.datasetId ?? (targetNode?.data as any)?.binding?.datasetId) as string | undefined;
    // Loose mode permits starting at either side of a column. The endpoint
    // prefix describes its position, not the direction of the new relation.
    const sourceColumnId = connection.sourceHandle?.match(/^(?:source|target):(.+)$/)?.[1] ?? '';
    const targetColumnId = connection.targetHandle?.match(/^(?:source|target):(.+)$/)?.[1] ?? '';

    if (
      sourceDatasetId && targetDatasetId
    ) {
      setPendingRelation({
        connection,
        sourceDatasetId,
        sourceColumnId,
        targetDatasetId,
        targetColumnId,
        sourceRowId: (sourceNode?.data as any)?.binding?.rowId,
        targetRowId: (targetNode?.data as any)?.binding?.rowId,
      });
      return;
    }

    const edge: Edge = {
      ...connection,
      id: createId(),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { relationType: 'VISUAL' },
    };
    undoManager.stopCapturing();
    edgesMap.set(edge.id, edge);
    undoManager.stopCapturing();
  }, [edgesMap, nodesMap, readOnly, undoManager]);

  const confirmRelation = useCallback(async (
    input: import('@modelboard/shared').CreateDatasetRelationInput,
    existingId?:string,
  ) => {
    if (!pendingRelation) return;
    const {relationType, cardinality} = input;
    const relation = existingId ? await api.appendRecordLinks(meta.workspaceId,existingId,session.token,input.links??[]) : await api.createRelation(meta.workspaceId, session.token, input);

    const edge: Edge = {
      ...pendingRelation.connection,
      sourceHandle: (nodesMap.get(pendingRelation.connection.source) as Node|undefined)?.type==='table' ? input.matchMode==='ROW_LINKS'?'table:source':`source:${input.sourceColumnId}` : pendingRelation.connection.sourceHandle,
      targetHandle: (nodesMap.get(pendingRelation.connection.target) as Node|undefined)?.type==='table' ? input.matchMode==='ROW_LINKS'?'table:target':`target:${input.targetColumnId}` : pendingRelation.connection.targetHandle,
      id: createId(),
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
  }, [edgesMap, nodesMap, meta.workspaceId, pendingRelation, session.token]);

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    if (readOnly) return;
    const current = nodesMap.get(nodeId) as Node | undefined;
    if (!current) return;
    undoManager.stopCapturing();
    ydoc.transact(() => {
      const data = { ...current.data, ...patch };
      let updated: Node = { ...current,data };
      if (current.type === 'shape' && patch.shapeKind === 'circle') {
        const size = Math.max(nodeSize(current,'width',150),nodeSize(current,'height',150));
        updated={...updated,width:size,height:size,measured:undefined,style:{...updated.style,width:size,height:size}};
      }
      if (['text','sticky'].includes(current.type ?? '') && (data.autoSize ?? current.type === 'text')) {
        const fontSize=Number(data.fontSize??(current.type==='text'?22:16));
        const width=nodeSize(current,'width',240);
        const context=document.createElement('canvas').getContext('2d');
        if(context) {
          context.font=`${data.italic ? 'italic ' : ''}${data.bold ? 'bold ' : ''}${fontSize}px ${String(data.fontFamily ?? (current.type==='sticky'?'Segoe Print, Comic Sans MS, cursive':'Inter, sans-serif'))}`;
          const lines=String(data.text??'').split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil(context.measureText(line).width/Math.max(40,width-28))),0);
          const height=Math.max(current.type==='sticky'?120:40,Math.ceil(lines*fontSize*1.45+(current.type==='sticky'?48:28)));
          updated={...updated,height,measured:undefined,style:{...updated.style,height}};
        }
      }
      nodesMap.set(nodeId, updated);
      if (typeof patch.rotation === 'number' && (current.type === 'group' || current.type === 'frame')) {
        const angle = (patch.rotation - Number(current.data.rotation ?? 0)) * Math.PI / 180;
        const cx = current.position.x+nodeSize(current,'width',180)/2, cy=current.position.y+nodeSize(current,'height',90)/2;
        const ids = canvasDescendants(nodesRef.current,new Set([nodeId]));
        for (const id of ids) {
          if (id === nodeId) continue;
          const child=nodesMap.get(id) as Node | undefined; if (!child) continue;
          const w=nodeSize(child,'width',180), h=nodeSize(child,'height',90);
          const x=child.position.x+w/2-cx, y=child.position.y+h/2-cy;
          nodesMap.set(id,{...child,position:{x:cx+x*Math.cos(angle)-y*Math.sin(angle)-w/2,y:cy+x*Math.sin(angle)+y*Math.cos(angle)-h/2},data:{...child.data,rotation:Number(child.data.rotation??0)+patch.rotation-Number(current.data.rotation??0)}});
        }
      }
    });
    undoManager.stopCapturing();
  }, [nodesMap, readOnly, undoManager, ydoc]);

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
        names.map(name=>dataset.columns.find(column=>column.name.trim().toLowerCase()===name)?.id).find(Boolean);

      const titleColumnId =
        findColumn(titleCandidates) ??
        dataset.columns[0]?.id;
      const subtitleColumnId =
        findColumn(subtitleCandidates) ??
        dataset.columns.find(
          (column) =>
            column.id !== titleColumnId,
        )?.id;

      const nodeId = createId();
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

      node.position=canvasInsertionPosition(Array.from(nodesMap.values()),center,220,170);node.style={...node.style,height:170};node.zIndex=Math.max(0,...Array.from(nodesMap.values()).map(item=>Number(item.zIndex??0)))+1;
      undoManager.stopCapturing();nodesMap.set(nodeId, node);undoManager.stopCapturing();
      setNodes(current=>current.map(item=>({...item,selected:item.id===nodeId})));
      if(rf){const zoom=Math.max(.55,Math.min(1.2,rf.getZoom()));void rf.setCenter(node.position.x+110+100/zoom,node.position.y+85,{zoom,duration:200});}
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
      undoManager,
      setNodes,
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
      candidates.map(name=>dataset.columns.find(column=>column.name.trim().toLowerCase()===name)?.id).find(Boolean);

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
    visibleColumnIds,
  }: {
    parentNodeId: string;
    relation: DatasetRelation;
    dataset: DatasetSnapshot;
    row: DatasetRow;
    visibleColumnIds?:string[];
  }) => {
    if (readOnly) return false;

    const parent = nodesMap.get(parentNodeId) as Node | undefined;
    if (!parent) return false;

    const nodeId = `relation-view:${parentNodeId}:${relation.id}`;
    const existing=nodesMap.get(nodeId) as Node|undefined;
    if(existing){if(visibleColumnIds)nodesMap.set(nodeId,{...existing,data:{...existing.data,visibleColumnIds}});return false;}

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
        visibleColumnIds,
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
    const id = createId();
    const center = position ?? viewportCenter();
    undoManager.stopCapturing();
    nodesMap.set(id, {
      id,
      type: 'table',
      position: { x: center.x - 310, y: center.y - 150 },
      style: { width: 620, height: 300 },
      data: { datasetId },
    } satisfies Node);
    undoManager.stopCapturing();
  }, [nodesMap, readOnly, viewportCenter, undoManager, setNodes]);

  const addNode = useCallback((type: string) => {
    if (readOnly) return;
    const id = createId();
    const center = insertionPointRef.current ?? viewportCenter();
    insertionPointRef.current = null;

    let node: Node;

    if (type === 'sticky') {
      node = {
        id,
        type,
        position: { x: center.x - 120, y: center.y - 120 },
        style: { width: 240, height: 240 },
        data: { text: 'Новая заметка', fontFamily: 'Segoe Print, Comic Sans MS, cursive' },
      };
    } else if (type === 'shape') {
      node = {
        id,
        type,
        position: { x: center.x - (shapeKind === 'circle' ? 75 : 110), y: center.y - (shapeKind === 'circle' ? 75 : 55) },
        style: { width: shapeKind === 'circle' ? 150 : 220, height: shapeKind === 'circle' ? 150 : 110 },
        data: { text: 'Объект', shapeKind },
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
        position: { x: center.x - 120, y: center.y - 30 },
        style: { width: 240, height: 60 },
        data: { text: 'Текст', autoSize: true },
      };
    }

    undoManager.stopCapturing();
    nodesMap.set(id, node);
    undoManager.stopCapturing();
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })));
    setSelectedNodeIds([id]);
    setSelectedNodeId(id);
    setToolMode('select');
  }, [nodesMap, readOnly, viewportCenter, undoManager, setNodes, shapeKind]);

  const addDevice = useCallback((kind: DeviceKind) => {
    if (readOnly) return;

    const id = createId();
    const center = viewportCenter();
    const position=canvasInsertionPosition(Array.from(nodesMap.values()),center,220,170);

    undoManager.stopCapturing();
    nodesMap.set(id, {
      id,
      type: 'device',
      position,
      zIndex: Math.max(0,...Array.from(nodesMap.values()).map(node=>Number(node.zIndex??0)))+1,
      style: { width: 220, height: 170 },
      data: {
        deviceKind: kind,
        label: '',
      },
    } satisfies Node);
    undoManager.stopCapturing();

    setNodes((current)=>current.map((node)=>({...node,selected:node.id===id})));
    setSelectedNodeIds([id]);
    setSelectedNodeId(id);
    setDevicesOpen(false);setDatasetsOpen(false);setCommentsOpen(false);
    if(rf){const zoom=Math.max(.55,Math.min(1.2,rf.getZoom()));void rf.setCenter(position.x+110+100/zoom,position.y+85,{zoom,duration:200});}
    setToolMode('select');
  }, [nodesMap, readOnly, viewportCenter, undoManager, setNodes, rf]);

  const addTemplateNode = useCallback((templateId: string) => {
    if (readOnly) return;

    const template = workspaceTemplates.find(
      (item) => item.id === templateId,
    );
    if (!template) return;

    const id = createId();
    const center = viewportCenter();
    const height=Math.max(170,template.defaultHeight+54);
    const position=canvasInsertionPosition(Array.from(nodesMap.values()),center,template.defaultWidth,height);

    undoManager.stopCapturing();
    nodesMap.set(id, {
      id,
      type: 'template',
      position,
      zIndex:Math.max(0,...Array.from(nodesMap.values()).map(node=>Number(node.zIndex??0)))+1,
      style: {
        width: template.defaultWidth,
        height,
      },
      data: {
        templateId: template.id,
        label: template.name,
      },
    } satisfies Node);
    undoManager.stopCapturing();

    setNodes((current)=>current.map((node)=>({...node,selected:node.id===id})));
    setSelectedNodeIds([id]);
    setSelectedNodeId(id);
    setDevicesOpen(false);
    if(rf){const zoom=Math.max(.55,Math.min(1.2,rf.getZoom()));void rf.setCenter(position.x+template.defaultWidth/2+100/zoom,position.y+height/2,{zoom,duration:200});}
    setToolMode('select');
  }, [
    nodesMap,
    readOnly,
    viewportCenter,
    workspaceTemplates,
    undoManager,
    setNodes,
    rf,
  ]);

  const eraseGestureSegment = useCallback((gesture: Extract<DrawingGesture, { mode: 'eraser' }>, point: FreehandPoint) => {
    for (const node of nodesMap.values() as Iterable<Node>) {
      const stroke = canvasNodeStroke(node);
      if (!stroke) continue;
      if (gesture.erased.has(stroke.id)) continue;
      let cached = gesture.cache.get(stroke.id);
      if (!cached || cached.stroke !== node) {
        cached = { stroke: node, geometry: prepareFreehandStroke(stroke, gesture.zoom) };
        gesture.cache.set(stroke.id, cached);
      }
      if (eraserHitsStroke(stroke, gesture.lastPoint, point, gesture.zoom, cached.geometry)) {
        gesture.erased.set(stroke.id, node);
      }
    }
    gesture.lastPoint = point;
  }, [nodesMap]);

  const beginDrawing = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || !rf || event.button !== 0 || !event.isPrimary || drawingGestureRef.current ||
      (effectiveToolMode !== 'pen' && effectiveToolMode !== 'eraser')) return;
    event.preventDefault();
    const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    const base = { pointerId: event.pointerId, target: event.currentTarget, zoom: rf.getZoom() };
    const gesture: DrawingGesture = effectiveToolMode === 'pen'
      ? { ...base, mode: 'pen', stroke: { id: createId(), points: [point], width: penWidth,
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
      if (gesture.mode === 'pen') nodesMap.set(gesture.stroke.id, strokeCanvasNode(gesture.stroke));
      else for (const [id, original] of gesture.erased) {
        // Keep a stroke that another participant changed during the gesture.
        if (nodesMap.get(id) === original) nodesMap.delete(id);
      }
    });
    undoManager.stopCapturing();
    cancelDrawing();
  }, [cancelDrawing, eraseGestureSegment, readOnly, rf, nodesMap, undoManager, ydoc]);

  const cancelPointerDrawing = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (drawingGestureRef.current?.pointerId === event.pointerId) cancelDrawing();
  }, [cancelDrawing]);

  const handleFrameDragStart = useCallback(
    (_event: any, frame: Node, draggedNodes: Node[]) => {
      if (readOnly) return;
      undoManager.stopCapturing();
      const roots = new Set([frame.id, ...(draggedNodes ?? []).map((node) => node.id)]);
      const descendants = canvasDescendants(nodes, roots);
      const nodeIds = nodes.filter((node) => descendants.has(node.id) && !roots.has(node.id)).map((node) => node.id);
      frameDragRef.current = {
        frameId: frame.id,
        roots,
        startX: frame.position.x,
        startY: frame.position.y,
        positions: new Map(nodes.filter((node) => nodeIds.includes(node.id) || roots.has(node.id))
          .map((node) => [node.id, { ...node.position }])),
      };
    },
    [nodes, readOnly, selectedNodeIds, undoManager],
  );

  const handleFrameDrag = useCallback(
    (_event: any, frame: Node) => {
      const state = frameDragRef.current;
      if (!state || state.frameId !== frame.id) return;
      if (!modifiers.alt) {
        const moving = canvasDescendants(nodesRef.current, state.roots);
        const snapped = snapCanvasGuides(frame, nodesRef.current.filter((node) => !moving.has(node.id)), rf?.getZoom() ?? 1);
        const delta = { x: snapped.position.x-frame.position.x, y: snapped.position.y-frame.position.y };
        frame = { ...frame, position: snapped.position };
        setGuides(snapped.guides);
        setNodes((current) => current.map((node) => {
          if (state.roots.has(node.id)) {
            const position = { x: node.position.x+delta.x,y:node.position.y+delta.y };
            previewsRef.current.set(node.id,{position,dragging:true});
            return { ...node,position };
          }
          return node;
        }));
      } else setGuides([]);
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
    [setNodes, modifiers.alt, rf, selectedNodeIds],
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
    setGuides([]);
    undoManager.stopCapturing();
  }, [handleFrameDrag, nodesMap, undoManager, ydoc]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (placementPreview.current) {
      const preview = placementPreview.current;
      preview.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
      preview.style.visibility = (event.target as HTMLElement).closest('.react-flow__pane') ? 'visible' : 'hidden';
    }
    if (!provider || !rf) return;
    const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    provider.awareness?.setLocalStateField('cursor', point);
  }, [provider, rf]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if(readOnly){event.dataTransfer.dropEffect='none';return;}
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }, [readOnly]);

  const chooseFiles=async(files:File[],position?:{x:number;y:number})=>{
    if(readOnly||fileParsing||csvDrop)return;setFileParsing(true);setDropError('');
    try{const parsed=await parseImportFiles(files);setCsvDrop({parsed,position:position??viewportCenter()});setFilesOpen(false);}catch(error){setDropError(error instanceof Error?error.message:String(error));}finally{setFileParsing(false);}
  };
  const handleDrop=(event:React.DragEvent<HTMLDivElement>)=>{
    if(!event.dataTransfer.types.includes('Files'))return;
    event.preventDefault();setDropActive(false);if(readOnly)return;
    void chooseFiles(Array.from(event.dataTransfer.files),rf?.screenToFlowPosition({x:event.clientX,y:event.clientY}));
  };
  const placeImported=(result:ImportedFilesResult,parsed:ParsedFiles)=>{
    const start=csvDrop?.position??viewportCenter(),items:Node[]=[];
    undoManager.stopCapturing();ydoc.transact(()=>{
      for(const ds of result.datasets){const index=items.length,id=createId();const node:Node={id,type:'table',position:{x:start.x+(index%3)*660,y:start.y+Math.floor(index/3)*360},style:{width:620,height:300},data:{datasetId:ds.id}};nodesMap.set(id,node);items.push(node);}
      for(const [index,file] of result.files.entries()){const size=parsed.images[index],width=Math.min(Math.max(size?.width??300,80),480),height=Math.max(40,Math.min(400,width*(size?.height??200)/(size?.width??300)));const order=items.length;const node:Node={id:createId(),type:'image',position:{x:start.x+(order%3)*660,y:start.y+Math.floor(order/3)*460},style:{width,height},data:{assetId:file.id,name:file.name}};nodesMap.set(node.id,node);items.push(node);}
    });undoManager.stopCapturing();setCsvDrop(null);setToolMode('select');requestAnimationFrame(()=>void rf?.fitView({nodes:items,padding:.2,maxZoom:1}));
  };
  const placeFile=(file:StoredFile)=>{if(readOnly)return;const center=viewportCenter(),id=createId();undoManager.stopCapturing();nodesMap.set(id,{id,type:'image',position:center,style:{width:320,height:220},data:{assetId:file.id,name:file.name}});undoManager.stopCapturing();};

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

    if (navigationTarget.rowId && node.type==='table') {
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

  const showRelationOnCanvas=useCallback((relation:DatasetRelation)=>{
    if(readOnly)return;
    const center=viewportCenter(),items:Node[]=[];
    undoManager.stopCapturing();ydoc.transact(()=>{
      for(const [index,datasetId] of [relation.sourceDatasetId,relation.targetDatasetId].entries()){
        const id=`er-dataset:${datasetId}`;let node=Array.from(nodesMap.values()).find((n:any)=>n.type==='table'&&n.data?.datasetId===datasetId) as Node|undefined;
        if(!node){node={id,type:'table',position:{x:center.x-590+index*620,y:center.y-150},style:{width:540,height:300},data:{datasetId}};nodesMap.set(id,node);}items.push(node);
      }
      const id=`er-relation:${relation.id}`;edgesMap.set(id,{id,type:'smoothstep',source:items[0].id,target:items[1].id,sourceHandle:relation.matchMode==='ROW_LINKS'?'table:source':`source:${relation.sourceColumnId}`,targetHandle:relation.matchMode==='ROW_LINKS'?'table:target':`target:${relation.targetColumnId}`,markerEnd:{type:MarkerType.ArrowClosed},label:`${relation.name||relation.relationType} ${relation.cardinality??''}`,data:{relationId:relation.id,relationType:relation.relationType,cardinality:relation.cardinality}});
    });undoManager.stopCapturing();
    setDatasetsOpen(false);setSelectedNodeId(null);setToolMode('select');requestAnimationFrame(()=>void rf?.fitView({nodes:items,padding:.25,duration:300}));
  },[readOnly,viewportCenter,undoManager,ydoc,nodesMap,edgesMap,rf]);

  const closeInspector=useCallback(()=>setSelectedNodeId(null),[]);
  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;

  const handleSelectionChange = useCallback(({nodes:selection}: {nodes:Node[]}) => {
    const ids = selection.map((node) => node.id);
    setSelectedNodeIds((current) => current.length === ids.length && current.every((id, i) => id === ids[i]) ? current : ids);
    setSelectedNodeId(ids.length === 1 ? ids[0] : null);
  }, []);

  const remotePresence = presence.filter(([clientId, state]) =>
    clientId !== ydoc.clientID && state.user,
  );
  const boardActions = useMemo(() => ({
    readOnly, showRelationOnCanvas, keepAspectRatio: modifiers.shift,
    showTransformControls: effectiveToolMode === 'select',
    sessionToken: session.token, boardId: meta.id, workspaceId: meta.workspaceId,
    workspaceTemplates, refreshWorkspaceTemplates, updateNodeData,
    materializeRelated, createRelationView, hideMaterializedRelated,
    materializedRelatedCount,
    openDatasetSheet: (datasetId: string, rowId?: string) => setSheetTarget({ datasetId, rowId }),
    createBoundRowObject, navigateToDatasetLocation,
  }), [readOnly, showRelationOnCanvas, modifiers.shift, effectiveToolMode, session.token,
    meta.id, meta.workspaceId, workspaceTemplates, refreshWorkspaceTemplates,
    updateNodeData, materializeRelated, createRelationView, hideMaterializedRelated,
    materializedRelatedCount, createBoundRowObject, navigateToDatasetLocation]);

  return (
    <BoardActionsProvider
      value={boardActions}
    >
      <div
        className={`board-shell${objectsOpen ? ' has-objects-panel' : ''}`}
        onPointerDownCapture={(event) => {
          const target = event.target;
          if (!(target instanceof Element) || !target.closest('.react-flow__pane, .react-flow__node') ||
            target.closest('input, textarea, select, [contenteditable="true"]')) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable="true"]')) active.blur();
        }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => { if (placementPreview.current) placementPreview.current.style.visibility = 'hidden'; provider?.awareness?.setLocalStateField('cursor', null); }}
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
            <SessionTools provider={provider} connected={synced && status === 'connected'} role={meta.role} userId={session.user.id} nodes={nodes} rf={rf} />
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
            <span className={`connection-status connection-status--${status}`}>{status === 'connected' && pendingChanges > 0 ? 'saving' : status}</span>
            <span className="role-pill">{meta.role}</span>
          </div>
        </header>

        <ReactFlow
          className={`canvas-flow canvas-flow--${effectiveToolMode}`}
          nodes={nodes.filter((node) => !erasedStrokeIds.has(node.id))}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            setRf(instance);
            setCanvasZoom(instance.getZoom());
          }}
          onMoveStart={(event) => { closeContextMenu(); cancelDrawing(); if (event) window.dispatchEvent(new Event('modelboard:manual-navigation')); }}
          onMoveEnd={(_, viewport) => setCanvasZoom(viewport.zoom)}
          onNodeContextMenu={(event, node) => openContextMenu(event, node.id)}
          onSelectionContextMenu={(event, selection) => {
            if (selection[0]) openContextMenu(event, selection[0].id);
          }}
          onPaneContextMenu={(event) => openContextMenu(event)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          onNodeDragStart={handleFrameDragStart}
          onNodeDrag={handleFrameDrag}
          onNodeDragStop={handleFrameDragStop}
          onNodeDoubleClick={(_, node) => {
            if (node.type !== 'table') return;
            const datasetId = (node.data as any)?.datasetId as string | undefined;
            if (datasetId) setSheetTarget({ datasetId });
          }}
          onSelectionChange={handleSelectionChange}
          onPaneClick={(event) => {
            if ((effectiveToolMode === 'shape' || effectiveToolMode === 'text' || effectiveToolMode === 'sticky') && !readOnly && rf) {
              insertionPointRef.current = rf.screenToFlowPosition({ x:event.clientX, y:event.clientY }, {snapToGrid:false});
              addNode(effectiveToolMode);
            } else if (effectiveToolMode === 'select') clearSelection();
          }}
          onNodeClick={(_, node) => {
            if (effectiveToolMode !== 'connector' || readOnly) return;
            const start = connectorStartRef.current;
            if (!start) { connectorStartRef.current = node.id; setDropError('Выберите второй объект для соединения. Esc — отмена.'); }
            else if (start !== node.id) {
              onConnect({ source: start, target: node.id, sourceHandle: null, targetHandle: null });
              setDropError(''); activateTool('select');
            }
          }}
          nodesDraggable={!readOnly && effectiveToolMode === 'select'}
          nodesConnectable={!readOnly && effectiveToolMode === 'select'}
          elementsSelectable={effectiveToolMode === 'select' || effectiveToolMode === 'connector'}
          multiSelectionKeyCode="Shift"
          elevateNodesOnSelect={false}
          deleteKeyCode={null}
          snapToGrid={gridActive}
          snapGrid={[22, 22]}
          panOnScroll={trackpadMode}
          zoomOnScroll={!trackpadMode}
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
              <button title="Тачпад: прокрутка перемещает доску, pinch меняет масштаб" aria-pressed={trackpadMode}
                onClick={() => { setTrackpadMode((value) => { localStorage.setItem('modelboard:trackpad', String(!value)); return !value; }); }}>Тачпад</button>
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
            <div className="toolbar nowheel" tabIndex={0} aria-label="Инструменты доски">
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
                className={gridActive ? 'is-active' : ''}
                aria-pressed={gridActive}
                title="Привязка к сетке (Alt — временно отключить)"
                onClick={() =>
                  setSnapToGrid((value) => !value)
                }
              >
                <Grid3X3 size={17} />
              </button>
              <div className="toolbar-separator" />
              <button ref={objectsButtonRef} className={objectsOpen ? 'is-active' : ''}
                title="Объекты и слои" aria-label="Объекты и слои" aria-pressed={objectsOpen}
                onClick={() => { cancelDrawing(); setObjectsOpen((value) => !value); }}>
                <Layers3 size={19} />
              </button>
              <button title="Файлы и импорт/экспорт" onClick={()=>setFilesOpen(value=>!value)}><UploadCloud size={19}/></button>
              <button onClick={() => setDatasetsOpen(true)} title="Данные"><Database size={19} /></button>
              <button onClick={() => setDevicesOpen(true)} title="Инфраструктура"><Network size={19} /></button>
              <button disabled={readOnly} className={toolMode === 'sticky' ? 'is-active' : ''} onClick={() => activateTool('sticky')} title="Стикер"><StickyNote size={19} /></button>
<button className={toolMode === 'text' ? 'is-active' : ''} disabled={readOnly} onClick={() => activateTool('text')} title="Текст"><Type size={19} /></button>
<div className="shape-picker">
<button className={toolMode === 'shape' ? 'is-active' : ''} disabled={readOnly} onClick={() => activateTool('shape')} title="Фигура" onDoubleClick={()=>setShapeMenu(true)} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setShapeMenu(true);}}><Shapes size={19} /></button>
<button disabled={readOnly} className="shape-picker__arrow" title="Выбрать фигуру" aria-label="Выбрать фигуру" aria-expanded={shapeMenu} onClick={(event) => {event.stopPropagation();setShapeMenu(value => !value);}}><ChevronDown size={12}/></button>

</div>
              <button className={toolMode === 'connector' ? 'is-active' : ''} disabled={readOnly} onClick={() => activateTool('connector')} title="Коннектор (C)"><Network size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('frame')} title="Frame / секция"><FrameIcon size={19} /></button>
              <div className="toolbar-separator" />
              <button onClick={() => setCommentsOpen(true)} title="Комментарии"><MessageSquare size={19} /></button>
            </div>
          </Panel>

          {shapeMenu && <div className="shape-picker__menu" style={{position:'fixed',...shapeMenuPosition}} role="group" aria-label="Фигуры">{[['rectangle','Прямоугольник'],['triangle','Треугольник'],['circle','Круг'],['ellipse','Эллипс'],['diamond','Ромб']].map(([kind,label]) => <button key={kind} title={label} aria-label={label} aria-pressed={shapeKind === kind} onClick={() => { setShapeKind(kind); setShapeMenu(false); activateTool('shape'); }}><span className={`shape-swatch shape-swatch--${kind}`} /></button>)}</div>}
          {!readOnly && ['shape','sticky','text'].includes(effectiveToolMode) && <div ref={placementPreview} className={`placement-preview placement-preview--${effectiveToolMode} placement-preview--${shapeKind}`} aria-hidden="true" style={{ fontSize:effectiveToolMode==='sticky'?16*canvasZoom:undefined,padding:effectiveToolMode==='sticky'?20*canvasZoom:undefined, width: (effectiveToolMode === 'shape' ? (shapeKind === 'circle' ? 150 : 220) : 240) * canvasZoom, height: (effectiveToolMode === 'sticky' ? 240 : effectiveToolMode === 'text' ? 60 : shapeKind === 'circle' ? 150 : 110) * canvasZoom }}>{effectiveToolMode === 'sticky' ? 'Новая заметка' : effectiveToolMode === 'text' ? 'Текст' : ''}</div>}
          <ViewportPortal>
            <svg className="canvas-guides" aria-hidden="true">{guides.map((guide) => <line key={guide.axis} stroke="#e75bae" strokeWidth={1 / canvasZoom}
              x1={guide.axis === 'x' ? guide.value : -100000} x2={guide.axis === 'x' ? guide.value : 100000}
              y1={guide.axis === 'y' ? guide.value : -100000} y2={guide.axis === 'y' ? guide.value : 100000} />)}</svg>
            <svg
              className="freehand-layer"
              aria-hidden="true"
            >
              {(draftStroke ? [draftStroke] : []).map(
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
                data-user-id={state.user?.id}
                style={{ transform: `translate(${state.cursor.x}px, ${state.cursor.y}px)`, color: presenceColor(state.user?.id ?? String(clientId)), '--cursor-color': presenceColor(state.user?.id ?? String(clientId)) } as React.CSSProperties}
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

        {effectiveToolMode === 'select' && selectedNodeIds.length > 1 && !readOnly && (
          <CanvasSelectionActions
            key={selectedNodeIds.join(':')}
            count={selectedNodeIds.length}
            busy={nodes.some((node) => node.dragging || node.resizing)}
            onAlign={layoutSelection}
            onDistribute={layoutSelection}
            onLayer={changeSelectionLayer}
            onDuplicate={() => void duplicateSelection()}
            onFrame={() => wrapSelectionInFrame()}
            onGroup={() => wrapSelectionInFrame('group')}
            onUngroup={() => changeContainer('ungroup')}
            onAttach={() => changeContainer('attach')}
            onDetach={() => changeContainer('detach')}
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

            <ColorControl label="Цвет пера" value={penColor} disabled={toolMode!=='pen'} onChange={setPenColor}/>

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
              {...helpDialog}
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
                    <div><dt>Фигура / текст / коннектор</dt><dd>S / T / C</dd></div>
                    <div><dt>Группа / разгруппировать</dt><dd>Ctrl+G / Ctrl+Shift+G</dd></div>
                    <div><dt>Редактировать текст / отменить</dt><dd>Двойной клик / Esc</dd></div>
                    <div><dt>Выход из инструмента</dt><dd>Esc</dd></div>
                    <div><dt>Дополнительное выделение</dt><dd>Shift + клик</dd></div>
                    <div><dt>Resize с сохранением пропорций</dt><dd>Shift + маркер размера</dd></div>
                    <div><dt>Временно отключить сетку</dt><dd>Alt</dd></div>
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
              <strong>Перенесите файлы: таблицы, изображения или архив доски</strong>
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

        {fileParsing&&<div className="canvas-sync-banner" role="status">Чтение файлов и подготовка предпросмотра…</div>}
        {filesOpen&&<FilesPanel workspaceId={meta.workspaceId} boardId={meta.id} token={session.token} readOnly={readOnly} connected={synced&&status==='connected'&&pendingChanges===0} getState={()=>({nodes:Array.from(nodesMap.values()),edges:Array.from(edgesMap.values()),strokes:Array.from(strokesMap.values()).filter((stroke:any)=>!nodesMap.has(stroke.id))})} onChoose={files=>void chooseFiles(files)} onPlace={placeFile} onImageExport={format=>exportCanvasImage(nodes,meta.name,format)} onClose={()=>setFilesOpen(false)}/>}
        {csvDrop&&<FileImportDialog parsed={csvDrop.parsed} token={session.token} workspaceId={meta.workspaceId} onCancel={()=>setCsvDrop(null)} onImported={placeImported} onBoardImported={async id=>{setCsvDrop(null);await refreshWorkspaceTemplates();await onSwitchBoard(id);}}/>}

        {(!synced || status === 'disconnected') && <div className="canvas-sync-banner" role="status">{status === 'disconnected' ? 'Связь потеряна. Изменения остаются локально до восстановления соединения; не закрывайте вкладку.' : status === 'error' ? 'Не удалось подключиться к совместной доске. Проверьте доступ и перезагрузите страницу.' : 'Загрузка доски и подключение…'}</div>}
        {synced && nodes.length === 0 && <div className="canvas-empty">Добавьте фигуру, текст или устройство слева. V — выбор, H — рука, P — перо, ? — справка.
          {!readOnly && <button onClick={() => {
            if (nodesMap.size) return;
            const demo=createCanvasDemo(); undoManager.stopCapturing();
            ydoc.transact(()=>{ for(const node of demo.nodes) nodesMap.set(node.id,node); for(const edge of demo.edges) edgesMap.set(edge.id,edge); });
            undoManager.stopCapturing(); requestAnimationFrame(()=>requestAnimationFrame(()=>void rf?.fitView({padding:0.2,maxZoom:1})));
          }}>Пример инфраструктуры</button>}
        </div>}
        {readOnly && (
          <div className="readonly-banner">
            Board editing is read-only for {meta.role}. Comments follow the role policy.
          </div>
        )}

        {objectsOpen && (
          <CanvasObjectsPanel
            nodes={nodes.filter((node) => !erasedStrokeIds.has(node.id))}
            readOnly={readOnly}
            busy={nodes.some((node) => node.dragging || node.resizing)}
            onSelect={selectPanelObjects}
            onFocus={focusPanelObject}
            onLayer={changeSelectionLayer}
            onClose={closeObjectsPanel}
          />
        )}

        {!readOnly && selectedNodeIds.length===0 && edges.filter(edge=>edge.selected).length===1 && edges.filter(edge=>edge.selected).map(edge=><CanvasEdgeProperties key={edge.id} edge={edge} onChange={patch=>{const current=edgesMap.get(edge.id);if(!current)return;undoManager.stopCapturing();edgesMap.set(edge.id,{...current,...patch});undoManager.stopCapturing();}}/>)}
        {selectedNode && (
          <InspectorPanel
            node={selectedNode}
            boardId={meta.id}
            workspaceId={meta.workspaceId}
            token={session.token}
            readOnly={readOnly}
            onClose={closeInspector}
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

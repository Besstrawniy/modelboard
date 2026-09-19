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
import { Database, Hand, MessageSquare, MousePointer2, Network, Redo2, Shapes, StickyNote, Type, Undo2, UploadCloud, X } from 'lucide-react';
import {
  DEMO_ROLES_DATASET_ID,
  DEMO_USERS_DATASET_ID,
  canEditBoard,
  type AuthSession,
  type BoardMeta,
  type CreateDatasetInput,
  type DatasetRelation,
  type DatasetRelationCardinality,
  type DatasetRelationType,
  type DatasetRow,
  type DatasetSnapshot,
  type DeviceKind,
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

type PresenceState = {
  user?: { id: string; name: string; role: string };
  cursor?: { x: number; y: number } | null;
};

type CsvDropState = {
  parsed: ParsedCsv;
  position: { x: number; y: number };
};

type ToolMode = 'select' | 'hand';

const USERS_ROLE_ID_COLUMN = '41000000-0000-0000-0000-000000000003';
const ROLES_ID_COLUMN = '42000000-0000-0000-0000-000000000001';
const DEMO_RELATION_ID = '43000000-0000-0000-0000-000000000001';

const nodeTypes: any = {
  table: TableNode,
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  device: DeviceNode,
};

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

function BoardInner({ meta, session }: { meta: BoardMeta; session: AuthSession }) {
  const readOnly = !canEditBoard(meta.role);
  const ydoc = useMemo(() => new Y.Doc(), [meta.id, session.user.id]);
  const nodesMap = useMemo(() => ydoc.getMap<any>('nodes'), [ydoc]);
  const edgesMap = useMemo(() => ydoc.getMap<any>('edges'), [ydoc]);
  const undoManager = useMemo(
    () => new Y.UndoManager([nodesMap, edgesMap], { captureTimeout: 350 }),
    [edgesMap, nodesMap],
  );
  const initialSyncDone = useRef(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
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
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [historyTick, setHistoryTick] = useState(0);
  const [sheetTarget, setSheetTarget] = useState<{
    datasetId: string;
    rowId?: string;
  } | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);

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
        if (!readOnly && nodesMap.size === 0) {
          ydoc.transact(() => seedDocument(nodesMap, edgesMap));
        } else if (!readOnly) {
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

    const syncNodes = () => setNodes(Array.from(nodesMap.values()));
    const syncEdges = () => setEdges(Array.from(edgesMap.values()));
    nodesMap.observe(syncNodes);
    edgesMap.observe(syncEdges);
    syncNodes();
    syncEdges();

    return () => {
      nodesMap.unobserve(syncNodes);
      edgesMap.unobserve(syncEdges);
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

      if (event.key === 'Escape') {
        setSelectedNodeId(null);
        setPendingRelation(null);
        setToolMode('select');
      }

      if (event.key === 'v') setToolMode('select');
      if (event.key === 'h') setToolMode('hand');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly, undoManager]);

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
    persistNodeChanges(changes);
  }, [persistNodeChanges, readOnly]);

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
  }: {
    parentNodeId: string;
    relation: DatasetRelation;
    dataset: DatasetSnapshot;
    rows: DatasetRow[];
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

      createdNodes.push({
        id: childId,
        type: 'shape',
        position: {
          x: parent.position.x + 330 + columnIndex * 270,
          y: parent.position.y + verticalOffset,
        },
        style: { width: 220, height: 105 },
        data: {
          binding,
          generatedFrom: {
            parentNodeId,
            relationId: relation.id,
            rowId: row.id,
          },
        },
      });

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

  const hideMaterializedRelated = useCallback((
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
  }, [edgesMap, nodesMap, readOnly, ydoc]);

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
        updateNodeData,
        materializeRelated,
        hideMaterializedRelated,
        materializedRelatedCount,
        openDatasetSheet: (datasetId, rowId) =>
          setSheetTarget({ datasetId, rowId }),
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
          <div className="board-title">
            <strong>{meta.name}</strong>
            <span>{meta.workspaceName}</span>
          </div>
          <div className="presence-strip">
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
          onSelectionChange={({ nodes: selectedNodes }) =>
            setSelectedNodeId(selectedNodes[0]?.id ?? null)
          }
          onPaneClick={() => setSelectedNodeId(null)}
          nodesDraggable={!readOnly && toolMode === 'select'}
          nodesConnectable={!readOnly && toolMode === 'select'}
          elementsSelectable={toolMode === 'select'}
          deleteKeyCode={readOnly || toolMode !== 'select' ? null : ['Backspace', 'Delete']}
          fitView
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
                  setSelectedNodeId(null);
                  setToolMode('hand');
                }}
              >
                <Hand size={19} />
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

export function CollaborativeBoard(props: { meta: BoardMeta; session: AuthSession }) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}

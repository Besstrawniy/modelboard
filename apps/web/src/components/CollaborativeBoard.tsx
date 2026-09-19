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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, MessageSquare, MousePointer2, Shapes, StickyNote, Type, UploadCloud, X } from 'lucide-react';
import {
  DEMO_ROLES_DATASET_ID,
  DEMO_USERS_DATASET_ID,
  canEditBoard,
  type AuthSession,
  type BoardMeta,
  type CreateDatasetInput,
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

type PresenceState = {
  user?: { id: string; name: string; role: string };
  cursor?: { x: number; y: number } | null;
};

type CsvDropState = {
  parsed: ParsedCsv;
  position: { x: number; y: number };
};

const USERS_ROLE_ID_COLUMN = '41000000-0000-0000-0000-000000000003';
const ROLES_ID_COLUMN = '42000000-0000-0000-0000-000000000001';
const DEMO_RELATION_ID = '43000000-0000-0000-0000-000000000001';

const nodeTypes: any = {
  table: TableNode,
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
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
    ydoc,
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
    const edge: Edge = {
      ...connection,
      id: crypto.randomUUID(),
      type: 'smoothstep',
      label: connection.sourceHandle?.includes('source:') ? 'REFERENCE' : undefined,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { relationType: 'REFERENCE' },
    };
    setEdges((current) => addEdge(edge, current));
    edgesMap.set(edge.id, edge);
  }, [edgesMap, readOnly]);

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    if (readOnly) return;
    const current = nodesMap.get(nodeId) as Node | undefined;
    if (!current) return;
    nodesMap.set(nodeId, { ...current, data: { ...(current.data as any), ...patch } });
  }, [nodesMap, readOnly]);

  const placeDataset = useCallback((
    datasetId: string,
    position?: { x: number; y: number },
  ) => {
    if (readOnly) return;
    const id = crypto.randomUUID();
    nodesMap.set(id, {
      id,
      type: 'table',
      position: position ?? {
        x: 360 + Math.random() * 180,
        y: 220 + Math.random() * 180,
      },
      style: { width: 620, height: 300 },
      data: { datasetId },
    } satisfies Node);
  }, [nodesMap, readOnly]);

  const addNode = useCallback((type: string) => {
    if (readOnly) return;
    const id = crypto.randomUUID();
    const base = {
      id,
      type,
      position: { x: 360 + Math.random() * 140, y: 220 + Math.random() * 140 },
    };
    let node: Node;

    if (type === 'sticky') {
      node = { ...base, style: { width: 240, height: 160 }, data: { text: 'New note' } };
    } else if (type === 'shape') {
      node = { ...base, style: { width: 220, height: 110 }, data: { text: 'Process' } };
    } else {
      node = { ...base, data: { text: 'Text' } };
    }

    nodesMap.set(id, node);
  }, [nodesMap, readOnly]);

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

  const remotePresence = presence.filter(([clientId, state]) =>
    clientId !== ydoc.clientID && state.user,
  );

  return (
    <BoardActionsProvider
      value={{
        readOnly,
        sessionToken: session.token,
        updateNodeData,
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
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setRf}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          fitView
          panOnScroll
          selectionOnDrag
          panOnDrag={[1, 2]}
          minZoom={0.15}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <Controls />
          <MiniMap pannable zoomable />

          <Panel position="center-left" className="toolbar-panel">
            <div className="toolbar">
              <button title="Select"><MousePointer2 size={19} /></button>
              <div className="toolbar-separator" />
              <button onClick={() => setDatasetsOpen(true)} title="Datasets"><Database size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('sticky')} title="Sticky note"><StickyNote size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('text')} title="Text"><Type size={19} /></button>
              <button disabled={readOnly} onClick={() => addNode('shape')} title="Shape"><Shapes size={19} /></button>
              <div className="toolbar-separator" />
              <button onClick={() => setCommentsOpen(true)} title="Comments"><MessageSquare size={19} /></button>
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

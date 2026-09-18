# ModelBoard

ModelBoard is an early self-hosted MVP for a workspace that combines an infinite collaborative canvas with structured data tables and semantic relations.

The first vertical slice contains:

- React Flow infinite canvas.
- Table, sticky note, text and shape nodes.
- Column-level semantic connections between table nodes.
- Realtime CRDT synchronization with Yjs + Hocuspocus.
- Presence/awareness for connected users.
- Workspace roles: OWNER, EDITOR, COMMENTER, VIEWER.
- Server-enforced read-only realtime sessions for COMMENTER and VIEWER.
- REST comments: COMMENTER can comment while VIEWER is read-only.
- PostgreSQL storage for metadata, comments and persisted Yjs documents.
- Four seeded demo identities for testing access levels.

## Architecture

```text
apps/web     React + Vite + @xyflow/react + Yjs/Hocuspocus provider
apps/api     NestJS REST API for auth, board metadata, permissions, comments
apps/collab  Hocuspocus collaboration server with PostgreSQL persistence
packages/db  shared node-postgres connection helpers
packages/shared shared role/types/constants
PostgreSQL   relational metadata + Yjs binary state
```

The Yjs document is the source of truth for the live canvas surface. PostgreSQL relational tables remain the source of truth for workspace membership, permissions and data-model metadata. This avoids rebuilding a CRDT from JSON after every reconnect.

## Run locally

Requirements: Node.js 22+, npm 10+, Docker.

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run dev
```

Open `http://localhost:5173`.

The app shows a developer identity selector. Open the page in two browsers/incognito windows and select Owner/Editor to test simultaneous editing. Select Commenter or Viewer to verify read-only board access.

## Demo board

The seeded board id is:

```text
30000000-0000-0000-0000-000000000001
```

## Access model in v0.1

| Role | Edit board | Add comments | Manage access |
| --- | --- | --- | --- |
| OWNER | yes | yes | planned UI; server role exists |
| EDITOR | yes | yes | no |
| COMMENTER | no | yes | no |
| VIEWER | no | no | no |

The collaboration server checks membership itself and marks COMMENTER/VIEWER WebSocket sessions as read-only. This is intentionally server-side; hiding buttons in the frontend is only UX.

## Next slices

1. CSV drag/drop -> Data Table.
2. Dataset entity separate from table view, so the same dataset can appear on multiple boards.
3. Spreadsheet/fullscreen view, formulas and fill handle.
4. Freehand SVG drawing layer.
5. Object comments on canvas and comment pins.
6. Workspace/share management UI.
7. SQL schema import/export and ER mode.
8. History/snapshots.

## Planned semantic object bindings

A core direction for ModelBoard is binding canvas objects to structured data. A shape or imported infrastructure icon will be able to reference a dataset, stable row/entity, column, cell, or a relation-backed view. This allows a network diagram object such as a server to expose its current IP, related VMs, and services directly from linked tables, while changes to the source data propagate to every board that uses the same entity.

See [docs/OBJECT_BINDINGS.md](docs/OBJECT_BINDINGS.md) for the proposed model and network-diagram example.

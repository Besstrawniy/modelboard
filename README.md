# ModelBoard

ModelBoard is an early self-hosted MVP for a workspace that combines an infinite collaborative canvas with structured data tables and semantic relations.

## Current vertical slice

- React Flow infinite canvas.
- Sticky note, text, shape and dataset-backed table nodes.
- Independent collaborative datasets: a `TableNode` stores only a `datasetId`; rows and columns live in `dataset:<id>` Yjs documents.
- The same dataset can be placed on the same board multiple times and every view stays synchronized.
- Dataset documents are independent from board documents, so the same dataset can later be reused across different boards without copying data.
- Stable dataset, column and row IDs for future object/cell bindings.
- Column-level semantic connections between table views.
- Realtime CRDT synchronization with Yjs + Hocuspocus.
- Presence/awareness for connected users.
- Workspace roles: OWNER, EDITOR, COMMENTER, VIEWER.
- Server-enforced read-only realtime sessions for COMMENTER and VIEWER.
- REST comments: COMMENTER can comment while VIEWER is read-only.
- PostgreSQL storage for metadata and persisted Yjs documents.
- Dataset library panel with create/place actions.
- Four seeded demo identities for testing access levels.

## Architecture

```text
Board Yjs document
  board:<board-id>
      |
      +-- canvas nodes / positions / edges
      +-- TableNode { datasetId }

Dataset Yjs document
  dataset:<dataset-id>
      |
      +-- metadata
      +-- stable columns
      +-- stable rows / cell values

PostgreSQL
      |
      +-- users / workspaces / roles / boards
      +-- dataset metadata + bootstrap rows/columns
      +-- dataset_relations
      +-- object_bindings (schema reserved for later MVP)
      +-- persisted Yjs binary documents
```

Hocuspocus uses the PostgreSQL relational dataset rows only to bootstrap a dataset document when no CRDT state exists yet. After collaborative editing begins, the persisted Yjs binary is the live source of truth.

This separation is intentional: a board is a visual workspace; a dataset is reusable structured data.

## Run locally

Requirements: Node.js 22+, npm 10+, Docker.

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run dev
```

Open `http://localhost:5173`.

The app shows a developer identity selector. Open the page in two browsers/incognito windows and select Owner/Editor to test simultaneous editing.

### Important when upgrading from the first scaffold

The PostgreSQL bootstrap file now contains the seeded `users` and `roles` datasets. If you already started the old Docker volume before this change, recreate the development volume once:

```bash
docker compose down -v
docker compose up -d postgres
```

This is only for the current pre-migration MVP. Proper migrations will replace this before production use.

## Demo board

The seeded board id is:

```text
30000000-0000-0000-0000-000000000001
```

The demo board references these reusable datasets:

```text
users  -> 40000000-0000-0000-0000-000000000001
roles  -> 40000000-0000-0000-0000-000000000002
```

Open **Datasets**, place `users` a second time, then edit either view. Both TableNodes read the same `dataset:<id>` document.

## Access model

| Role | Edit board | Edit dataset | Add comments |
| --- | --- | --- | --- |
| OWNER | yes | yes | yes |
| EDITOR | yes | yes | yes |
| COMMENTER | no | no | yes |
| VIEWER | no | no | no |

Permissions are enforced by the realtime server for both `board:<id>` and `dataset:<id>` documents.

## Next slices

1. CSV drag/drop -> create a reusable Dataset and place a TableNode view.
2. Spreadsheet/fullscreen dataset view, formulas and fill handle.
3. Real Object Binding UI: shape/icon -> dataset row/cell/relation-backed view.
4. Freehand SVG drawing layer.
5. Object comments on canvas and comment pins.
6. Multiple boards + workspace navigation, proving cross-board dataset reuse in UI.
7. SQL schema import/export + ER relation editor.
8. History/snapshots.
9. Custom SVG/icon template libraries for infrastructure diagrams.

## Semantic object bindings

A core direction for ModelBoard is binding canvas objects to structured data. A shape or imported infrastructure icon will be able to reference a dataset, stable row/entity, column, cell, or a relation-backed view.

See [docs/OBJECT_BINDINGS.md](docs/OBJECT_BINDINGS.md) for the proposed model and network-diagram example.

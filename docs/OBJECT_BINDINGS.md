# Object Bindings

## Goal

ModelBoard canvas objects should be able to reference structured data instead of copying values into a diagram. A server icon, shape, label, table view, or other canvas object may be bound to a dataset, a stable row/entity, a column, a cell, or a relation-backed view.

This lets one dataset power several boards and several visual representations while keeping data consistent.

## Core rule: bind by identity, not displayed value

Do not bind a server icon to the literal text `172.168.16.2`. IP addresses, names, hostnames, and labels can change.

Every dataset row must have a stable internal `row_id`. Every column must have a stable internal `column_id`. A cell reference is therefore `(dataset_id, row_id, column_id)`.

Example:

- dataset `servers`
- row `srv_01` -> server whose current IP is `172.168.16.2`
- dataset `machines`
- rows `vm_10`, `vm_11` -> machines with IPs `172.168.16.10`, `172.168.16.11`
- relation `machines.server_id -> servers.id`

A server icon on the network board binds to `servers/srv_01`. From this binding ModelBoard can resolve related machines and services through dataset relations.

## Binding levels

A board object may bind to:

1. `DATASET` - the whole dataset/table.
2. `ROW` - one stable entity/record.
3. `COLUMN` - a field definition.
4. `CELL` - one value using stable row and column IDs.
5. `RELATION_VIEW` - related records reached through one or more semantic relations.

The most important default for infrastructure diagrams is `ROW`.

## Proposed model

```text
object_binding
--------------
id
board_object_id
binding_type        DATASET | ROW | COLUMN | CELL | RELATION_VIEW
dataset_id
row_id              nullable
column_id           nullable
relation_path       nullable / JSONB
presentation        JSONB
created_at
updated_at
```

Example binding for a server icon:

```json
{
  "bindingType": "ROW",
  "datasetId": "servers",
  "rowId": "srv_01",
  "presentation": {
    "label": "{{hostname}}",
    "subtitle": "{{ip_address}}",
    "hoverFields": ["hostname", "ip_address", "os", "location"],
    "relatedSections": [
      { "relation": "machines.server_id", "title": "Machines" },
      { "relation": "services.server_id", "title": "Services" }
    ]
  }
}
```

## Network diagram example

Structured data:

```text
servers
+----+------------+---------------+
| id | hostname   | ip_address    |
+----+------------+---------------+
| 1  | srv-main   | 172.168.16.2  |
+----+------------+---------------+

machines
+----+-----------+---------------+-----------+
| id | server_id | ip_address    | name      |
+----+-----------+---------------+-----------+
| 10 | 1         | 172.168.16.10 | vm-web    |
| 11 | 1         | 172.168.16.11 | vm-db     |
+----+-----------+---------------+-----------+

services
+----+------------+------+---------+
| id | machine_id | port | name    |
+----+------------+------+---------+
| 20 | 10         | 443  | nginx   |
| 21 | 11         | 5432 | postgres|
+----+------------+------+---------+
```

Canvas:

```text
             [ Server icon ]
               srv-main
             172.168.16.2
                   |
        bound to servers.row(1)
                   |
          +--------+---------+
          |                  |
     related VMs        related services
          |                  |
   172.168.16.10          nginx:443
   172.168.16.11          postgres:5432
```

The related objects do not need to be copied into the server shape. They can be resolved from table relations when needed.

## Interaction model

For a bound object:

- **Hover**: show a compact data card with selected fields and counts of related records.
- **Single click**: open an inspector panel with the full bound row and related records.
- **Open table**: navigate to the board/page where the dataset is displayed and highlight the referenced row/cell.
- **Show related on canvas**: create visual child nodes from related rows without duplicating the source data.
- **Pin field as label**: render fields such as `hostname`, `ip_address`, `port`, or `status` directly on the object.
- **Edit from inspector**: update the underlying dataset if the user has permission; every representation updates from the same data.

## Reusing data on multiple boards

The same entity can appear on several boards:

```text
Dataset row srv_01
       |
       +--> Network board: server icon
       +--> Rack board: rack-unit template
       +--> Architecture board: generic component node
       +--> Inventory board: table row
```

All are views of the same underlying entity.

This should also work for whole diagrams: a board or frame can be embedded/referenced on another board, while preserving a link back to the source board rather than cloning its data.

## Custom visual templates

A later MVP should support reusable object templates, especially SVG-based infrastructure/network icons.

A template should define visual appearance plus optional field slots:

```json
{
  "name": "Linux Server",
  "icon": "linux-server.svg",
  "bindings": {
    "title": "{{hostname}}",
    "subtitle": "{{ip_address}}",
    "badge": "{{status}}"
  }
}
```

Users should be able to import their own SVG/icon libraries and save configured objects as workspace templates, similar in spirit to custom shape libraries in diagramming tools.

## Why this matters

Object bindings are the bridge between the two halves of ModelBoard:

```text
VISUAL MODEL                STRUCTURED DATA
-------------               ---------------
server icon  <------------> servers row
VM icon      <------------> machines row
label        <------------> cell/field
edge         <------------> semantic relation
mini-table   <------------> relation-backed view
```

The canvas remains a real interactive whiteboard, but diagrams can become live views of structured data instead of static drawings.

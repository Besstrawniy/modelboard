import * as Y from 'yjs';

type RecordValue = Record<string, any>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);

function sharedValue(value: any): any {
  if (!record(value)) return value;
  const result = new Y.Map<any>();
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result.set(key, sharedValue(item));
  return result;
}

function patchMap(target: Y.Map<any>, before: RecordValue, next: RecordValue) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    const value = next[key];
    if (value === undefined) { if (target.has(key)) target.delete(key); continue; }
    const previous = before[key];
    const stored = target.get(key);
    if (record(value) && stored instanceof Y.Map) patchMap(stored, record(previous) ? previous : {}, value);
    else if (JSON.stringify(previous) !== JSON.stringify(value)) target.set(key, sharedValue(value));
  }
}

/** Upgrade persisted v0.1 objects before clients start editing them. No IDs or content change. */
export function normalizeCanvasNodes(document: Y.Doc, mapNames = ['nodes']) {
  for (const name of mapNames) {
  const nodes = document.getMap<any>(name);
  document.transact(() => {
    for (const [id, node] of nodes) if (!(node instanceof Y.Map) && record(node)) nodes.set(id,sharedValue(node));
  }, 'record-schema');
  }
}

/** Plain snapshots for React, field-level CRDT writes for concurrent independent edits. */
export class CanvasNodeStore {
  readonly type: Y.Map<any>;
  private cache = new Map<string, any>();
  private listeners = new Set<() => void>();
  constructor(document: Y.Doc, name = 'nodes') {
    this.type = document.getMap(name);
    this.type.observeDeep((events) => {
      for (const event of events) {
        if (event.target === this.type) for (const key of (event as Y.YMapEvent<any>).keysChanged) this.cache.delete(key);
        else if (typeof event.path[0] === 'string') this.cache.delete(event.path[0]);
      }
      for (const listener of this.listeners) listener();
    });
  }
  get size() { return this.type.size; }
  has(id: string) { return this.type.has(id); }
  get(id: string): any {
    if (!this.type.has(id)) return undefined;
    if (!this.cache.has(id)) {
      const node = this.type.get(id);
      this.cache.set(id,node instanceof Y.Map ? node.toJSON() : node);
    }
    return this.cache.get(id);
  }
  set(id: string, next: RecordValue) {
    const before = this.get(id);
    const stored = this.type.get(id);
    this.cache.delete(id);
    this.type.doc!.transact(() => {
      if (stored instanceof Y.Map) patchMap(stored,before ?? {},next);
      else this.type.set(id,sharedValue(next));
    });
  }
  delete(id: string) { this.cache.delete(id); return this.type.delete(id); }
  *entries(): IterableIterator<[string, any]> { for (const id of this.type.keys()) yield [id,this.get(id)]; }
  *values(): IterableIterator<any> { for (const id of this.type.keys()) yield this.get(id); }
  observe(listener: () => void) { this.listeners.add(listener); }
  unobserve(listener: () => void) { this.listeners.delete(listener); }
}

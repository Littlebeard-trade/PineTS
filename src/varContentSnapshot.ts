// Roll back the CONTENTS of var collections on streaming re-execution.
//
// _snapshotVarState keeps each var Series' last value, but arrays / maps / matrices / UDT
// instances are references mutated in place (push, shift, put, field :=), so a forming-bar
// re-run used to see the previous run's mutations (a var array grew by one element per tick).
// TradingView re-runs the bar from the exact pre-bar state. We record each reachable
// collection's contents at the snapshot point and restore them in place (same instances, so
// every other reference — other vars, drawing objects, UDT fields — stays valid).
// Drawing objects themselves are restored by the drawing helpers (drawingSnapshot.ts).
// Note: PineTS compiles `varip` as `var`, so varip collections roll back too (as varip scalars
// already did) — a known divergence from TradingView, where varip survives ticks.
import { PineArrayObject } from './namespaces/array/PineArrayObject';
import { PineMapObject } from './namespaces/map/PineMapObject';
import { PineMatrixObject } from './namespaces/matrix/PineMatrixObject';
import { PineTypeObject } from './namespaces/PineTypeObject';
import { ChartPointObject } from './namespaces/chart/ChartPointObject';

type Rec =
    | { kind: 'array'; obj: PineArrayObject; items: unknown[] }
    | { kind: 'map'; obj: PineMapObject; entries: [unknown, unknown][] }
    | { kind: 'matrix'; obj: PineMatrixObject; rows: unknown[][] }
    | { kind: 'udt'; obj: PineTypeObject; fields: Record<string, unknown> }
    | { kind: 'point'; obj: ChartPointObject; fields: { time: number | undefined; index: number | undefined; price: number } };

// No real depth limit is needed (the `seen` set stops cycles); the cap only guards pathological
// structures. QA round 2 found a 7-level chain escaping the old cap of 6.
const MAX_DEPTH = 256;

export function snapshotContents(value: unknown, out: Rec[], seen: Set<object>, depth = MAX_DEPTH): void {
    if (depth <= 0 || value === null || typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);
    if (value instanceof PineArrayObject) {
        const items = Array.isArray(value.array) ? value.array.slice() : [];
        out.push({ kind: 'array', obj: value, items });
        for (const it of items) snapshotContents(it, out, seen, depth - 1);
    } else if (value instanceof PineMapObject) {
        const entries = [...value.map.entries()];
        out.push({ kind: 'map', obj: value, entries });
        for (const [, v] of entries) snapshotContents(v, out, seen, depth - 1);
    } else if (value instanceof PineMatrixObject) {
        const rows = (value.matrix ?? []).map((r) => (Array.isArray(r) ? r.slice() : r));
        out.push({ kind: 'matrix', obj: value, rows });
        for (const r of rows) if (Array.isArray(r)) for (const c of r) snapshotContents(c, out, seen, depth - 1);
    } else if (value instanceof ChartPointObject) {
        out.push({ kind: 'point', obj: value, fields: { time: value.time, index: value.index, price: value.price } });
    } else if (value instanceof PineTypeObject) {
        const fields: Record<string, unknown> = {};
        for (const k of Object.keys(value.__def__ ?? {})) fields[k] = (value as any)[k];
        out.push({ kind: 'udt', obj: value, fields });
        for (const k of Object.keys(fields)) snapshotContents(fields[k], out, seen, depth - 1);
    }
}

export function restoreContents(recs: Rec[] | undefined): void {
    if (!recs) return;
    for (const r of recs) {
        switch (r.kind) {
            case 'array': {
                const a = r.obj.array as unknown[];
                a.length = 0;
                for (const x of r.items) a.push(x);
                break;
            }
            case 'map':
                r.obj.map.clear();
                for (const [k, v] of r.entries) r.obj.map.set(k, v);
                break;
            case 'matrix': {
                const m = r.obj.matrix;
                m.length = 0;
                for (const row of r.rows) m.push(Array.isArray(row) ? row.slice() : row);
                break;
            }
            case 'udt':
                for (const k of Object.keys(r.fields)) (r.obj as any)[k] = r.fields[k];
                break;
            case 'point':
                r.obj.time = r.fields.time;
                r.obj.index = r.fields.index;
                r.obj.price = r.fields.price;
                break;
        }
    }
}

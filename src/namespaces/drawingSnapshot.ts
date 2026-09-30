// TradingView rollback semantics for drawing objects on the forming bar.
//
// A streaming tick re-executes the last bar from the state it had BEFORE that bar ran
// (var state is snapshotted/restored for this). Drawings used to roll back only by removing
// objects CREATED on the bar; deletions and edits made on the bar to OLDER objects (.delete(),
// set_x2, set_text, cell updates…) stuck — and deleted objects were compacted away, so a
// script that trims old drawings (array.shift().delete()) lost one more group on every tick.
//
// Each helper now snapshots its objects (and their fields) right where the var snapshot is
// taken, and restores it on rollback to that bar: same object instances (so `var` arrays that
// hold them stay valid), fields reset, deleted ones back.

export type DrawingSnap<T extends object> = { bar: number; items: T[]; fields: Map<T, Record<string, unknown>> };

const isPlain = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Copy a field value: arrays and plain objects recursively (table cells are arrays of rows
 *  of plain cell objects); class instances (other drawing objects, Series) by reference. */
function copyValue(v: unknown, depth = 4): unknown {
    if (depth <= 0) return v;
    if (Array.isArray(v)) return v.map((x) => copyValue(x, depth - 1));
    if (isPlain(v)) {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v)) o[k] = copyValue(v[k], depth - 1);
        return o;
    }
    return v;
}

export function takeDrawingSnap<T extends object>(items: T[], bar: number): DrawingSnap<T> {
    const fields = new Map<T, Record<string, unknown>>();
    for (const obj of items) {
        const f: Record<string, unknown> = {};
        for (const k of Object.keys(obj)) f[k] = copyValue((obj as Record<string, unknown>)[k]);
        fields.set(obj, f);
    }
    return { bar, items: items.slice(), fields };
}

/** Put every snapshotted object back to its snapshotted fields; returns the snapshotted list. */
export function restoreDrawingSnap<T extends object>(snap: DrawingSnap<T>): T[] {
    for (const [obj, f] of snap.fields) {
        const o = obj as Record<string, unknown>;
        for (const k of Object.keys(o)) if (!(k in f)) delete o[k];
        for (const k of Object.keys(f)) o[k] = copyValue(f[k]);
    }
    return snap.items.slice();
}

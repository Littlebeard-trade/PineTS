// Regression: `m.add_row(array_id=a)` / `m.add_col(column=0, array_id=a)` with NAMED arguments
// reached the positional helper as one object and added an EMPTY row/column (columns() == 0),
// so `for g in m.row(r)` then iterated nothing (Pine "Pivot Points Standard" uses this form).
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const bars = Array.from({ length: 5 }, (_, i) => ({ openTime: Date.UTC(2026, 0, 5) + i * 3e5, closeTime: Date.UTC(2026, 0, 5) + (i + 1) * 3e5 - 1, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1 }));
const last = (ctx: any, title: string) => ctx.plots[title].data.at(-1).value;

describe('matrix add_row / add_col with named arguments', () => {
    it('add_row(array_id=) and add_row(row=, array_id=) add the values', async () => {
        const ctx: any = await new PineTS(bars as any).run(`//@version=6
indicator("t")
type G
    float v
var m = matrix.new<G>()
var f = matrix.new<float>()
if barstate.isfirst
    m.add_row(array_id=array.from(G.new(1), G.new(2)))
    f.add_row(row=0, array_id=array.from(1.0, 2.0, 3.0))
    matrix.add_row(f, array_id=array.from(4.0, 5.0, 6.0))
s = 0
for g in m.row(0)
    s += 1
plot(m.columns(), "mc")
plot(s, "s")
plot(f.columns(), "fc")
plot(f.rows(), "fr")
plot(f.get(1, 2), "f12")`);
        expect(last(ctx, 'mc')).toBe(2);
        expect(last(ctx, 's')).toBe(2);
        expect(last(ctx, 'fc')).toBe(3);
        expect(last(ctx, 'fr')).toBe(2);
        expect(last(ctx, 'f12')).toBe(6);
    });
    it('add_col(column=, array_id=) adds the values', async () => {
        const ctx: any = await new PineTS(bars as any).run(`//@version=6
indicator("t")
var f = matrix.new<float>(2, 1, 0)
if barstate.isfirst
    f.add_col(column=1, array_id=array.from(7.0, 8.0))
plot(f.columns(), "c")
plot(f.get(1, 1), "v")`);
        expect(last(ctx, 'c')).toBe(2);
        expect(last(ctx, 'v')).toBe(8);
    });
});

// Regression: on a streaming tick the forming bar re-executes from the state it had
// BEFORE it ran — including drawing objects. Deletions and edits made on that bar to older
// objects must be undone first (TradingView rollback semantics). Before the fix, a script that
// trims old drawings lost one more group on every tick, and accumulating edits compounded.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { BaseProvider } from '../../src/marketData/BaseProvider';

function makeBars(n: number) {
    const T0 = Date.UTC(2026, 0, 5, 14, 30);
    const out: any[] = [];
    let px = 100;
    for (let i = 0; i < n; i++) {
        const o = px;
        px += Math.sin(i / 3);
        out.push({ openTime: T0 + i * 60_000, closeTime: T0 + i * 60_000 + 59_999, open: o, high: Math.max(o, px) + 1, low: Math.min(o, px) - 1, close: px, volume: 10 });
    }
    return out;
}

class MemProvider extends BaseProvider {
    constructor(private bars: any[]) {
        super({ requiresApiKey: false, providerName: 'Mem' });
    }
    protected getSupportedTimeframes() {
        return new Set(['1']);
    }
    protected async _getMarketDataNative() {
        return this.bars.map((b) => ({ ...b }));
    }
    async getSymbolInfo(t: string) {
        return { ticker: t, mintick: 0.25, pointvalue: 1, timezone: 'UTC', session: '24x7' } as any;
    }
}

const live = (ctx: any, key: string) => {
    const d = ctx.plots[key]?.data ?? [];
    const v = d[d.length - 1]?.value;
    return Array.isArray(v) ? v.filter((o: any) => !o._deleted) : [];
};

/** Stream `src`, then apply `steps` (each mutates the bar array before the next poll). */
async function streamSteps(src: string, bars: any[], steps: Array<() => void>): Promise<any[]> {
    const pine = new PineTS(new MemProvider(bars) as any, 'T', '1', bars.length);
    const ctxs: any[] = [];
    await new Promise<void>((resolve, reject) => {
        const evt: any = pine.stream(src, { live: true, interval: 50, pageSize: bars.length });
        evt.on('data', (ctx: any) => {
            ctxs.push({ lines: live(ctx, '__lines__'), boxes: live(ctx, '__boxes__'), labels: live(ctx, '__labels__'), tables: live(ctx, '__tables__'), linefills: live(ctx, '__linefills__') });
            const step = steps[ctxs.length - 1];
            if (step) step();
            else { evt.stop(); resolve(); }
        });
        evt.on('error', (e: any) => { evt.stop(); reject(e); });
    });
    return ctxs;
}

/** Fresh (non-streaming) run over the same bars — what TradingView shows after a reload. */
async function freshRun(src: string, bars: any[]) {
    const ctx: any = await new PineTS(new MemProvider(bars.map((b) => ({ ...b }))) as any, 'T', '1', bars.length).run(src);
    return { lines: live(ctx, '__lines__'), labels: live(ctx, '__labels__'), linefills: live(ctx, '__linefills__'), tables: live(ctx, '__tables__') };
}
const lineKey = (l: any) => `${l.x1}|${l.y1}|${l.x2}|${l.y2}`;

const tick = (bars: any[], d = 0.25) => () => { const b = bars[bars.length - 1]; b.close += d; b.high = Math.max(b.high, b.close); };
const newBar = (bars: any[]) => () => { const l = bars[bars.length - 1]; bars.push({ ...l, openTime: l.openTime + 60_000, closeTime: l.closeTime + 60_000 }); };

describe('streaming rollback restores drawing objects', () => {
    it('keeps the trimmed-window size through ticks on a bar that deletes (lines)', async () => {
        const bars = makeBars(200);
        const src = `//@version=6
indicator("t", overlay=true, max_lines_count=500)
var line[] ls = array.new<line>()
if bar_index % 20 == 0
    for k = 0 to 2
        ls.push(line.new(bar_index, close + k, bar_index + 19, close + k))
    if ls.size() > 15
        for k = 0 to 2
            ls.shift().delete()
plot(close)`;
        // bar 200 creates a group and deletes the oldest; then tick it; then more new bars + ticks
        const steps = [newBar(bars), tick(bars), tick(bars), tick(bars), newBar(bars), tick(bars), newBar(bars), tick(bars)];
        const ctxs = await streamSteps(src, bars, steps);
        for (const c of ctxs) expect(c.lines.length).toBe(15);
        // and the SAME lines as a fresh run over the final bars (identity, not just count)
        const fresh = await freshRun(src, bars);
        expect(ctxs.at(-1).lines.map(lineKey).sort()).toEqual(fresh.lines.map(lineKey).sort());
    }, 20_000);

    it('rolls back var array / map / UDT contents on the forming bar', { timeout: 20_000 }, async () => {
        const bars = makeBars(20);
        const src = `//@version=6
indicator("t", overlay=true)
type Cnt
    int n = 0
var float[] a = array.new<float>()
var map<string, int> m = map.new<string, int>()
var Cnt c = Cnt.new()
a.push(close)
m.put("k" + str.tostring(bar_index), bar_index)
c.n += 1
var label lb = label.new(0, close, "")
lb.set_text(str.tostring(a.size()) + "/" + str.tostring(m.size()) + "/" + str.tostring(c.n))
plot(close)`;
        const ctxs = await streamSteps(src, bars, [tick(bars), tick(bars), tick(bars), newBar(bars), tick(bars)]);
        const t = (c: any) => c.labels[0]?.text;
        expect([t(ctxs[0]), t(ctxs[1]), t(ctxs[2]), t(ctxs[3])]).toEqual(['20/20/20', '20/20/20', '20/20/20', '20/20/20']);
        expect([t(ctxs[4]), t(ctxs[5])]).toEqual(['21/21/21', '21/21/21']);
    });

    it('rolls back deep nesting and chart.point edits (QA round 2)', { timeout: 20_000 }, async () => {
        const bars = makeBars(30);
        const src = `//@version=6
indicator("t", overlay=true)
type L4
    float[] a
type L3
    L4 x
type L2
    L3 x
type L1
    L2 x
type L0
    L1 x
var L0[] root = array.from(L0.new(L1.new(L2.new(L3.new(L4.new(array.new<float>()))))))
root.get(0).x.x.x.x.a.push(close)
var chart.point p = chart.point.from_index(0, 0)
p.price := p.price + 1
var label lb = label.new(0, close, "")
lb.set_text(str.tostring(root.get(0).x.x.x.x.a.size()) + "/" + str.tostring(p.price))
plot(close)`;
        const ctxs = await streamSteps(src, bars, [tick(bars), tick(bars), tick(bars)]);
        for (const c of ctxs) expect(c.labels[0]?.text).toBe('30/30');
    });

    it('snapshots when the last history page is a single bar', async () => {
        const bars = makeBars(99);
        const src = `//@version=6
indicator("t", overlay=true)
var label lb = label.new(0, close, "x")
lb.set_text(lb.get_text() + "y")
plot(close)`;
        const pine = new PineTS(new MemProvider(bars) as any, 'T', '1', bars.length);
        const texts: string[] = [];
        await new Promise<void>((resolve, reject) => {
            const evt: any = pine.stream(src, { live: true, interval: 50, pageSize: 7 }); // 99 = 14*7 + 1
            evt.on('data', () => {});
            const seen: string[] = [];
            evt.on('data', (ctx: any) => {
                const lab = live(ctx, '__labels__')[0];
                if (lab) seen.push(lab.text);
                if (seen.length >= 17) { texts.push(...seen.slice(-3)); evt.stop(); resolve(); }
                else if (seen.length >= 15) tick(bars)();
            });
            evt.on('error', (e: any) => { evt.stop(); reject(e); });
        });
        for (const x of texts) expect(x).toBe('x' + 'y'.repeat(99));
    });

    it('keeps boxes and undoes box edits made on the forming bar', async () => {
        const bars = makeBars(120);
        const src = `//@version=6
indicator("t", overlay=true, max_boxes_count=500)
var box[] bx = array.new<box>()
if bar_index % 20 == 0
    bx.push(box.new(bar_index, high, bar_index + 19, low))
    if bx.size() > 3
        bx.shift().delete()
if bx.size() > 0
    b0 = bx.get(0)
    b0.set_top(b0.get_top() + 1)
plot(close)`;
        const ctxs = await streamSteps(src, bars, [tick(bars), tick(bars), tick(bars)]);
        const tops = ctxs.map((c) => c.boxes.map((b: any) => b.top).sort().join(','));
        for (const c of ctxs) expect(c.boxes.length).toBe(3);
        // set_top(+1) on the forming bar must not compound across re-executions
        expect(new Set(tops).size).toBe(1);
    });

    it('does not compound label text edits across ticks', async () => {
        const bars = makeBars(50);
        const src = `//@version=6
indicator("t", overlay=true)
var label lb = label.new(0, close, "x")
lb.set_text(lb.get_text() + "y")
plot(close)`;
        const ctxs = await streamSteps(src, bars, [tick(bars), tick(bars), newBar(bars), tick(bars)]);
        const text = (c: any) => c.labels[0]?.text as string;
        // after the history run: "x" + one "y" per bar (50)
        expect(text(ctxs[0])).toBe('x' + 'y'.repeat(50));
        expect(text(ctxs[1])).toBe('x' + 'y'.repeat(50));
        expect(text(ctxs[2])).toBe('x' + 'y'.repeat(50));
        expect(text(ctxs[3])).toBe('x' + 'y'.repeat(51)); // new bar: one more
        expect(text(ctxs[4])).toBe('x' + 'y'.repeat(51));
    });

    it('does not compound table cell edits across ticks', async () => {
        const bars = makeBars(30);
        const src = `//@version=6
indicator("t", overlay=true)
var table tb = table.new(position.top_right, 1, 1)
var int n = 0
n += 1
tb.cell(0, 0, str.tostring(n))
plot(close)`;
        const ctxs = await streamSteps(src, bars, [tick(bars), tick(bars)]);
        const cellText = (c: any) => JSON.stringify(c.tables[0]).match(/"text":"(\d+)"/)?.[1];
        expect(cellText(ctxs[0])).toBe('30');
        expect(cellText(ctxs[1])).toBe('30');
        expect(cellText(ctxs[2])).toBe('30');
    });
    it('re-initializes vars first created on the forming bar (var table/line inside barstate.islast, lazy counters)', async () => {
        const bars = makeBars(50);
        const src = `//@version=6
indicator("t", overlay=true)
f() =>
    var int n = 0
    n += 1
    n
if barstate.islast
    var table t = table.new(position.top_right, 1, 1)
    table.cell(t, 0, 0, "x")
    var line l = line.new(bar_index - 5, close, bar_index, close)
    l.set_xy2(bar_index, close)
    var int c = 0
    c += 1
    label.new(bar_index, close, str.tostring(c) + "/" + str.tostring(f()))
plot(close)`;
        const steps = [tick(bars), tick(bars), newBar(bars), tick(bars), tick(bars)];
        const ctxs = await streamSteps(src, bars, steps);
        for (const c of ctxs) {
            expect(c.tables.length).toBe(1);
            expect(c.lines.length).toBe(1);
            expect(c.labels.map((x: any) => x.text)).toEqual(['1/1']);
        }
    }, 20_000);
    it('rolls back function-argument history (x[1] inside a function) on the forming bar', async () => {
        const bars = makeBars(50);
        const src = `//@version=6
indicator("t")
f(x) => x - x[1]
g(int k) => k[1]
plot(f(close * 2), "d")
plot(g(bar_index * 3), "g")`;
        const pine = new PineTS(new MemProvider(bars) as any, 'T', '1', bars.length);
        const got: any[] = [];
        const steps = [tick(bars), tick(bars), newBar(bars), tick(bars)];
        await new Promise<void>((resolve, reject) => {
            const evt: any = pine.stream(src, { live: true, interval: 50, pageSize: bars.length });
            evt.on('data', (ctx: any) => {
                got.push({ d: ctx.plots['d'].data.at(-1).value, g: ctx.plots['g'].data.at(-1).value, bars: bars.map((b) => ({ ...b })) });
                const step = steps[got.length - 1];
                if (step) step();
                else { evt.stop(); resolve(); }
            });
            evt.on('error', (e: any) => { evt.stop(); reject(e); });
        });
        for (const e of got) {
            const fresh: any = await new PineTS(new MemProvider(e.bars) as any, 'T', '1', e.bars.length).run(src);
            expect(e.d).toBeCloseTo(fresh.plots['d'].data.at(-1).value, 9);
            expect(e.g).toBe(fresh.plots['g'].data.at(-1).value);
        }
    }, 20_000);

    // Upstream #382 semantics (line.delete deletes the line's linefills; a new table replaces the
    // one at its position) flip `_deleted` on OLDER objects from the forming bar; the rollback
    // must undo those flips too, or every tick loses one more linefill / table.
    it('undoes the linefill cascade and the one-table-per-position replacement on the forming bar', async () => {
        const bars = makeBars(201); // last bar_index 200: a bar that creates + trims
        const src = `//@version=6
indicator("t", overlay=true)
var line[] ls = array.new<line>()
if bar_index % 10 == 0
    l1 = line.new(bar_index, close, bar_index + 5, close)
    l2 = line.new(bar_index, close - 1, bar_index + 5, close - 1)
    linefill.new(l1, l2, color.red)
    ls.push(l1)
    ls.push(l2)
    if ls.size() > 6
        ls.shift().delete()
        ls.shift().delete()
t = table.new(position.top_right, 1, 1)
t.cell(0, 0, str.tostring(bar_index))
`;
        const ctxs = await streamSteps(src, bars, [tick(bars), tick(bars), tick(bars)]);
        const fresh: any = await freshRun(src, bars);
        expect(fresh.linefills.length).toBe(3);
        expect(fresh.tables.length).toBe(1);
        for (const c of ctxs) {
            expect(c.lines.length).toBe(6);
            expect(c.linefills.length).toBe(3);
            expect(c.tables.length).toBe(1);
            expect(c.tables[0].cells[0][0].text).toBe('200');
        }
        expect(ctxs.at(-1).lines.map(lineKey).sort()).toEqual(fresh.lines.map(lineKey).sort());
    });
});

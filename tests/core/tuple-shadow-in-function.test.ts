// Regression: a tuple destructured anywhere in the script (`[h, l] = f()`) must not change
// how same-named locals inside OTHER functions compile. Before the fix, `h = high[1]` inside a
// function was mistaken for a tuple pick and compiled to `$.get($.let.high, 0)[1]`, reading the
// wrong value / throwing "Cannot read properties of undefined (reading '1')".
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { transpile } from '../../src/transpiler';

const bars = Array.from({ length: 40 }, (_, i) => {
    const o = 100 + Math.sin(i / 3) * 5 + (i % 4);
    const c = o + ((i % 3) - 1) * 1.5;
    return { openTime: Date.UTC(2026, 0, 5, 14, 30) + i * 60_000, closeTime: Date.UTC(2026, 0, 5, 14, 31) + i * 60_000 - 1,
        open: o, high: Math.max(o, c) + 1 + (i % 5) * 0.25, low: Math.min(o, c) - 1 - (i % 2) * 0.5, close: c, volume: 10 + i };
});

const SRC = `//@version=5
indicator("tuple shadow")
g(n) =>
    h = high[1]
    l = low[1]
    for i = 1 to n
        if low[i] < l
            l := low[i]
        if high[i] > h
            h := high[i]
    [h, l]
[h, l] = g(3)
plot(h, "h")
plot(l, "l")
`;

describe('tuple names do not leak into function-local declarations', () => {
    it('compiles high[1] inside the function as a series lookback', () => {
        const code = transpile(SRC, { debug: false }).toString();
        expect(code).not.toContain('$.get($.let.high, 0)[1]');
        expect(code).not.toContain('$.get($.let.low, 0)[1]');
        expect(code).toMatch(/\$\.get\(high, 1\)/);
    });

    it('returns max(high[1..3]) / min(low[1..3]) per bar', async () => {
        const ctx = await new PineTS(bars as any).run(SRC);
        const hs = ctx.plots['h'].data.map((d: any) => d.value);
        const ls = ctx.plots['l'].data.map((d: any) => d.value);
        for (let i = 3; i < bars.length; i++) {
            const H = Math.max(bars[i - 1].high, bars[i - 2].high, bars[i - 3].high);
            const L = Math.min(bars[i - 1].low, bars[i - 2].low, bars[i - 3].low);
            expect(hs[i]).toBeCloseTo(H, 8);
            expect(ls[i]).toBeCloseTo(L, 8);
        }
    });

    it('still unpacks real tuples by position', async () => {
        const src = `//@version=5
indicator("tuple")
f() =>
    [close + 1, close - 1]
[a, b] = f()
plot(a, "a")
plot(b, "b")
`;
        const ctx = await new PineTS(bars as any).run(src);
        const last = bars[bars.length - 1].close;
        expect(ctx.plots['a'].data.at(-1).value).toBeCloseTo(last + 1, 8);
        expect(ctx.plots['b'].data.at(-1).value).toBeCloseTo(last - 1, 8);
    });
});

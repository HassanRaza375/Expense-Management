import { describe, expect, it } from "vitest";
import { singleFlight, type RunOptions } from "../app/lib/sync/singleFlight";

/** A run that finishes when the test says so. */
function controlled() {
  const started: RunOptions[] = [];
  const finishers: Array<() => void> = [];
  const run = (opts: RunOptions) =>
    new Promise<void>((resolve) => {
      started.push(opts);
      finishers.push(resolve);
    });
  return { run, started, finish: (i: number) => finishers[i]!() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("singleFlight", () => {
  it("runs at once when nothing is running, and says when it is done", async () => {
    const c = controlled();
    const f = singleFlight(c.run);
    const done = f.request();
    expect(f.running).toBe(true);
    expect(c.started).toHaveLength(1);
    c.finish(0);
    await done;
    expect(f.running).toBe(false);
  });

  it("never runs two at the same time", async () => {
    const c = controlled();
    const f = singleFlight(c.run);
    void f.request();
    void f.request();
    void f.request();
    await tick();
    expect(c.started).toHaveLength(1);
  });

  it("a request that arrives during a run is NOT lost: exactly one more run follows it, however many arrived", async () => {
    const c = controlled();
    const f = singleFlight(c.run);
    const first = f.request();
    const second = f.request(); // e.g. "back online"
    const third = f.request(); // e.g. a change typed
    c.finish(0);
    await tick();
    expect(c.started).toHaveLength(2); // the one rerun, shared by both
    c.finish(1);
    await Promise.all([first, second, third]);
    expect(c.started).toHaveLength(2);
    expect(f.running).toBe(false);
  });

  it("a request made after everything finished starts a fresh run", async () => {
    const c = controlled();
    const f = singleFlight(c.run);
    const a = f.request();
    c.finish(0);
    await a;
    const b = f.request();
    expect(c.started).toHaveLength(2);
    c.finish(1);
    await b;
  });

  it("the options of merged requests are combined: confirming held deletions is never swallowed by a plain request", async () => {
    const c = controlled();
    const f = singleFlight(c.run);
    void f.request();
    void f.request({ allowMassDelete: true });
    void f.request(); // a later plain request must not undo it
    c.finish(0);
    await tick();
    expect(c.started[1]).toEqual({ allowMassDelete: true });
  });

  it("a run that fails does not stop later requests (and the failure is the run's own to report)", async () => {
    const runs: number[] = [];
    let n = 0;
    const f = singleFlight(async () => {
      runs.push(++n);
      if (n === 1) throw new Error("offline");
    });
    await f.request();
    await f.request();
    expect(runs).toEqual([1, 2]);
    expect(f.running).toBe(false);
  });

  it("a request during a failing run still gets its rerun", async () => {
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = singleFlight(async () => {
      n++;
      if (n === 1) {
        await gate;
        throw new Error("boom");
      }
    });
    const first = f.request();
    void f.request();
    release();
    await first;
    expect(n).toBe(2);
  });
});

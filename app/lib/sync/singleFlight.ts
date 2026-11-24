// One sync run at a time, but never a LOST request: a request that arrives while a run is in progress (a change typed, "back online", the tab becoming visible)
// asks for one more run right after it, because the run in progress may have read the data before that change. Several requests during one run share that one rerun.
// Options of the requests that were merged are combined (`allowMassDelete` stays true if any request asked for it). Pure: the run itself is injected.

export interface RunOptions {
  allowMassDelete?: boolean;
}

export function singleFlight(run: (opts: RunOptions) => Promise<void>) {
  let current: Promise<void> | null = null;
  let again: RunOptions | null = null;

  const start = (opts: RunOptions): Promise<void> => {
    const p = run(opts)
      .catch(() => undefined) // a failed run is reported by `run` itself; the loop below must go on
      .then(() => {
        current = null;
        if (again) {
          const next = again;
          again = null;
          return start(next);
        }
        return undefined;
      });
    current = p;
    return p;
  };

  return {
    /** Runs now, or after the run in progress. Resolves when the request's run is finished. */
    request(opts: RunOptions = {}): Promise<void> {
      if (!current) return start(opts);
      again = { allowMassDelete: Boolean(again?.allowMassDelete || opts.allowMassDelete) };
      return current;
    },
    get running(): boolean {
      return current !== null;
    },
  };
}

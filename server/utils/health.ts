// What /api/health answers. Pure over an injected probe, so unit tests run it without a database.
//   - sync off:  200 { ok: true, sync: false, database: "not_checked" }, and NO database is touched (the flag-off build must work with no database at all)
//   - sync on, no DATABASE_URL:  503 { ok: false, sync: true, database: "unconfigured" }
//   - sync on, probe fails or takes too long:  503 { ok: false, sync: true, database: "down" }   (the reason goes to the server log, never to the caller)
//   - sync on, probe answers:  200 { ok: true, sync: true, database: "up" }
export interface Health {
  status: 200 | 503;
  body: { ok: boolean; sync: boolean; database: "not_checked" | "unconfigured" | "down" | "up" };
}

export interface HealthDeps {
  syncOn: boolean;
  hasDatabase: boolean;
  /** resolves when the database answered; rejects otherwise */
  probe: () => Promise<unknown>;
  /** called with the failure, for the server log (it must redact; see dbFailureLine) */
  onFailure?: (err: unknown) => void;
  timeoutMs?: number;
}

export async function checkHealth(d: HealthDeps): Promise<Health> {
  if (!d.syncOn) return { status: 200, body: { ok: true, sync: false, database: "not_checked" } };
  if (!d.hasDatabase) return { status: 503, body: { ok: false, sync: true, database: "unconfigured" } };
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database check timed out")), d.timeoutMs ?? 4000);
    });
    try {
      await Promise.race([d.probe(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return { status: 200, body: { ok: true, sync: true, database: "up" } };
  } catch (err) {
    d.onFailure?.(err);
    return { status: 503, body: { ok: false, sync: true, database: "down" } };
  }
}

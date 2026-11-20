import { setResponseStatus } from "h3";
import { apiHandler, syncOn } from "../utils/api";
import { hasDatabase, useDb } from "../utils/db";
import { dbFailureLine } from "../utils/dbConfig";
import { checkHealth } from "../utils/health";

// With sync off this touches no database. With it on it runs one trivial query and answers up/down/unconfigured; details go to the log, never to the caller.
export default apiHandler(async (event) => {
  const on = syncOn(event);
  const result = await checkHealth({
    syncOn: on,
    hasDatabase: hasDatabase(),
    probe: () => useDb().$queryRaw`SELECT 1`,
    onFailure: (err) => console.error(dbFailureLine(err, process.env.DATABASE_URL)),
  });
  setResponseStatus(event, result.status);
  return result.body;
});

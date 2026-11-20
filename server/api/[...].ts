import { apiHandler, jsonError } from "../utils/api";

// Any /api/ address that has no route is a JSON 404. Without this the SPA renderer answers an unknown /api/ path with the app shell and status 200.
export default apiHandler(() => {
  throw jsonError(404, "not_found");
});

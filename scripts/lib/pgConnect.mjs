// Connecting to PostgreSQL from a script. Used by scripts/seed-super-admin.mjs and scripts/live/*. Prints nothing and never turns a certificate check off.
//   - the CA comes from DATABASE_CA_CERT or DATABASE_CA_FILE: a path, PEM text, or the bare base64 body of the certificate;
//   - `?schema=name` in the URL (Prisma's convention) selects the schema the script works in.
import pg from "pg";
import { readFileSync } from "node:fs";

const BARE = /^[A-Za-z0-9+/=\s]{200,}$/;

/** The CA as PEM text, or "" when none is configured. */
export function readCa(env = process.env) {
  let ca = env.DATABASE_CA_CERT || "";
  const f = env.DATABASE_CA_FILE;
  if (!ca && f) ca = /-----BEGIN CERTIFICATE-----/.test(f) || BARE.test(f.trim()) ? f : readFileSync(f, "utf8");
  ca = ca.replace(/\n/g, "\n").trim();
  if (ca && !ca.includes("-----BEGIN") && BARE.test(ca)) {
    const body = ca.replace(/\s+/g, "");
    ca = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`;
  }
  return ca;
}

/** pg client options for the URL: with a CA, trust exactly it and keep checking the host name. */
export function clientConfig(url, env = process.env) {
  const config = { connectionString: url, max: 1, connectionTimeoutMillis: 15000 };
  const ca = readCa(env);
  if (ca) {
    const u = new URL(url);
    for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"]) u.searchParams.delete(k);
    config.connectionString = u.toString();
    config.ssl = { ca: ca + "\n", rejectUnauthorized: true };
  }
  return config;
}

/** The schema named by `?schema=` in the URL (a plain identifier), or "public". */
export function schemaOf(url) {
  try {
    const s = new URL(url).searchParams.get("schema");
    return s && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(s) ? s : "public";
  } catch {
    return "public";
  }
}

/** A connected client whose search_path is the URL's schema. */
export async function connect(url, env = process.env) {
  const client = new pg.Client(clientConfig(url, env));
  await client.connect();
  const schema = schemaOf(url);
  if (schema !== "public") await client.query(`SET search_path TO "${schema}"`);
  return client;
}

/** A short, secret-free description of a connection failure. */
export function describeFailure(e) {
  const code = e && typeof e === "object" && "code" in e ? String(e.code) : "unknown";
  const hint = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) ? " The server's certificate is not trusted: give the project's CA as DATABASE_CA_CERT (PEM) or DATABASE_CA_FILE. Certificate checks are never switched off." : "";
  return `could not connect (code ${code}).${hint}`;
}

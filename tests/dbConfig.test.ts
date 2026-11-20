import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DbConfigError, POOL, dbFailureLine, describeDbError, normaliseCa, poolConfig, resolveCa } from "../server/utils/dbConfig";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
const URL_WITH_SSL = "postgres://app_user:p%40ss%2Fword@db-host-1.example.aivencloud.com:12345/hisaab_test?sslmode=require&connect_timeout=5";

describe("poolConfig", () => {
  it("without a CA returns the URL as it is, with the one-connection pool", () => {
    const c = poolConfig(URL_WITH_SSL);
    expect(c.connectionString).toBe(URL_WITH_SSL);
    expect(c.ssl).toBeUndefined();
    expect(c.max).toBe(1);
    expect(c).toMatchObject(POOL);
  });

  it("with a CA trusts exactly that CA, still checks the host name, and strips the URL's SSL parameters so they cannot override it", () => {
    const c = poolConfig(URL_WITH_SSL, PEM);
    expect(c.ssl).toEqual({ ca: PEM + "\n", rejectUnauthorized: true });
    const u = new URL(c.connectionString);
    expect(u.searchParams.has("sslmode")).toBe(false);
    expect(u.searchParams.get("connect_timeout")).toBe("5"); // unrelated parameters stay
    expect(u.pathname).toBe("/hisaab_test");
  });

  it("refuses text that is not a PEM certificate", () => {
    expect(() => poolConfig(URL_WITH_SSL, "not a certificate")).toThrow(DbConfigError);
  });
});

describe("normaliseCa / resolveCa", () => {
  it("accepts PEM with real newlines or with \\n escapes (as a dashboard keeps it on one line)", () => {
    expect(normaliseCa(PEM)).toBe(PEM + "\n");
    expect(normaliseCa(PEM.replace(/\n/g, "\\n"))).toBe(PEM + "\n");
    expect(normaliseCa(PEM.replace(/\n/g, "\r\n"))).toBe(PEM + "\n");
  });

  it("prefers DATABASE_CA_CERT, reads DATABASE_CA_FILE when that is all there is, and is undefined with neither", () => {
    const read = (p: string) => `file:${p}`;
    expect(resolveCa({ DATABASE_CA_CERT: PEM, DATABASE_CA_FILE: "/x.pem" }, read)).toBe(PEM);
    expect(resolveCa({ DATABASE_CA_FILE: "/x.pem" }, read)).toBe("file:/x.pem");
    expect(resolveCa({}, read)).toBeUndefined();
    expect(resolveCa({ DATABASE_CA_CERT: "", DATABASE_CA_FILE: "" }, read)).toBeUndefined();
  });

  it("says plainly when the CA file cannot be read (without the path)", () => {
    try {
      resolveCa({ DATABASE_CA_FILE: "/secret/place/ca.pem" }, () => {
        throw new Error("ENOENT /secret/place/ca.pem");
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DbConfigError);
      expect(String((e as Error).message)).not.toContain("/secret/place");
    }
  });
});

describe("describeDbError never leaks the connection details", () => {
  const err = Object.assign(new Error(`Can't reach database server at db-host-1.example.aivencloud.com:12345 (user app_user, password p@ss/word) postgres://app_user:p%40ss%2Fword@db-host-1.example.aivencloud.com:12345/hisaab_test`), {
    code: "P1001",
    cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:12345 for app_user@db-host-1"), { code: "ECONNREFUSED" }),
  });
  const line = describeDbError(err, URL_WITH_SSL);

  it("keeps the error codes", () => {
    expect(line).toContain("P1001");
    expect(line).toContain("ECONNREFUSED");
  });

  it("removes the host, the user, the password in every form, and any postgres URI", () => {
    for (const secret of ["db-host-1", "aivencloud", "app_user", "p@ss/word", "p%40ss%2Fword", "postgres://"]) expect(line, secret).not.toContain(secret);
  });

  it("is short and starts with the health tag in dbFailureLine", () => {
    expect(line.length).toBeLessThan(400);
    expect(dbFailureLine(err, URL_WITH_SSL)).toMatch(/^\[health\] database unreachable: code=/);
  });

  it("copes with odd values", () => {
    expect(describeDbError("just a string", undefined)).toContain("just a string");
    expect(describeDbError(null, URL_WITH_SSL)).toContain("code=unknown");
  });
});

describe("certificate checks are never turned off", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (n === "generated" || n === "node_modules") return [];
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") || p.endsWith(".mjs") ? [p] : [];
    });
  const files = [...walk(fileURLToPath(new URL("../server", import.meta.url))), ...walk(fileURLToPath(new URL("../scripts", import.meta.url)))];

  it("no server file or script sets rejectUnauthorized to false or disables TLS verification", () => {
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/rejectUnauthorized\s*:\s*false/);
      expect(src, f).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    }
  });
});

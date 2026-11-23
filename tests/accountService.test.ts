import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES, type ServiceError, deleteAccount, profileOf, removeAvatar, saveAvatar, sniffImage, type AccountRepo, type AccountUser, type AuditEntry } from "../server/utils/accountService";
import { avatarPublicId, avatarUrl, cloudinaryConfig, mediaRoot, parseCloudinaryUrl, userPrefix, type MediaStore } from "../server/utils/media";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 1, 0, 0, 0, ...Buffer.from("WEBP")]);

const user = (over: Partial<AccountUser> = {}): AccountUser => ({ id: "u-1", email: "Me@Example.test", name: "Me", role: "user", avatarPublicId: null, avatarVersion: null, ...over });

function fakes(opts: { superAdmins?: number; deleteFiles?: () => Promise<number>; destroy?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const audit: AuditEntry[] = [];
  const avatars = new Map<string, [string | null, number | null]>();
  const repo: AccountRepo = {
    countSuperAdmins: async () => opts.superAdmins ?? 2,
    deleteUser: async (id) => void calls.push(`deleteUser:${id}`),
    setAvatar: async (id, p, v) => void (calls.push(`setAvatar:${id}:${p}`), avatars.set(id, [p, v])),
    audit: async (e) => void audit.push(e),
  };
  const uploads: Array<{ publicId: string; type: string; size: number }> = [];
  const media: MediaStore = {
    cloudName: "democloud",
    root: "hisaab-test",
    uploadImage: async (a) => (uploads.push({ publicId: a.publicId, type: a.type, size: a.bytes.length }), calls.push("upload"), { publicId: a.publicId, version: 7, bytes: a.bytes.length }),
    destroy: opts.destroy ?? (async () => void calls.push("destroy")),
    deleteByPrefix: opts.deleteFiles ?? (async (p) => (calls.push(`deleteByPrefix:${p}`), 3)),
  };
  return { repo, media, calls, audit, uploads, avatars };
}

describe("sniffImage reads the bytes, not the claimed type", () => {
  it("recognises JPEG, PNG and WebP", () => {
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(WEBP)).toBe("image/webp");
  });
  it("refuses everything else: text, HTML, SVG, GIF, PDF, empty, truncated", () => {
    for (const bytes of ["hello", "<html><script>alert(1)</script>", '<svg xmlns="http://www.w3.org/2000/svg"/>', "GIF89a....", "%PDF-1.7", ""]) expect(sniffImage(Buffer.from(bytes)), bytes).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array([...Buffer.from("RIFF"), 1, 0, 0, 0, ...Buffer.from("WAVE")]))).toBeNull();
  });
});

describe("media helpers", () => {
  it("parses CLOUDINARY_URL and falls back to the three variables", () => {
    expect(parseCloudinaryUrl("cloudinary://KEY:SEC%2Fret@mycloud")).toEqual({ api_key: "KEY", api_secret: "SEC/ret", cloud_name: "mycloud" });
    for (const bad of [undefined, "", "https://x", "cloudinary://onlykey@cloud", "cloudinary://:@"]) expect(parseCloudinaryUrl(bad), String(bad)).toBeNull();
    expect(cloudinaryConfig({ CLOUDINARY_URL: "cloudinary://k:s@c" })).toEqual({ api_key: "k", api_secret: "s", cloud_name: "c" });
    expect(cloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" })).toEqual({ cloud_name: "c", api_key: "k", api_secret: "s" });
    expect(cloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "c" })).toBeNull();
    expect(cloudinaryConfig({})).toBeNull();
  });
  it("keeps every file of a user under one folder inside one root", () => {
    expect(mediaRoot({})).toBe("hisaab");
    expect(mediaRoot({ CLOUDINARY_FOLDER: "/hisaab-test/" })).toBe("hisaab-test");
    expect(userPrefix("hisaab", "u-1")).toBe("hisaab/u/u-1");
    expect(avatarPublicId("hisaab", "u-1")).toBe("hisaab/u/u-1/avatar");
    expect(avatarPublicId("hisaab", "u-1").startsWith(userPrefix("hisaab", "u-1") + "/")).toBe(true);
    // a prefix of one user is never a prefix of another (u-1 vs u-10)
    expect(avatarPublicId("hisaab", "u-10").startsWith(userPrefix("hisaab", "u-1") + "/")).toBe(false);
  });
  it("builds a square-crop URL with the version", () => {
    expect(avatarUrl("c", "hisaab/u/1/avatar", 7, 64)).toBe("https://res.cloudinary.com/c/image/upload/c_fill,g_auto,w_64,h_64,f_auto,q_auto/v7/hisaab/u/1/avatar");
    expect(avatarUrl("c", "p", null)).not.toContain("/v");
  });
});

describe("profileOf", () => {
  it("returns only what the browser may see", () => {
    const p = profileOf({ ...user(), avatarPublicId: "hisaab/u/u-1/avatar", avatarVersion: 3, password: "HASH", token: "T" } as AccountUser, { cloudName: "c" });
    expect(Object.keys(p).sort()).toEqual(["avatarUrl", "email", "id", "name", "role"]);
    expect(p.avatarUrl).toContain("res.cloudinary.com/c/");
    expect(JSON.stringify(p)).not.toMatch(/HASH|"T"/);
  });
  it("has no photo URL without a photo or without a media store", () => {
    expect(profileOf(user(), { cloudName: "c" }).avatarUrl).toBeNull();
    expect(profileOf(user({ avatarPublicId: "x" }), null).avatarUrl).toBeNull();
  });
});

describe("saveAvatar", () => {
  it("stores a valid picture under the user's own folder, as public delivery, and records it", async () => {
    const f = fakes();
    const out = await saveAvatar(f, user(), PNG);
    expect(f.uploads).toEqual([{ publicId: "hisaab-test/u/u-1/avatar", type: "upload", size: PNG.length }]);
    expect(f.avatars.get("u-1")).toEqual(["hisaab-test/u/u-1/avatar", 7]);
    expect(out.avatarUrl).toContain("/v7/hisaab-test/u/u-1/avatar");
    expect(f.calls).toEqual(["upload", "setAvatar:u-1:hisaab-test/u/u-1/avatar"]); // upload first: the database never points at a file that is not there
  });
  it("refuses: no media store (503), empty (400), too large (413), not an image (415), and touches nothing", async () => {
    const f = fakes();
    const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: ServiceError) => `${e.status}:${e.code}`);
    expect(await code(saveAvatar({ repo: f.repo, media: null }, user(), PNG))).toBe("503:media_unavailable");
    expect(await code(saveAvatar(f, user(), new Uint8Array()))).toBe("400:empty_file");
    expect(await code(saveAvatar(f, user(), new Uint8Array(MAX_AVATAR_BYTES + 1).fill(0xff)))).toBe("413:photo_too_large");
    expect(await code(saveAvatar(f, user(), Buffer.from("<svg onload=alert(1)>")))).toBe("415:not_an_image");
    expect(f.calls).toEqual([]);
  });
  it("accepts exactly the size limit", async () => {
    const big = new Uint8Array(MAX_AVATAR_BYTES);
    big.set(JPEG);
    await expect(saveAvatar(fakes(), user(), big)).resolves.toBeTruthy();
  });
});

describe("removeAvatar", () => {
  it("clears the database first, then the remote file", async () => {
    const f = fakes();
    const out = await removeAvatar(f, user({ avatarPublicId: "hisaab-test/u/u-1/avatar", avatarVersion: 7 }));
    expect(f.calls).toEqual(["setAvatar:u-1:null", "destroy"]);
    expect(out.avatarUrl).toBeNull();
  });
  it("does nothing when there is no photo", async () => {
    const f = fakes();
    await removeAvatar(f, user());
    expect(f.calls).toEqual([]);
  });
  it("a failed remote delete is not an error for the user; it is written to the audit log", async () => {
    const f = fakes({ destroy: async () => Promise.reject(new Error("cloudinary down https://secret")) });
    await expect(removeAvatar(f, user({ avatarPublicId: "x", avatarVersion: 1 }))).resolves.toBeTruthy();
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]!.action).toBe("media.cleanup_failed");
    expect(JSON.stringify(f.audit)).not.toContain("secret");
  });
});

describe("deleteAccount", () => {
  it("needs the user's own email typed exactly (case and spaces around it do not matter)", async () => {
    for (const bad of [undefined, null, "", "someone@else.test", "me@example", 5, {}, "Me@Example.test.evil"]) {
      const f = fakes();
      await expect(deleteAccount(f, user(), bad)).rejects.toMatchObject({ status: 400, code: "confirmation_mismatch" });
      expect(f.calls).toEqual([]); // nothing was deleted anywhere
    }
    const f = fakes();
    await expect(deleteAccount(f, user(), "  me@example.TEST ")).resolves.toMatchObject({ deleted: true });
  });
  it("deletes the database rows first, then every remote file under the user's folder", async () => {
    const f = fakes();
    const out = await deleteAccount(f, user(), "me@example.test");
    expect(f.calls).toEqual(["deleteUser:u-1", "deleteByPrefix:hisaab-test/u/u-1"]);
    expect(out).toEqual({ deleted: true, filesRemoved: 3, cleanup: "done" });
  });
  it("the remote clean-up uses only the deleted user's folder (never a shorter prefix)", async () => {
    const f = fakes();
    await deleteAccount(f, user({ id: "u-1" }), "me@example.test");
    const prefix = f.calls.find((c) => c.startsWith("deleteByPrefix:"))!.split(":")[1]!;
    expect(prefix).toBe("hisaab-test/u/u-1");
    expect(prefix.endsWith("/u/")).toBe(false);
  });
  it("if the remote clean-up fails the account is still gone and the failure is recorded for the owner", async () => {
    const f = fakes({ deleteFiles: async () => Promise.reject(new Error("network")) });
    const out = await deleteAccount(f, user(), "me@example.test");
    expect(out).toMatchObject({ deleted: true, cleanup: "failed" });
    expect(f.calls).toEqual(["deleteUser:u-1"]);
    expect(f.audit).toEqual([expect.objectContaining({ action: "media.cleanup_failed", targetId: "u-1", summary: { prefix: "hisaab-test/u/u-1" } })]);
  });
  it("without a media store the database rows are still removed", async () => {
    const f = fakes();
    const out = await deleteAccount({ repo: f.repo, media: null }, user(), "me@example.test");
    expect(out.cleanup).toBe("skipped");
    expect(f.calls).toEqual(["deleteUser:u-1"]);
  });
  it("the last super admin cannot delete themself; one of several can", async () => {
    const only = fakes({ superAdmins: 1 });
    await expect(deleteAccount(only, user({ role: "superadmin" }), "me@example.test")).rejects.toMatchObject({ status: 409, code: "last_super_admin" });
    expect(only.calls).toEqual([]);
    await expect(deleteAccount(fakes({ superAdmins: 2 }), user({ role: "superadmin" }), "me@example.test")).resolves.toMatchObject({ deleted: true });
    await expect(deleteAccount(fakes({ superAdmins: 1 }), user({ role: "user" }), "me@example.test")).resolves.toMatchObject({ deleted: true });
  });
});

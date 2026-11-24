// Cloudinary, behind a small interface so the rest of the server (and every test) never touches the real service.
//   - credentials come from CLOUDINARY_URL (cloudinary://key:secret@cloud) or the three CLOUDINARY_* variables, read at request time;
//   - everything Hisaab stores lives under one root folder (CLOUDINARY_FOLDER, default "hisaab"; the live checks use "hisaab-test" so they can leave it clean):
//       <root>/u/<userId>/avatar        the profile photo (public delivery, unguessable because the user id is random)
//       <root>/u/<userId>/receipts/...  receipts (Phase 6: private "authenticated" delivery, short-lived signed URLs after an ownership check)
//   - the account's files are found by that prefix, so deleting an account can remove every one of them.
import { v2 as cloudinary } from "cloudinary";
import type { Env } from "./authConfig";

export type DeliveryType = "upload" | "authenticated";

export interface Uploaded {
  publicId: string;
  version: number;
  bytes: number;
}

export interface MediaStore {
  cloudName: string;
  /** The root folder every file of this deployment lives under. */
  root: string;
  uploadImage(args: { publicId: string; bytes: Buffer; type: DeliveryType }): Promise<Uploaded>;
  /** a receipt (a photo or a PDF) in PRIVATE delivery: it can only be reached through a signed, short-lived address */
  uploadReceipt(args: { publicId: string; bytes: Buffer }): Promise<Uploaded>;
  /** a signed address for a private file that stops working after `expiresInSeconds` */
  signedUrl(publicId: string, opts: { format: string; expiresInSeconds: number }): string;
  /** every private receipt file under the prefix */
  listReceipts(prefix: string): Promise<Array<{ publicId: string; bytes: number }>>;
  destroy(publicId: string, type: DeliveryType): Promise<void>;
  /** Removes every file under the prefix (both delivery types). Returns how many were removed. */
  deleteByPrefix(prefix: string): Promise<number>;
}

export interface CloudinaryConfig {
  cloud_name: string;
  api_key: string;
  api_secret: string;
}

/** `cloudinary://<key>:<secret>@<cloud>` to its parts, or null. */
export function parseCloudinaryUrl(url: string | undefined): CloudinaryConfig | null {
  if (!url) return null;
  const m = /^cloudinary:\/\/([^:@/\s]+):([^@/\s]+)@([^/?\s]+)/.exec(url.trim());
  return m ? { api_key: decodeURIComponent(m[1]!), api_secret: decodeURIComponent(m[2]!), cloud_name: m[3]! } : null;
}

export function cloudinaryConfig(env: Env): CloudinaryConfig | null {
  const fromUrl = parseCloudinaryUrl(env.CLOUDINARY_URL);
  if (fromUrl) return fromUrl;
  const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = env;
  return cloud_name && api_key && api_secret ? { cloud_name, api_key, api_secret } : null;
}

export const mediaRoot = (env: Env): string => (env.CLOUDINARY_FOLDER || "hisaab").replace(/^\/+|\/+$/g, "");

/** The folder of one user's files. The id is the account's random id, never an email. */
export const userPrefix = (root: string, userId: string): string => `${root}/u/${userId}`;
export const receiptsPrefix = (root: string, userId: string): string => `${userPrefix(root, userId)}/receipts`;
export const receiptPublicId = (root: string, userId: string, receiptId: string): string => `${receiptsPrefix(root, userId)}/${receiptId}`;
/** the receipt id of a public id under the receipts folder (the last path segment) */
export const receiptIdOf = (publicId: string): string => publicId.slice(publicId.lastIndexOf("/") + 1);
export const avatarPublicId = (root: string, userId: string): string => `${userPrefix(root, userId)}/avatar`;

/** The public URL of a profile photo: a square crop at the requested size. */
export function avatarUrl(cloudName: string, publicId: string, version: number | null | undefined, size = 128): string {
  const v = version ? `v${version}/` : "";
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,g_auto,w_${size},h_${size},f_auto,q_auto/${v}${publicId}`;
}

/** The real store, or null when Cloudinary is not configured (the routes answer 503 "media_unavailable"). */
export function cloudinaryStore(env: Env): MediaStore | null {
  const cfg = cloudinaryConfig(env);
  if (!cfg) return null;
  const use = () => cloudinary.config({ ...cfg, secure: true });
  return {
    cloudName: cfg.cloud_name,
    root: mediaRoot(env),
    async uploadImage({ publicId, bytes, type }) {
      use();
      const res = await new Promise<{ public_id: string; version: number; bytes: number }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ public_id: publicId, type, resource_type: "image", overwrite: true, invalidate: true }, (err, result) => (err || !result ? reject(err ?? new Error("no result")) : resolve(result)));
        stream.end(bytes);
      });
      return { publicId: res.public_id, version: res.version, bytes: res.bytes };
    },
    async uploadReceipt({ publicId, bytes }) {
      use();
      const res = await new Promise<{ public_id: string; version: number; bytes: number }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ public_id: publicId, type: "authenticated", resource_type: "image", overwrite: true, invalidate: true }, (err, result) => (err || !result ? reject(err ?? new Error("no result")) : resolve(result)));
        stream.end(bytes);
      });
      return { publicId: res.public_id, version: res.version, bytes: res.bytes };
    },
    signedUrl(publicId, { format, expiresInSeconds }) {
      use();
      return cloudinary.utils.private_download_url(publicId, format, { type: "authenticated", resource_type: "image", expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds });
    },
    async listReceipts(prefix) {
      use();
      const out: Array<{ publicId: string; bytes: number }> = [];
      let next: string | undefined;
      do {
        const r = (await cloudinary.api.resources({ type: "authenticated", resource_type: "image", prefix, max_results: 500, ...(next ? { next_cursor: next } : {}) })) as { resources: Array<{ public_id: string; bytes: number }>; next_cursor?: string };
        for (const x of r.resources) out.push({ publicId: x.public_id, bytes: x.bytes });
        next = r.next_cursor;
      } while (next);
      return out;
    },
    async destroy(publicId, type) {
      use();
      await cloudinary.uploader.destroy(publicId, { type, resource_type: "image", invalidate: true });
    },
    async deleteByPrefix(prefix) {
      use();
      let removed = 0;
      for (const type of ["upload", "authenticated"] as const) {
        for (const resource_type of ["image", "raw"] as const) {
          const r = (await cloudinary.api.delete_resources_by_prefix(prefix, { type, resource_type, invalidate: true })) as { deleted?: Record<string, string> };
          removed += Object.values(r.deleted ?? {}).filter((s) => s === "deleted").length;
        }
      }
      try {
        await cloudinary.api.delete_folder(prefix);
      } catch {
        /* the folder may be gone already or still hold a file; the files are what matters */
      }
      return removed;
    },
  };
}

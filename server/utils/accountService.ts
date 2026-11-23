// What an account can do to itself: profile photo and deletion. Pure logic over two small interfaces (the repository and the media store), so unit tests run it
// with fakes and never reach the database or Cloudinary. The routes in server/api/account/* only add the session check and translate a ServiceError to JSON.
import { avatarPublicId, avatarUrl, type MediaStore, userPrefix } from "./media";

export const MAX_AVATAR_BYTES = 512 * 1024; // the browser sends a 512 x 512 JPEG of ~50-150 KB; anything bigger is not what the app sends

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarPublicId?: string | null;
  avatarVersion?: number | null;
}

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId: string | null;
  actorId: string | null;
  actorEmail?: string | null;
  summary: Record<string, unknown>;
}

export interface AccountRepo {
  countSuperAdmins(): Promise<number>;
  /** Removes the user; the database cascades to sessions, sign-in methods, sync records and the cursor. */
  deleteUser(id: string): Promise<void>;
  setAvatar(id: string, publicId: string | null, version: number | null): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface Deps {
  repo: AccountRepo;
  media: MediaStore | null;
}

/** The kind of image a file is, from its first bytes (the browser's own claim of a type is never trusted). */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** What the browser is told about the signed-in account. No hash, no token, no other user's data. */
export function profileOf(user: AccountUser, media: Pick<MediaStore, "cloudName"> | null) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarPublicId && media ? avatarUrl(media.cloudName, user.avatarPublicId, user.avatarVersion) : null,
  };
}

export async function saveAvatar({ repo, media }: Deps, user: AccountUser, bytes: Uint8Array) {
  if (!media) throw new ServiceError(503, "media_unavailable");
  if (bytes.length === 0) throw new ServiceError(400, "empty_file");
  if (bytes.length > MAX_AVATAR_BYTES) throw new ServiceError(413, "photo_too_large");
  if (!sniffImage(bytes)) throw new ServiceError(415, "not_an_image");
  const up = await media.uploadImage({ publicId: avatarPublicId(media.root, user.id), bytes: Buffer.from(bytes), type: "upload" });
  await repo.setAvatar(user.id, up.publicId, up.version);
  return profileOf({ ...user, avatarPublicId: up.publicId, avatarVersion: up.version }, media);
}

export async function removeAvatar({ repo, media }: Deps, user: AccountUser) {
  if (user.avatarPublicId) {
    // the database first (the photo is gone for the user at once); a failed remote delete is logged for the owner, never shown as an error
    await repo.setAvatar(user.id, null, null);
    if (media) {
      try {
        await media.destroy(user.avatarPublicId, "upload");
      } catch {
        await repo.audit({ action: "media.cleanup_failed", targetType: "user", targetId: user.id, actorId: user.id, summary: { what: "avatar" } });
      }
    }
  }
  return profileOf({ ...user, avatarPublicId: null, avatarVersion: null }, media);
}

/**
 * Deletes the account. The user must type their own email exactly; the last super admin cannot delete themself.
 * Order: the database rows first (one cascading delete: the account is gone), then the remote files. If the remote clean-up fails the account is still deleted and the
 * failure is written to the audit log (it has no foreign key to the user) so the owner can remove the folder by hand.
 */
export async function deleteAccount({ repo, media }: Deps, user: AccountUser, confirm: unknown) {
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== user.email.toLowerCase()) throw new ServiceError(400, "confirmation_mismatch");
  if (user.role === "superadmin" && (await repo.countSuperAdmins()) <= 1) throw new ServiceError(409, "last_super_admin");
  await repo.deleteUser(user.id);
  let filesRemoved = 0;
  let cleanup: "done" | "failed" | "skipped" = "skipped";
  if (media) {
    try {
      filesRemoved = await media.deleteByPrefix(userPrefix(media.root, user.id));
      cleanup = "done";
    } catch {
      cleanup = "failed";
      await repo.audit({ action: "media.cleanup_failed", targetType: "user", targetId: user.id, actorId: user.id, summary: { prefix: userPrefix(media.root, user.id) } });
    }
  }
  return { deleted: true as const, filesRemoved, cleanup };
}

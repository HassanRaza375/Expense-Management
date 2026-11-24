// Downloads a full backup file of the data the app is showing (in account mode: the account's data on this device). Used before an account is deleted, because that
// file is then the only copy.
// @ts-expect-error plain JS module
import { buildBackup } from "../../utils/backup.js";

export async function downloadBackupFile(filename: string): Promise<void> {
  const bundle = await buildBackup({ includeAttachments: false });
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

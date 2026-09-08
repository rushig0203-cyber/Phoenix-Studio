/**
 * Phoenix Studio is intentionally local-only. These exports remain so legacy
 * screens fail clearly instead of silently reaching AWS/S3 and risking a bill.
 */

export const STORAGE_LIMIT_BYTES = 0;
export const STORAGE_TARGET_BYTES = 0;

const disabled = () =>
  new Error(
    "Cloud storage is disabled. Phoenix Studio saves files locally in Phoenix Studio Review Files."
  );

export async function getPresignedUploadUrl(
  _key: string,
  _contentType: string
): Promise<string> {
  throw disabled();
}

export async function deleteFromS3(_key: string): Promise<void> {
  throw disabled();
}

export async function uploadBuffer(
  _key: string,
  _body: Buffer,
  _contentType: string
): Promise<string> {
  throw disabled();
}

export async function getPresignedReadUrl(
  _key: string,
  _expiresIn = 3600
): Promise<string> {
  throw disabled();
}

export async function objectExists(_key: string) {
  return { exists: false, bytes: 0, contentType: undefined as string | undefined };
}

export async function getCloudUsage(_prefix?: string) {
  return { bytes: 0, objects: 0 };
}

export async function listCloudKeys(_prefix?: string) {
  return [] as string[];
}

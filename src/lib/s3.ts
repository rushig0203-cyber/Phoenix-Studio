import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || "auraclip-storage";
export const STORAGE_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
export const STORAGE_TARGET_BYTES = 7 * 1024 * 1024 * 1024;

/**
 * Generate a pre-signed URL for uploading a file directly from the browser client to S3.
 */
export const getPresignedUploadUrl = async (
  key: string,
  contentType: string
): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  // Pre-signed URL expires in 15 minutes (900 seconds)
  return getSignedUrl(s3Client, command, { expiresIn: 900 });
};

/**
 * Delete a file object directly from S3 bucket storage.
 */
export const deleteFromS3 = async (key: string): Promise<void> => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
};

export async function uploadBuffer(key: string, body: Buffer, contentType: string) {
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function getPresignedReadUrl(key: string, expiresIn = 3600) {
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }), { expiresIn });
}

export async function objectExists(key: string) {
  try {
    const result = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return { exists: true, bytes: Number(result.ContentLength || 0), contentType: result.ContentType };
  } catch {
    return { exists: false, bytes: 0, contentType: undefined };
  }
}

export async function getCloudUsage(prefix?: string) {
  let continuationToken: string | undefined;
  let bytes = 0;
  let objects = 0;
  do {
    const page = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of page.Contents || []) {
      bytes += Number(item.Size || 0);
      objects += 1;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return { bytes, objects };
}

export async function listCloudKeys(prefix?: string) {
  let continuationToken: string | undefined;
  const keys: string[] = [];
  do {
    const page = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix, ContinuationToken: continuationToken }));
    for (const item of page.Contents || []) if (item.Key) keys.push(item.Key);
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

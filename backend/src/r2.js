import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

// Cloudflare R2 (S3-compatible) storage for product images.
//
// Credentials/config come ONLY from environment variables — never commit them:
//   R2_ENDPOINT           https://<account-id>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID      access key of the "amrutpeth_dealer" API token
//   R2_SECRET_ACCESS_KEY  its secret  (upload / delete, and signing DEALER views)
//   R2_AGGREGATOR_ACCESS_KEY_ID      access key of the "amrutpeth_aggregator" token
//   R2_AGGREGATOR_SECRET_ACCESS_KEY  its secret (signs the AGGREGATOR's image URLs)
//   R2_BUCKET             amrutpeth   (optional — this is the default)
//
// Two tokens, two clients: the dealer token writes/deletes objects, the
// aggregator token is used only to sign read URLs for the AGGREGATOR role, so
// it can (and should) be a read-only token in Cloudflare.
//
// The bucket stays PRIVATE (no public bucket URL / r.2.dev / custom domain).
// Images are only ever reachable through short-lived presigned URLs that the
// API hands out to the roles allowed to see them (see products.js).

export const GENERIC_IMAGE_KEY = 'generic.jfif';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const SIGNED_URL_TTL_SECONDS = 300;

const clients = {};
function makeClient(name, idVar, secretVar) {
  if (clients[name]) return clients[name];
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env[idVar];
  const secretAccessKey = process.env[secretVar];
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(`R2 is not configured: set R2_ENDPOINT, ${idVar} and ${secretVar}`);
  }
  clients[name] = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    // R2 doesn't support the newer default AWS SDK checksum behaviour.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return clients[name];
}
const r2 = () => makeClient('dealer', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY');
const r2Aggregator = () => makeClient('aggregator', 'R2_AGGREGATOR_ACCESS_KEY_ID', 'R2_AGGREGATOR_SECRET_ACCESS_KEY');
const bucket = () => process.env.R2_BUCKET || 'amrutpeth';

// JFIF = JPEG data with a .jfif extension. Check the extension AND the JPEG
// start-of-image magic bytes (FF D8 FF) so a renamed .exe/.html can't get in.
export function validateJfif(file) {
  if (!/\.jfif$/i.test(file.originalname || '')) return 'Image must be a .jfif file';
  const b = file.buffer;
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return 'File is not a valid JFIF/JPEG image';
  return null;
}

// Key is generated server-side (never from the client filename), namespaced
// per dealer, and unique per upload so replaced images never serve stale.
export async function uploadProductImage(dealerId, buffer) {
  const key = `products/${dealerId}/${randomUUID()}.jfif`;
  await r2().send(new PutObjectCommand({
    Bucket: bucket(), Key: key, Body: buffer, ContentType: 'image/jpeg',
    CacheControl: 'private, max-age=300',
  }));
  return key;
}

// Never deletes the shared default image.
export async function deleteProductImage(key) {
  if (!key || key === GENERIC_IMAGE_KEY) return;
  try {
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    console.error('R2 delete failed for', key, err.message); // orphaned object is harmless; don't fail the request
  }
}

// role === 'AGGREGATOR' signs with the aggregator token; everyone else who is
// allowed to see images (the owning DEALER) signs with the dealer token.
export function signedImageUrl(key, role) {
  const c = role === 'AGGREGATOR' ? r2Aggregator() : r2();
  return getSignedUrl(c, new GetObjectCommand({ Bucket: bucket(), Key: key || GENERIC_IMAGE_KEY }), { expiresIn: SIGNED_URL_TTL_SECONDS });
}

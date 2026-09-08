/**
 * Product image storage (Supabase Storage).
 *
 * Photos are downscaled and re-encoded in the browser before upload — a phone
 * camera shot is often 4-8 MB, which is wasteful to store and slow to send on
 * mobile data, and the label only needs to be legible.
 *
 * Objects live at `product-images/<user_id>/<uuid>.<ext>`; the RLS policies in
 * supabase/migrations/20260908000000_product_images_storage.sql key off that
 * first path segment, so a user can only write inside their own folder.
 */

import { supabase } from "./supabase";

export const PRODUCT_IMAGE_BUCKET = "product-images";

/** Longest edge after downscaling, in pixels. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
/** Must stay at or under the bucket's file_size_limit. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Downscale to {@link MAX_EDGE} and re-encode as JPEG.
 * Throws if the browser cannot decode or encode the image.
 */
async function compressImage(
  file: File,
): Promise<{ blob: Blob; contentType: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("Canvas encoding failed.");
    return { blob, contentType: "image/jpeg" };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Upload a scanned product photo and return its public URL.
 *
 * Never throws — image upload is a nice-to-have, so a failure returns `null`
 * and the caller saves the scan with no image rather than losing the analysis.
 */
export async function uploadProductImage(
  file: File,
  userId: string,
): Promise<string | null> {
  try {
    let body: Blob = file;
    let contentType = file.type || "image/jpeg";

    try {
      const compressed = await compressImage(file);
      body = compressed.blob;
      contentType = compressed.contentType;
    } catch {
      // Canvas path unavailable — fall back to the original file, provided the
      // bucket will accept its type.
      if (!ALLOWED_TYPES.includes(contentType as (typeof ALLOWED_TYPES)[number])) {
        return null;
      }
    }

    if (body.size > MAX_UPLOAD_BYTES) return null;

    const ext = EXTENSION[contentType] ?? "jpg";
    const path = `${userId}/${randomId()}.${ext}`;

    const { error } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, body, {
        contentType,
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) return null;

    const { data } = supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/** Recover the object path from a public URL, or null if it isn't one of ours. */
export function storagePathFromPublicUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const marker = `/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

/**
 * Best-effort delete of a stored product photo, so removing a scan doesn't
 * leave the object orphaned in the bucket. Never throws.
 */
export async function removeProductImage(
  url: string | null | undefined,
): Promise<void> {
  const path = storagePathFromPublicUrl(url);
  if (!path) return;
  try {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
  } catch {
    /* the row is already gone; an orphaned object is not worth failing over */
  }
}

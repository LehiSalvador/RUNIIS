// Cloudinary delivery URLs for PUBLISHED event media (ADR-001: media provider is Cloudinary; the
// image optimizer is limited to Cloudinary, Amendment 1 A9). Pure and client-safe: the cloud name is
// a public value. Returns null when delivery is not configured or the key is not a plain public id,
// so callers fall back to the ui-spec §5.1 no-photo treatment instead of rendering a broken image.

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,254}$/;
const CLOUD_NAME = /^[a-z0-9-]{1,64}$/i;

export type MediaTransform = { width: number; aspect?: "4:3" | "16:9" | "1.91:1" };

export function cloudinaryCloudName(): string | null {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? null;
  return cloud && CLOUD_NAME.test(cloud) ? cloud : null;
}

export function publicMediaUrl(storageObjectKey: string, transform: MediaTransform, cloud = cloudinaryCloudName()): string | null {
  if (!cloud || !PUBLIC_ID.test(storageObjectKey) || storageObjectKey.split("/").includes("..")) return null;
  const width = Math.min(Math.max(Math.round(transform.width), 16), 2400);
  const parts = ["f_auto", "q_auto", "c_fill", "g_auto", `w_${width}`];
  if (transform.aspect) parts.push(`ar_${transform.aspect}`);
  const path = storageObjectKey.split("/").map(encodeURIComponent).join("/");
  return `https://res.cloudinary.com/${cloud}/image/upload/${parts.join(",")}/${path}`;
}

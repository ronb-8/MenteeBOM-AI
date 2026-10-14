/**
 * Thumbnail utility — handles both filesystem-based (thumbnail_url) and legacy base64 thumbnails.
 */

/**
 * Returns true if the thumbnail object has displayable image data.
 */
export function hasThumbnail(thumbnail) {
  if (!thumbnail || !thumbnail.available) return false;
  return !!(thumbnail.thumbnail_url || thumbnail.data_base64);
}

/**
 * Returns the image src string for an <img> tag.
 * Prefers thumbnail_url (served from filesystem), falls back to base64 data URI.
 */
export function getThumbnailSrc(thumbnail) {
  if (!thumbnail) return '';
  if (thumbnail.thumbnail_url) return thumbnail.thumbnail_url;
  if (thumbnail.data_base64) {
    const mime = thumbnail.mime_type || 'image/png';
    return `data:${mime};base64,${thumbnail.data_base64}`;
  }
  return '';
}

/**
 * For robot assembly components where thumbnail is a plain string
 * (either a URL like "/api/parts/123/thumbnail" or raw base64).
 * Returns the appropriate img src.
 */
export function getThumbSrc(thumb) {
  if (!thumb) return null;
  if (thumb.startsWith('/api/') || thumb.startsWith('http')) return thumb;
  return `data:image/png;base64,${thumb}`;
}

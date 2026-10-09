/** Public location metadata only. A Meta-eligible place is not proof of filming there. */
export type InstagramLocation = { id: string; name: string };
export type InstagramLocationSearch = { locations: InstagramLocation[]; reason?: string };
export const INSTAGRAM_LOCATION_SEARCH_LIMIT = 8;
export const instagramLocationId = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,40}$/.test(value) && !/[\r\n]/.test(value);
export function publicInstagramLocation(value: unknown): InstagramLocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as { id?: unknown; name?: unknown };
  if (!instagramLocationId(page.id) || typeof page.name !== "string" || !page.name.trim() || page.name.length > 200 || /[\u0000-\u001f\u007f]/.test(page.name)) return null;
  return { id: page.id, name: page.name.trim() };
}
/** Meta requires a Page with finite latitude and longitude, not a free-form country label. */
export function eligibleInstagramLocation(value: unknown): InstagramLocation | null {
  const place = publicInstagramLocation(value);
  if (!place) return null;
  const location = (value as { location?: { latitude?: unknown; longitude?: unknown } }).location;
  if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number"
      || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
      || location.latitude < -90 || location.latitude > 90 || location.longitude < -180 || location.longitude > 180) return null;
  return place;
}

/**
 * Mirror shim for Cloudflare Pages root-directory compatibility.
 * Canonical implementation lives at: functions/api/domains/availability.js
 */
export {
  onRequestOptions,
  onRequestPost,
} from "../../../../../functions/api/domains/availability.js";

// Tier 0 link checks: fast, free, local rules. No network requests and nothing is stored.
// These are warning signs, never proof that a link is safe. Rules live in assets/links-core.js.
import { parse } from 'tldts';
import { SIGNALS } from '../assets/link-signals.js';
import { createLinkChecker } from '../assets/links-core.js';
export { SIGNALS };
export const { extractUrls, analyzeUrl, checkLinks } = createLinkChecker(parse);

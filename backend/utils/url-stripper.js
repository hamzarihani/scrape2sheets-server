/**
 * Strips all URLs from Markdown content before sending to AI.
 * This reduces token usage and removes potentially distracting links.
 *
 * Handles:
 * - Markdown images ![alt](url) → removed completely
 * - Markdown links [text](url) → keeps text only
 * - Broken/orphan markdown link targets ](url) → removed completely
 * - Reference-style links [ref]: url → removed
 * - Autolinks <url> → removed
 * - Plain URLs (http://, https://) → removed
 * - Relative URLs (/path/to/page) → removed
 * - Leftover artifacts like ]() → removed
 */

/**
 * Strip all URLs from markdown content
 * @param {string} markdown - The markdown content
 * @returns {string} Markdown with all URLs removed
 */
function stripUrls(markdown) {
  if (!markdown) return '';

  let cleaned = markdown;

  // 1. Remove markdown images: ![alt text](url) or ![alt text](url "title")
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');

  // 2. Convert markdown links to plain text: [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 3. Remove broken/orphan link targets: ](url) with no opening [
  //    These are common in Turndown output from malformed HTML
  cleaned = cleaned.replace(/\]\([^)]+\)/g, '');

  // 4. Remove reference-style link definitions: [ref]: url "optional title"
  cleaned = cleaned.replace(/^\s*\[([^\]]+)\]:\s+\S+.*$/gm, '');

  // 5. Remove autolinks: <http://example.com>
  cleaned = cleaned.replace(/<https?:\/\/[^>]+>/g, '');

  // 6. Remove plain URLs (http:// or https://)
  cleaned = cleaned.replace(/https?:\/\/[^\s)]+/g, '');

  // 7. Remove relative URL paths that look like links (start with / followed by path segments)
  //    e.g. /gp/cart/view.html?ref_=nav_cart or /dp/B09SWNGW4P/ref=sr_1_1
  //    Must have at least 2 path segments to avoid matching fractions like 1/2 or short paths
  cleaned = cleaned.replace(/(?:^|\s)\/[a-zA-Z][a-zA-Z0-9_\-]*\/[a-zA-Z0-9_\-/.]+(?:\?[^\s)]*)?/gm, '');

  // 8. Clean up leftover artifacts: ]() or ]( )
  cleaned = cleaned.replace(/\]\(\s*\)/g, '');

  // 9. Clean up any resulting extra whitespace or empty lines
  cleaned = cleaned
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple blank lines → double newline
    .trim();

  return cleaned;
}

module.exports = {
  stripUrls
};

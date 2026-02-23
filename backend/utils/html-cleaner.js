const logger = require('./logger');

/**
 * DOM-based HTML cleaning function that runs in browser context.
 * This function removes boilerplate elements while preserving all visible data content.
 * 
 * Design principles:
 * - Remove only non-content elements (scripts, styles, hidden elements, ads, modals)
 * - Never remove elements containing visible text
 * - Maintain HTML structure and encoding
 * - Idempotent: running twice produces identical output
 */

/**
 * Cleans raw HTML by removing boilerplate while preserving data content.
 * This function is designed to run inside a browser context (e.g., via page.evaluate()).
 * 
 * @returns {string} Cleaned HTML string
 */
function cleanRawHtml() {
  // Clone the document body to avoid modifying the live DOM
  const clone = document.body.cloneNode(true);

  // Helper function: Check if an element contains meaningful text content
  function hasTextContent(element) {
    const text = element.textContent || '';
    return text.trim().length > 0;
  }

  // Helper function: Check if element has inline hidden styles
  function hasHiddenInlineStyle(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = element.style;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return true;
    }

    return false;
  }

  // Icon class → label mapping — only data/metric icons, NOT decorative/UI icons
  const ICON_CLASS_MAP = [
    { match: 'eye', label: 'Views' }, { match: 'visibility', label: 'Views' },
    { match: 'heart', label: 'Likes' }, { match: 'like', label: 'Likes' },
    { match: 'thumbs-up', label: 'Likes' }, { match: 'thumb-up', label: 'Likes' },
    { match: 'favorite', label: 'Favorites' }, { match: 'upvote', label: 'Upvotes' },
    { match: 'comment', label: 'Comments' }, { match: 'message-square', label: 'Comments' },
    { match: 'message-circle', label: 'Comments' }, { match: 'chat-bubble', label: 'Comments' },
    { match: 'discuss', label: 'Comments' }, { match: 'conversation', label: 'Comments' },
    { match: 'speech', label: 'Comments' }, { match: 'annotation', label: 'Comments' },
    { match: 'reply', label: 'Replies' },
    { match: 'share', label: 'Shares' }, { match: 'retweet', label: 'Retweets' },
    { match: 'repost', label: 'Reposts' },
    { match: 'follower', label: 'Followers' }, { match: 'people', label: 'People' },
    { match: 'member', label: 'Members' },
    { match: 'download', label: 'Downloads' }, { match: 'install', label: 'Installs' },
    { match: 'star', label: 'Rating' }, { match: 'rating', label: 'Rating' },
    { match: 'bookmark', label: 'Bookmarks' },
    { match: 'bell', label: 'Notifications' }, { match: 'notification', label: 'Notifications' },
    { match: 'play-circle', label: 'Plays' },
  ];

  const SKIP_ARIA_PATTERNS = /(?:up|down|increase|decrease|growth|decline|change|rise|drop|gain|loss|flat|no change)\s+\d+\s*(?:percent|%)/i;
  const SKIP_ARIA_UI_PATTERNS = /^(?:menu|close|open|toggle|expand|collapse|dismiss|navigation|search|filter|sort|next|previous|back|more|less|show|hide|location|map|place|arrow|chevron|caret|angle|trending|trend)$/i;

  function resolveIconLabel(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim().length > 0 && ariaLabel.trim().length < 30) {
      const trimmed = ariaLabel.trim();
      if (SKIP_ARIA_PATTERNS.test(trimmed) || SKIP_ARIA_UI_PATTERNS.test(trimmed)) return null;
      return trimmed;
    }
    const title = el.getAttribute('title');
    if (title && title.trim().length > 0 && title.trim().length < 30) {
      const trimmed = title.trim();
      if (SKIP_ARIA_PATTERNS.test(trimmed) || SKIP_ARIA_UI_PATTERNS.test(trimmed)) return null;
      return trimmed;
    }
    const searchTexts = [];
    const className = (el.getAttribute('class') || '').toLowerCase();
    if (className) searchTexts.push(className);
    const id = (el.getAttribute('id') || '').toLowerCase();
    if (id) searchTexts.push(id);
    const dataIcon = (el.getAttribute('data-icon') || el.getAttribute('data-testid') || '').toLowerCase();
    if (dataIcon) searchTexts.push(dataIcon);
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (name) searchTexts.push(name);
    if (el.tagName && el.tagName.toLowerCase() === 'svg') {
      const use = el.querySelector('use');
      if (use) {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
        if (href) searchTexts.push(href.toLowerCase());
      }
      const svgTitle = el.querySelector('title');
      if (svgTitle && svgTitle.textContent.trim().length > 0 && svgTitle.textContent.trim().length < 30) {
        const svgTitleText = svgTitle.textContent.trim();
        if (!SKIP_ARIA_PATTERNS.test(svgTitleText) && !SKIP_ARIA_UI_PATTERNS.test(svgTitleText)) return svgTitleText;
      }
    }
    for (const text of searchTexts) {
      for (const entry of ICON_CLASS_MAP) {
        if (text.includes(entry.match)) return entry.label;
      }
    }
    const parent = el.parentElement;
    if (parent) {
      const pAria = parent.getAttribute('aria-label');
      if (pAria && pAria.trim().length > 0 && pAria.trim().length < 30) {
        const trimmed = pAria.trim();
        if (!SKIP_ARIA_PATTERNS.test(trimmed) && !SKIP_ARIA_UI_PATTERNS.test(trimmed)) return trimmed;
      }
      const pTexts = [];
      const pClass = (parent.getAttribute('class') || '').toLowerCase();
      if (pClass) pTexts.push(pClass);
      const pId = (parent.getAttribute('id') || '').toLowerCase();
      if (pId) pTexts.push(pId);
      for (const text of pTexts) {
        for (const entry of ICON_CLASS_MAP) {
          if (text.includes(entry.match)) return entry.label;
        }
      }
    }
    return null;
  }

  function resolveIconsToLabels(root) {
    // Resolve SVGs — only replace if we can confidently identify the icon
    Array.from(root.querySelectorAll('svg')).forEach(svg => {
      const label = resolveIconLabel(svg);
      if (label) {
        const span = document.createElement('span');
        span.textContent = label + ': ';
        svg.replaceWith(span);
      }
    });
    // Resolve font icons
    const iconSels = ['i[class*="icon"]', 'i[class*="fa-"]', 'i[class*="fa "]',
      'i[class*="material"]', 'i[class*="bi-"]', 'i[class*="glyphicon"]',
      'i[class*="lucide"]', 'i[class*="tabler"]', 'i[class*="ph-"]',
      'i[class*="ri-"]', 'i[class*="ti-"]', 'i[class*="bx-"]',
      'span[class*="icon"]', 'span[class*="material-icons"]'];
    iconSels.forEach(sel => {
      try {
        root.querySelectorAll(sel).forEach(icon => {
          if ((icon.textContent || '').trim().length > 3) return;
          const label = resolveIconLabel(icon);
          if (label) {
            const span = document.createElement('span');
            span.textContent = label + ': ';
            icon.replaceWith(span);
          }
        });
      } catch (e) { /* invalid selector */ }
    });
  }

  let removedCount = { scripts: 0, styles: 0, noscripts: 0, svgs: 0, linksMetas: 0, icons: 0, hidden: 0, cookies: 0, ads: 0, modals: 0, comments: 0 };

  // Step 1: Remove script tags completely
  const scripts = clone.querySelectorAll('script');
  scripts.forEach(el => el.remove());
  removedCount.scripts = scripts.length;

  // Step 2: Remove style tags completely
  const styles = clone.querySelectorAll('style');
  styles.forEach(el => el.remove());
  removedCount.styles = styles.length;

  // Step 3: Remove noscript tags completely
  const noscripts = clone.querySelectorAll('noscript');
  noscripts.forEach(el => el.remove());
  removedCount.noscripts = noscripts.length;

  // Step 4: Convert recognizable icons to text labels, then remove remaining SVGs/icons
  // This preserves context like "👁 3.3k" → "Views: 3.3k" instead of just "3.3k"
  resolveIconsToLabels(clone);

  // Remove remaining SVGs that couldn't be resolved (decorative graphics)
  const svgs = clone.querySelectorAll('svg');
  svgs.forEach(el => el.remove());
  removedCount.svgs = svgs.length;

  // Step 5: Remove link and meta tags (metadata, not visible content)
  const links = clone.querySelectorAll('link');
  const metas = clone.querySelectorAll('meta');
  links.forEach(el => el.remove());
  metas.forEach(el => el.remove());
  removedCount.linksMetas = links.length + metas.length;

  // Step 6: Remove remaining icon elements that couldn't be resolved
  const iconSelectors = [
    'i[class*="icon"]',
    'i[class*="fa-"]',
    'i[class*="material"]',
    'span[class*="icon"]',
    'span[class*="material-icons"]',
  ];
  iconSelectors.forEach(selector => {
    try {
      const icons = clone.querySelectorAll(selector);
      icons.forEach(el => {
        if (!hasTextContent(el)) {
          el.remove();
          removedCount.icons++;
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });

  // Step 7: Remove hidden elements (inline styles + class-based, merged into one pass)
  // First, use CSS selectors to find class/attribute-based hidden elements
  const hiddenSelectors = [
    '[class*="hidden" i]',
    '[class*="hide" i]',
  ];
  hiddenSelectors.forEach(selector => {
    try {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => {
        const text = (el.textContent || '').trim();
        if (text.length < 50 || !hasTextContent(el)) {
          el.remove();
          removedCount.hidden++;
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });

  // Then check all remaining elements for inline hidden styles
  const allElements = Array.from(clone.querySelectorAll('*'));
  allElements.forEach(el => {
    if (hasHiddenInlineStyle(el)) {
      el.remove();
      removedCount.hidden++;
    }
  });

  // Step 9: Remove cookie consent banners
  // Look for common aria-labels, roles, and class names
  const cookieSelectors = [
    '[aria-label*="cookie" i]',
    '[aria-label*="consent" i]',
    '[id*="cookie" i]',
    '[id*="consent" i]',
    '[class*="cookie" i]',
    '[class*="consent" i]',
    '[class*="gdpr" i]',
  ];
  cookieSelectors.forEach(selector => {
    try {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => {
        // Only remove if it's a dialog/banner type element (not part of main content)
        const role = el.getAttribute('role');
        const tagName = el.tagName.toLowerCase();
        if (role === 'dialog' || role === 'banner' || role === 'alert' ||
          tagName === 'aside' || tagName === 'dialog') {
          el.remove();
          removedCount.cookies++;
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });

  // Step 10: Remove advertisement containers
  // Be conservative - only remove elements with ad-specific attributes and little text
  const adSelectors = [
    '[id*="ad-" i]',
    '[id*="advertisement" i]',
    '[class*="ad-container" i]',
    '[class*="ad-wrapper" i]',
    '[class*="advertisement" i]',
    '[class*="advert" i]',
    '[class*="sponsor" i]',
    '[data-ad]',
    '[data-advertisement]',
  ];
  adSelectors.forEach(selector => {
    try {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => {
        // Don't remove if it contains substantial text content that might be data
        // Ads typically have very little meaningful content
        const textContent = (el.textContent || '').trim();
        if (textContent.length < 100) {
          el.remove();
          removedCount.ads++;
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });

  // Step 11: Remove modal overlays and popups
  // Look for common modal/overlay class names and attributes
  const modalSelectors = [
    '[class*="modal" i]:not([class*="modal-content" i])',
    '[class*="overlay" i]',
    '[class*="popup" i]',
    '[class*="lightbox" i]',
    '[class*="backdrop" i]',
    '[role="dialog"]:not([class*="content" i])',
    '[aria-modal="true"]:not([class*="content" i])',
  ];
  modalSelectors.forEach(selector => {
    try {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => {
        // Check if the element looks like an overlay (has little content of its own)
        // or has typical overlay styling indicators
        const className = el.className || '';
        const isOverlayLike = className.toLowerCase().includes('overlay') ||
          className.toLowerCase().includes('backdrop');
        const textContent = (el.textContent || '').trim();

        // Remove if it's clearly an overlay or has minimal content
        if (isOverlayLike || textContent.length < 50) {
          el.remove();
          removedCount.modals++;
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });

  // Step 12: Remove HTML comments
  const walker = document.createTreeWalker(
    clone,
    NodeFilter.SHOW_COMMENT,
    null,
    false
  );
  const comments = [];
  let node;
  while ((node = walker.nextNode())) {
    comments.push(node);
  }
  comments.forEach(comment => {
    comment.remove();
    removedCount.comments++;
  });

  // Step 13: Strip unnecessary attributes to reduce token usage
  // Remove class, id, style, and data-* attributes from non-semantic elements
  const elementsToClean = clone.querySelectorAll('div, span, section, article');
  let attributesRemoved = 0;
  elementsToClean.forEach(el => {
    // Keep semantic attributes but remove styling/tracking attributes
    const attributesToRemove = [];
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (attr.name === 'class' || attr.name === 'id' || attr.name === 'style' ||
        attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
        attributesToRemove.push(attr.name);
      }
    }
    attributesToRemove.forEach(attrName => {
      el.removeAttribute(attrName);
      attributesRemoved++;
    });
  });

  // Step 14: Compress whitespace to reduce token usage
  // Get the HTML string first
  let html = clone.outerHTML;
  const originalLength = html.length;

  // Aggressive whitespace compression
  html = html
    .replace(/\s+/g, ' ')           // Multiple whitespace → single space
    .replace(/>\s+</g, '><')        // Remove space between tags
    .replace(/\s+>/g, '>')          // Remove space before closing bracket
    .replace(/<\s+/g, '<')          // Remove space after opening bracket
    .trim();

  const compressedLength = html.length;
  const compressionRatio = ((1 - compressedLength / originalLength) * 100).toFixed(1);

  // Log summary of what was removed
  logger.info('[Cleaner] Removed elements:', removedCount);
  logger.info('[Cleaner] Total elements removed:',
    Object.values(removedCount).reduce((a, b) => a + b, 0));
  logger.info('[Cleaner] Attributes stripped: %d', attributesRemoved);
  logger.info('[Cleaner] Compression: %dKB → %dKB (%s% reduction)',
    Math.round(originalLength / 1024),
    Math.round(compressedLength / 1024),
    compressionRatio
  );

  // Return the compressed HTML string
  return html;
}

/**
 * Removes <div> elements whose opening tag matches a pattern, handling nested divs correctly.
 * Tracks div nesting depth to find the matching </div> instead of the first one.
 */
function removeBalancedDivs(html, pattern) {
  const openTagRe = new RegExp('<div[^>]*' + pattern.source + '[^>]*>', 'gi');
  let result = html;
  let match;

  // Reset and search for matching opening tags
  while ((match = openTagRe.exec(result)) !== null) {
    const startIdx = match.index;
    let depth = 1;
    let i = startIdx + match[0].length;

    // Walk forward tracking div nesting to find the matching </div>
    while (i < result.length && depth > 0) {
      const openMatch = result.slice(i).match(/^<div[\s>]/i);
      const closeMatch = result.slice(i).match(/^<\/div>/i);

      if (openMatch) {
        depth++;
        i += openMatch[0].length;
      } else if (closeMatch) {
        depth--;
        if (depth === 0) {
          // Found the matching close tag - remove the entire block
          result = result.slice(0, startIdx) + result.slice(i + closeMatch[0].length);
          openTagRe.lastIndex = startIdx; // reset to check for more matches at same position
          break;
        }
        i += closeMatch[0].length;
      } else {
        i++;
      }
    }

    // If we couldn't find a balanced close, skip this match
    if (depth > 0) break;
  }

  return result;
}

/**
 * String-based HTML cleaner for extension-provided HTML.
 * This runs in Node.js context (not browser), so we use regex and string manipulation.
 * Used when HTML is provided directly from the Chrome extension.
 * 
 * @param {string} htmlString - Raw HTML string from extension
 * @returns {string} Cleaned HTML string
 */
function cleanHTMLString(htmlString) {
  if (!htmlString) return '';

  logger.debug('[Cleaner] String-based cleaning', { inputLength: htmlString.length });

  // Step 1: Remove scripts, styles, noscripts
  let cleaned = htmlString
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Step 2: Remove SVG elements
  cleaned = cleaned.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');

  // Step 3: Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Step 4: Remove link and meta tags (metadata, not visible content)
  cleaned = cleaned
    .replace(/<link[^>]*\/?>/gi, '')
    .replace(/<meta[^>]*\/?>/gi, '');

  // Step 5: Remove common navigation and footer elements
  cleaned = cleaned
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Step 6: Remove cookie consent banners and modals (common patterns)
  // Use a balanced-div removal helper to handle nested divs correctly
  cleaned = removeBalancedDivs(cleaned, /cookie/i);
  cleaned = removeBalancedDivs(cleaned, /modal/i);
  cleaned = removeBalancedDivs(cleaned, /overlay/i);

  // Step 6.5: Strip non-data attributes (conservative stripping)
  // This removes styles, event handlers, and UI state attributes that don't contain data
  cleaned = cleaned.replace(/ (?:style|onclick|onmouseover|onmouseout|onmouseenter|onmouseleave|onfocus|onblur|onerror|onload|tabindex|aria-hidden|aria-controls|aria-labelledby|aria-describedby)="[^"]*"/gi, '');

  // Step 7: Compress whitespace aggressively
  cleaned = cleaned
    .replace(/\s+/g, ' ')           // Multiple whitespace → single space
    .replace(/>\s+</g, '><')        // Remove space between tags
    .replace(/\s+>/g, '>')          // Remove space before closing bracket
    .replace(/<\s+/g, '<')          // Remove space after opening bracket
    .trim();

  const compressionRatio = ((1 - cleaned.length / htmlString.length) * 100).toFixed(1);
  logger.debug('[Cleaner] String-based cleaning complete', {
    outputLength: cleaned.length,
    compressionRatio: `${compressionRatio}%`
  });

  return cleaned;
}

// Export for use in Node.js
module.exports = {
  cleanRawHtml,      // For browser context (via page.evaluate() if needed)
  cleanHTMLString,   // For extension HTML (string-based in Node.js)
};

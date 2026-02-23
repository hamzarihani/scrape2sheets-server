// Mock logger before requiring the module
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const { cleanHTMLString } = require('../../utils/html-cleaner');

describe('HTML Cleaner - cleanHTMLString', () => {
  describe('Basic Functionality', () => {
    it('should return empty string for null input', () => {
      expect(cleanHTMLString(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(cleanHTMLString(undefined)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(cleanHTMLString('')).toBe('');
    });

    it('should preserve basic HTML structure', () => {
      const input = '<div><p>Hello World</p></div>';
      const result = cleanHTMLString(input);

      expect(result).toContain('<div>');
      expect(result).toContain('<p>');
      expect(result).toContain('Hello World');
    });
  });

  describe('Script Removal', () => {
    it('should remove inline script tags', () => {
      const input = '<div>Content</div><script>alert("xss")</script>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert');
      expect(result).toContain('Content');
    });

    it('should remove script tags with src attribute', () => {
      const input = '<div>Content</div><script src="malicious.js"></script>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<script');
      expect(result).not.toContain('malicious.js');
    });

    it('should remove multiple script tags', () => {
      const input = '<script>a</script><div>Content</div><script>b</script>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<script>');
      expect(result.match(/<script/g)).toBeNull();
    });

    it('should handle multiline scripts', () => {
      const input = `
        <script>
          function test() {
            console.log("test");
          }
        </script>
        <div>Content</div>
      `;
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<script>');
      expect(result).not.toContain('function');
    });
  });

  describe('Style Removal', () => {
    it('should remove style tags', () => {
      const input = '<style>.hidden { display: none; }</style><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<style>');
      expect(result).not.toContain('display: none');
      expect(result).toContain('Content');
    });

    it('should remove style tags with type attribute', () => {
      const input = '<style type="text/css">body { margin: 0; }</style><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<style');
    });
  });

  describe('Noscript Removal', () => {
    it('should remove noscript tags', () => {
      const input = '<noscript>Enable JavaScript</noscript><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<noscript>');
      expect(result).not.toContain('Enable JavaScript');
    });
  });

  describe('SVG Removal', () => {
    it('should remove SVG elements', () => {
      const input = '<svg><path d="M0 0"/></svg><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<svg>');
      expect(result).not.toContain('<path');
    });

    it('should remove complex SVG elements', () => {
      const input = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="40"/>
          <text x="50" y="50">Icon</text>
        </svg>
        <div>Content</div>
      `;
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<svg');
      expect(result).not.toContain('<circle');
    });
  });

  describe('Comment Removal', () => {
    it('should remove HTML comments', () => {
      const input = '<!-- This is a comment --><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<!--');
      expect(result).not.toContain('-->');
      expect(result).not.toContain('This is a comment');
    });

    it('should remove multiline comments', () => {
      const input = `
        <!--
          Multiline
          Comment
        -->
        <div>Content</div>
      `;
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<!--');
      expect(result).not.toContain('Multiline');
    });
  });

  describe('Meta and Link Removal', () => {
    it('should remove meta tags', () => {
      const input = '<meta charset="utf-8"><meta name="description" content="test"><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<meta');
    });

    it('should remove link tags', () => {
      const input = '<link rel="stylesheet" href="style.css"><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<link');
    });
  });

  describe('Navigation Element Removal', () => {
    it('should remove header elements', () => {
      const input = '<header>Site Header</header><main>Content</main>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<header>');
      expect(result).not.toContain('Site Header');
    });

    it('should remove nav elements', () => {
      const input = '<nav><ul><li>Menu</li></ul></nav><main>Content</main>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<nav>');
    });

    it('should remove footer elements', () => {
      const input = '<main>Content</main><footer>Copyright 2024</footer>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('<footer>');
      expect(result).not.toContain('Copyright');
    });
  });

  describe('Cookie/Modal Removal', () => {
    it('should remove cookie consent divs', () => {
      const input = '<div class="cookie-banner">Accept cookies</div><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('cookie-banner');
      expect(result).not.toContain('Accept cookies');
    });

    it('should remove modal divs', () => {
      const input = '<div class="modal">Sign up now!</div><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('modal');
    });

    it('should remove overlay divs', () => {
      const input = '<div class="overlay"></div><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('overlay');
    });
  });

  describe('Attribute Stripping', () => {
    it('should remove style attributes', () => {
      const input = '<div style="color: red;">Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('style=');
      expect(result).not.toContain('color: red');
    });

    it('should remove event handler attributes', () => {
      const input = '<div onclick="alert(1)" onmouseover="hack()">Content</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('onclick');
      expect(result).not.toContain('onmouseover');
    });

    it('should remove aria-hidden attributes', () => {
      const input = '<div aria-hidden="true">Hidden</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toContain('aria-hidden');
    });
  });

  describe('Whitespace Compression', () => {
    it('should compress multiple spaces to single space', () => {
      const input = '<div>Hello    World</div>';
      const result = cleanHTMLString(input);

      expect(result).not.toMatch(/  +/); // No double spaces
    });

    it('should remove whitespace between tags', () => {
      const input = '<div>   </div>   <span>   </span>';
      const result = cleanHTMLString(input);

      expect(result).not.toMatch(/>\s+</);
    });

    it('should trim the result', () => {
      const input = '   <div>Content</div>   ';
      const result = cleanHTMLString(input);

      expect(result).not.toMatch(/^\s/);
      expect(result).not.toMatch(/\s$/);
    });
  });

  describe('Content Preservation', () => {
    it('should preserve text content', () => {
      const input = '<div><h1>Title</h1><p>Paragraph text here.</p></div>';
      const result = cleanHTMLString(input);

      expect(result).toContain('Title');
      expect(result).toContain('Paragraph text here.');
    });

    it('should preserve anchor href attributes', () => {
      const input = '<a href="https://example.com">Link</a>';
      const result = cleanHTMLString(input);

      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('Link');
    });

    it('should preserve image src attributes', () => {
      const input = '<img src="image.jpg" alt="Description">';
      const result = cleanHTMLString(input);

      expect(result).toContain('src="image.jpg"');
      expect(result).toContain('alt="Description"');
    });

    it('should preserve data attributes on tables', () => {
      const input = '<table data-id="123"><tr><td>Data</td></tr></table>';
      const result = cleanHTMLString(input);

      expect(result).toContain('data-id="123"');
      expect(result).toContain('Data');
    });
  });

  describe('Complex HTML Scenarios', () => {
    it('should handle a realistic page snippet', () => {
      const input = `
        <html>
          <head>
            <meta charset="utf-8">
            <script src="app.js"></script>
            <style>body { margin: 0; }</style>
          </head>
          <body>
            <header><nav>Menu</nav></header>
            <main>
              <h1>Product List</h1>
              <div class="product">
                <span>Product 1 - $99</span>
              </div>
            </main>
            <footer>Copyright</footer>
            <div class="cookie-consent">Accept</div>
          </body>
        </html>
      `;
      const result = cleanHTMLString(input);

      expect(result).toContain('Product List');
      expect(result).toContain('Product 1');
      expect(result).toContain('$99');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('<style');
      expect(result).not.toContain('cookie');
    });

    it('should handle nested problematic elements', () => {
      const input = `
        <div>
          <script>
            <div>Fake nested div</div>
          </script>
          <div>Real content</div>
        </div>
      `;
      const result = cleanHTMLString(input);

      expect(result).toContain('Real content');
      expect(result).not.toContain('Fake nested div');
    });
  });

  describe('Edge Cases', () => {
    it('should handle self-closing tags', () => {
      const input = '<img src="test.jpg"/><br/><hr/><div>Content</div>';
      const result = cleanHTMLString(input);

      expect(result).toContain('<img src="test.jpg"/>');
    });

    it('should handle empty elements', () => {
      const input = '<div></div><span></span><p>Content</p>';
      const result = cleanHTMLString(input);

      expect(result).toContain('<div></div>');
      expect(result).toContain('Content');
    });

    it('should handle special characters in content', () => {
      const input = '<div>Price: $100 &amp; Tax: 10%</div>';
      const result = cleanHTMLString(input);

      expect(result).toContain('$100');
      expect(result).toContain('&amp;');
    });
  });
});

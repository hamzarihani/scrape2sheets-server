const { z } = require('zod');

// Define the same schema used in the scrape route for testing
const requestSchema = z.object({
  html: z.string().min(1, "HTML content is required"),
  instruction: z.string().min(3).max(500),
  model: z.string().optional(),
  maxItems: z.number().int().positive().max(500).optional(),
});

describe('Scrape Request Validation', () => {
  describe('HTML Field Validation', () => {
    it('should reject empty HTML', () => {
      const result = requestSchema.safeParse({
        html: '',
        instruction: 'extract titles'
      });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('html');
    });

    it('should reject missing HTML field', () => {
      const result = requestSchema.safeParse({
        instruction: 'extract titles'
      });

      expect(result.success).toBe(false);
    });

    it('should accept valid HTML', () => {
      const result = requestSchema.safeParse({
        html: '<div>Hello World</div>',
        instruction: 'extract text'
      });

      expect(result.success).toBe(true);
    });

    it('should accept large HTML content', () => {
      const largeHtml = '<div>' + 'x'.repeat(100000) + '</div>';
      const result = requestSchema.safeParse({
        html: largeHtml,
        instruction: 'extract text'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Instruction Field Validation', () => {
    it('should reject instruction shorter than 3 characters', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'ab'
      });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('instruction');
    });

    it('should reject instruction longer than 500 characters', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'a'.repeat(501)
      });

      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('instruction');
    });

    it('should accept instruction with exactly 3 characters', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'abc'
      });

      expect(result.success).toBe(true);
    });

    it('should accept instruction with exactly 500 characters', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'a'.repeat(500)
      });

      expect(result.success).toBe(true);
    });

    it('should reject missing instruction', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>'
      });

      expect(result.success).toBe(false);
    });
  });

  describe('Model Field Validation', () => {
    it('should accept request without model (optional)', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text'
      });

      expect(result.success).toBe(true);
      expect(result.data.model).toBeUndefined();
    });

    it('should accept valid model string', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        model: 'gemini-pro'
      });

      expect(result.success).toBe(true);
      expect(result.data.model).toBe('gemini-pro');
    });

    it('should reject non-string model', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        model: 123
      });

      expect(result.success).toBe(false);
    });
  });

  describe('MaxItems Field Validation', () => {
    it('should accept request without maxItems (optional)', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text'
      });

      expect(result.success).toBe(true);
      expect(result.data.maxItems).toBeUndefined();
    });

    it('should accept valid maxItems', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        maxItems: 100
      });

      expect(result.success).toBe(true);
      expect(result.data.maxItems).toBe(100);
    });

    it('should reject maxItems of 0', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        maxItems: 0
      });

      expect(result.success).toBe(false);
    });

    it('should reject negative maxItems', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        maxItems: -5
      });

      expect(result.success).toBe(false);
    });

    it('should reject maxItems greater than 500', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        maxItems: 501
      });

      expect(result.success).toBe(false);
    });

    it('should accept maxItems of exactly 500', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        maxItems: 500
      });

      expect(result.success).toBe(true);
    });

    it('should reject non-integer maxItems', () => {
      const result = requestSchema.safeParse({
        html: '<div>test</div>',
        instruction: 'extract text',
        maxItems: 10.5
      });

      expect(result.success).toBe(false);
    });
  });

  describe('Complete Valid Requests', () => {
    it('should accept minimal valid request', () => {
      const result = requestSchema.safeParse({
        html: '<p>Hello</p>',
        instruction: 'get text'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        html: '<p>Hello</p>',
        instruction: 'get text'
      });
    });

    it('should accept full valid request with all fields', () => {
      const result = requestSchema.safeParse({
        html: '<div><h1>Title</h1><p>Content</p></div>',
        instruction: 'Extract all headings and paragraphs',
        model: 'gemini-1.5-flash',
        maxItems: 50
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        html: '<div><h1>Title</h1><p>Content</p></div>',
        instruction: 'Extract all headings and paragraphs',
        model: 'gemini-1.5-flash',
        maxItems: 50
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle HTML with special characters', () => {
      const result = requestSchema.safeParse({
        html: '<div data-attr="value&quot;">Test &amp; &lt;stuff&gt;</div>',
        instruction: 'extract data'
      });

      expect(result.success).toBe(true);
    });

    it('should handle instruction with unicode characters', () => {
      const result = requestSchema.safeParse({
        html: '<div>Test</div>',
        instruction: 'Extract émojis 🎉 and ñoño'
      });

      expect(result.success).toBe(true);
    });

    it('should reject completely empty request', () => {
      const result = requestSchema.safeParse({});

      expect(result.success).toBe(false);
      expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
    });

    it('should reject null values', () => {
      const result = requestSchema.safeParse({
        html: null,
        instruction: null
      });

      expect(result.success).toBe(false);
    });
  });
});

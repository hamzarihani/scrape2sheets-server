const express = require('express');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { extractData, listAvailableModels } = require('../services/ai-extractor');
const { cleanHTMLString } = require('../utils/html-cleaner');
const { stripUrls } = require('../utils/url-stripper');
const { requireAuth } = require('../middleware/auth');
const { supabase } = require('../services/supabase-service');
const { resetMonthlyUsageIfNeeded, getEffectiveLimit } = require('../utils/usage');

const router = express.Router();

// Apply authentication to main scrape endpoint
// models endpoint is public for now

const requestSchema = z.object({
  html: z.string().min(1, "HTML content is required"),
  instruction: z.string().min(3).max(500),
  model: z.string().optional(),
  maxItems: z.number().int().positive().max(500).optional(),
});

// Debug endpoint to list available models
router.get('/models', async (_req, res) => {
  try {
    const models = await listAvailableModels();
    res.json({ success: true, models });
  } catch (err) {
    logger.error('[Scrape API] Failed to list models', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request body',
      details: parsed.error.flatten(),
    });
  }

  const { html, instruction, model, maxItems } = parsed.data;

  try {
    // User is already attached to req by requireAuth middleware (full profile from cache/DB)
    const user = req.user;

    await resetMonthlyUsageIfNeeded(supabase, user, req.userId);
    const effectiveLimit = getEffectiveLimit(user);

    // Check if user has reached their limit - BLOCK if limit reached
    const limitReached = user.usage_this_month >= effectiveLimit;

    if (limitReached) {
      logger.warn('[Scrape API] User has reached usage limit:', {
        userId: req.userId,
        plan: user.plan,
        usage: user.usage_this_month,
        limit: user.plan_limits_scrapes
      });

      return res.status(403).json({
        success: false,
        error: 'Usage limit reached',
        message: user.subscription_status === 'past_due'
          ? 'Your payment is past due. Please update your payment method to restore full access.'
          : 'You have reached your monthly scraping limit. Please upgrade your plan or wait until next month.',
        usage: {
          current: user.usage_this_month,
          limit: effectiveLimit,
          limitReached: true,
          plan: user.plan
        }
      });
    }

    // Data provided directly from extension (Markdown or cleaned HTML)
    const isMarkdown = html.startsWith('#') || html.includes('*') || html.includes('\n');

    // Calculate sizes in bytes and KB
    const initialSize = Buffer.byteLength(html, 'utf8');
    const initialSizeKB = (initialSize / 1024).toFixed(2);

    logger.info(`[Scrape API] Processing ${isMarkdown ? 'Markdown' : 'HTML'} from extension`, {
      userId: req.userId,
      length: html.length,
      sizeBytes: initialSize,
      sizeKB: initialSizeKB
    });

    // Log initial markdown to file
    try {
      const logsDir = path.join(__dirname, '../logs/markdown');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const initialMdPath = path.join(logsDir, `${timestamp}_initial.md`);
      fs.writeFileSync(initialMdPath, html, 'utf8');
      logger.info('[Scrape API] Initial markdown saved', { path: initialMdPath });
    } catch (err) {
      logger.error('[Scrape API] Failed to save initial markdown', { error: err.message });
    }

    // Skip aggressive HTML cleaning if it's already Markdown
    let cleanedContent = html;
    if (!isMarkdown) {
      cleanedContent = cleanHTMLString(html);
      logger.info('[Scrape API] HTML cleaned', { length: cleanedContent.length });
    }

    // Strip all URLs from the content before sending to AI
    const contentWithoutUrls = stripUrls(cleanedContent);

    // Calculate stripped content sizes
    const strippedSize = Buffer.byteLength(contentWithoutUrls, 'utf8');
    const strippedSizeKB = (strippedSize / 1024).toFixed(2);
    const reduction = ((1 - strippedSize / initialSize) * 100).toFixed(1);

    logger.info('[Scrape API] URLs stripped', {
      originalLength: cleanedContent.length,
      strippedLength: contentWithoutUrls.length,
      originalSizeKB: initialSizeKB,
      strippedSizeKB: strippedSizeKB,
      reductionPercent: reduction
    });

    // Log stripped markdown to file (sent to AI)
    try {
      const logsDir = path.join(__dirname, '../logs/markdown');
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const strippedMdPath = path.join(logsDir, `${timestamp}_sent-to-ai.md`);
      fs.writeFileSync(strippedMdPath, contentWithoutUrls, 'utf8');
      logger.info('[Scrape API] Stripped markdown saved', { path: strippedMdPath });
    } catch (err) {
      logger.error('[Scrape API] Failed to save stripped markdown', { error: err.message });
    }

    logger.info('[Scrape API] Starting AI extraction...');
    const data = await extractData({
      html: contentWithoutUrls,
      instruction,
      model,
      maxItems
    });

    logger.info('[Scrape API] Extraction complete', { itemCount: data.length });

    // When usage is updated in another route (like sheets export), we should invalidate the cache.
    // However, this route doesn't update usage itself, it just reads it.

    return res.json({
      success: true,
      data,
      itemCount: data.length,
      usage: {
        current: user.usage_this_month,
        limit: effectiveLimit,
        limitReached: limitReached
      }
    });
  } catch (err) {
    logger.error('[Scrape API] Request failed', { error: err.message, stack: err.stack });
    return next(err);
  }
});

module.exports = router;

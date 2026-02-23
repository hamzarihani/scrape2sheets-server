const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');
const { buildPrompt } = require('../utils/prompt-builder');

let client;

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error('[AI Extractor] Missing required environment variable: GEMINI_API_KEY');
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function safeParseJson(text) {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.data)) return parsed.data;
    throw new Error('Response was not a JSON array');
  } catch (err) {
    throw new Error(`Failed to parse AI response: ${err.message}`);
  }
}

async function listAvailableModels() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error('[AI Extractor] Missing required environment variable: GEMINI_API_KEY');
      return { error: 'GEMINI_API_KEY not set' };
    }

    return {
      models: [
        { name: 'gemini-2.5-flash', provider: 'google', isDefault: true },
        { name: 'gemini-1.5-flash', provider: 'google' },
        { name: 'gemini-2.5-pro', provider: 'google' },
      ]
    };
  } catch (err) {
    logger.error('Error listing models', { error: err.message });
    return { error: err.message };
  }
}

const MAX_ITEMS = parseInt(process.env.MAX_ITEMS || '500', 10);
const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS || '60000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);

// Timeout wrapper for API calls
function withTimeout(promise, timeoutMs, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

async function callGemini(prompt, model = null, retryCount = 0) {
  const ai = getClient();

  try {
    logger.info(`[Gemini] Calling ${model || 'gemini-2.5-flash'}`, { attempt: retryCount + 1, maxRetries: MAX_RETRIES + 1 });

    const apiCall = ai.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents: prompt,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: parseInt(process.env.MAX_OUTPUT_TOKENS || '16384', 10),
      },
    });

    const response = await withTimeout(
      apiCall,
      API_TIMEOUT_MS,
      `API timeout after ${API_TIMEOUT_MS}ms`
    );

    const text = response.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    logger.info('[Gemini] Success');
    const parsed = safeParseJson(text);

    return { data: parsed, rawResponse: text };
  } catch (err) {
    logger.error('[Gemini] Error', { error: err.message });

    if (retryCount < MAX_RETRIES) {
      const isRetryable =
        err.message.includes('timeout') ||
        err.message.includes('rate limit') ||
        err.message.includes('503') ||
        err.message.includes('429');

      if (isRetryable) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        logger.info('[Gemini] Retrying', { delayMs: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
        return callGemini(prompt, model, retryCount + 1);
      }
    }

    throw err;
  }
}

async function extractData({ html: markdown, instruction, model, maxItems }) {
  logger.info('[AI Extractor] Processing request', { markdownLength: markdown.length });

  const itemCap = Math.min(maxItems || MAX_ITEMS, MAX_ITEMS);
  const prompt = buildPrompt(markdown, instruction);

  const result = await callGemini(prompt, model);
  const final = (result.data || []).slice(0, itemCap);

  logger.info('[AI Extractor] Extraction complete', { itemsExtracted: final.length });
  return final;
}

module.exports = {
  extractData,
  listAvailableModels,
};

const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');

let aiClient;

function getAIClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error('[Sheets Service] Missing required environment variable: GEMINI_API_KEY');
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

/**
 * Generate a descriptive sheet name using AI based on extracted data and user instruction
 * @param {Array} data - Array of extracted data objects
 * @param {string} instruction - Original user instruction
 * @returns {Promise<string>} - AI-generated sheet name
 */
async function generateSheetName(data, instruction) {
  try {
    // Fallback name with timestamp
    const fallbackName = `Scrape ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    
    // If no data, use fallback
    if (!data || data.length === 0) {
      logger.debug('[SheetName] No data provided, using fallback');
      return fallbackName;
    }

    // Prepare context: first 5 rows of data and instruction
    const sampleData = data.slice(0, 5);
    const dataPreview = JSON.stringify(sampleData, null, 2);
    
    const prompt = `Generate a concise, descriptive name for a Google Spreadsheet based on this data extraction.

User Instruction: "${instruction}"

Sample Data (first 5 rows):
${dataPreview}

Rules:
- Return ONLY the sheet name, no explanations
- Keep it under 50 characters
- Make it descriptive and specific (include key info like source, product, date)
- Use title case
- Include relevant context from the data (e.g., "Amazon MacBook Prices Jan 2026")
- Do NOT use generic names like "Extracted Data" or "Scrape Results"
- If there's a clear pattern (e.g., product listings, job postings), mention it

Sheet Name:`;

    const ai = getAIClient();
    logger.debug('[SheetName] Calling AI to generate name');
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100,
      },
    });

    const generatedName = response.text.trim();
    
    // Clean up the name (remove quotes, markdown, etc.)
    let cleanName = generatedName
      .replace(/^["'`]+|["'`]+$/g, '') // Remove surrounding quotes
      .replace(/```.*```/gs, '') // Remove code blocks
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .trim();
    
    // Ensure it's not too long (Google Sheets allows up to 255 chars, but keep it reasonable)
    if (cleanName.length > 100) {
      cleanName = cleanName.substring(0, 97) + '...';
    }
    
    // Validate the name is not empty and not just punctuation
    if (!cleanName || /^[^a-zA-Z0-9]+$/.test(cleanName)) {
      logger.warn('[SheetName] AI generated invalid name, using fallback', { generated: cleanName });
      return fallbackName;
    }
    
    logger.info('[SheetName] Generated name', { name: cleanName });
    return cleanName;
    
  } catch (error) {
    logger.error('[SheetName] AI generation failed', { error: error.message });
    // Return fallback name on any error
    return `Scrape ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  }
}

/**
 * Build smart formatting requests for Google Sheets API
 * @param {number} sheetId - The sheet ID
 * @param {Array} headers - Column headers
 * @param {Array} values - 2D array of values
 * @param {Object} formatting - AI-generated formatting configuration
 * @returns {Array} - Array of formatting requests
 */
function buildSmartFormattingRequests(sheetId, headers, values, formatting) {
  const requests = [];
  
  // 1. Header row formatting with AI-suggested color
  requests.push({
    repeatCell: {
      range: {
        sheetId: sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 }, // White text
            fontSize: 11,
          },
          backgroundColor: formatting.headerColor,
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)',
    },
  });
  
  // 2. Alternating row colors (if suggested)
  if (formatting.alternateRows) {
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId: sheetId,
            startRowIndex: 1,
            endRowIndex: values.length,
          }],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: '=ISEVEN(ROW())' }],
            },
            format: {
              backgroundColor: { red: 0.95, green: 0.97, blue: 1 },
            },
          },
        },
        index: 0,
      },
    });
  }
  
  // 3. Column-specific formatting based on AI detection
  headers.forEach((header, colIdx) => {
    const colType = formatting.columnTypes[header];
    
    if (colType === 'currency') {
      requests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 1,
            endRowIndex: values.length,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'CURRENCY',
                pattern: '$#,##0.00',
              },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    } else if (colType === 'date') {
      requests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 1,
            endRowIndex: values.length,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'DATE',
                pattern: 'mmm dd, yyyy',
              },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    } else if (colType === 'percentage') {
      requests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 1,
            endRowIndex: values.length,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: 'PERCENT',
                pattern: '0.00%',
              },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    } else if (colType === 'url') {
      requests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 1,
            endRowIndex: values.length,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                foregroundColor: { red: 0.06, green: 0.47, blue: 0.85 },
                underline: true,
              },
            },
          },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    } else if (colType === 'email') {
      requests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 1,
            endRowIndex: values.length,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                foregroundColor: { red: 0.06, green: 0.47, blue: 0.85 },
              },
            },
          },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }
  });
  
  // 4. Auto-resize columns
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId: sheetId,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: headers.length,
      },
    },
  });
  
  // 5. Freeze rows and columns based on AI suggestion
  const frozenCols = Math.min(formatting.freezeColumns || 0, headers.length);
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: sheetId,
        gridProperties: {
          frozenRowCount: 1,
          frozenColumnCount: frozenCols,
        },
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });
  
  // 6. Add filter views for easy data filtering
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId: sheetId,
          startRowIndex: 0,
          endRowIndex: values.length,
          startColumnIndex: 0,
          endColumnIndex: headers.length,
        },
      },
    },
  });
  
  return requests;
}

/**
 * Use AI to analyze data and generate smart formatting suggestions
 * @param {Array} data - The data array (array of objects)
 * @param {Array} headers - Column headers
 * @returns {Promise<Object>} - Formatting configuration
 */
async function generateSmartFormatting(data, headers) {
  try {
    // Sample first 10 rows for analysis
    const sampleData = data.slice(0, 10);

    const prompt = `Analyze this spreadsheet data and suggest formatting:

Headers: ${JSON.stringify(headers)}
Sample Data (first 10 rows):
${JSON.stringify(sampleData, null, 2)}

Respond with ONLY a JSON object (no markdown, no explanations) with this structure:
{
  "columnTypes": {
    "columnName": "type"
  },
  "headerColor": {
    "red": 0.2,
    "green": 0.4,
    "blue": 0.8
  },
  "alternateRows": true,
  "freezeColumns": 0,
  "columnWidths": {}
}

Column type options: "currency", "date", "url", "email", "number", "text", "percentage"
Use headerColor values between 0-1 (RGB). Choose a professional color scheme.
Set freezeColumns to 1 if there's an ID/name column that should stay visible.
Leave columnWidths empty (we'll auto-resize).`;

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
      },
    });

    const text = response.text.trim();
    // Remove markdown code blocks if present
    const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonText);
    
    logger.info('[Sheets] AI formatting generated', { 
      columnTypes: Object.keys(parsed.columnTypes || {}).length,
      headerColor: parsed.headerColor 
    });
    
    return parsed;

  } catch (error) {
    logger.error('[Sheets] AI formatting failed', { error: error.message });
    // Return basic formatting as fallback
    return {
      headerColor: { red: 0.26, green: 0.52, blue: 0.96 }, // Material Blue
      alternateRows: true,
      freezeColumns: 0,
      columnTypes: {},
      columnWidths: {}
    };
  }
}

/**
 * Convert JSON array to 2D array for Sheets API
 * @param {Array} data - Array of objects
 * @returns {Array} - 2D array with headers in first row
 */
function dataTo2DArray(data) {
  if (!data || data.length === 0) {
    return [[]];
  }

  // Extract all unique keys from all objects (in case structure varies)
  const allKeys = new Set();
  data.forEach(row => {
    Object.keys(row).forEach(key => allKeys.add(key));
  });
  
  const headers = Array.from(allKeys);
  
  // Convert each object to array of values in same order as headers
  const rows = data.map(obj => {
    return headers.map(header => {
      const value = obj[header];
      // Handle null/undefined
      if (value === null || value === undefined) return '';
      // Convert objects/arrays to JSON strings
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  });
  
  return [headers, ...rows];
}

/**
 * Create a new Google Spreadsheet with data
 * @param {string} accessToken - User's OAuth access token
 * @param {string} title - Spreadsheet title
 * @param {Array} data - Array of objects to populate
 * @param {boolean} smartFormatting - Whether to use AI-powered formatting (default: true)
 * @returns {Promise<Object>} - { spreadsheetId, spreadsheetUrl }
 */
async function createSpreadsheet(accessToken, title, data, smartFormatting = true) {
  try {
    logger.info('[Sheets] Creating spreadsheet', { title, rows: data?.length || 0 });
    
    // Initialize Google Sheets API with user's token
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Create new spreadsheet
    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: title,
        },
        sheets: [
          {
            properties: {
              title: 'Data',
              gridProperties: {
                frozenRowCount: 1, // Freeze header row
              },
            },
          },
        ],
      },
    });
    
    const spreadsheetId = createResponse.data.spreadsheetId;
    const spreadsheetUrl = createResponse.data.spreadsheetUrl;
    const sheetId = createResponse.data.sheets[0].properties.sheetId;
    
    logger.info('[Sheets] Spreadsheet created', { spreadsheetId, url: spreadsheetUrl, sheetId });
    
    // If we have data, populate it
    if (data && data.length > 0) {
      const values = dataTo2DArray(data);
      
      // Write data in batches if large dataset
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(values.length / BATCH_SIZE);
      
      for (let i = 0; i < totalBatches; i++) {
        const startIdx = i * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, values.length);
        const batchValues = values.slice(startIdx, endIdx);
        
        // Calculate range (A1 notation)
        const startRow = startIdx + 1; // +1 for 1-based indexing
        const endRow = endIdx;
        const endCol = String.fromCharCode(65 + (values[0]?.length || 1) - 1); // A, B, C, etc.
        const range = `Data!A${startRow}:${endCol}${endRow}`;
        
        logger.debug('[Sheets] Writing batch', { 
          batch: i + 1, 
          totalBatches, 
          range,
          rows: batchValues.length 
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          requestBody: {
            values: batchValues,
          },
        });
      }
      
      const headers = values[0];
      
      // Build formatting requests
      const requests = [];
      
      // Conditionally use AI-powered formatting or basic formatting
      if (smartFormatting) {
        logger.info('[Sheets] Generating smart formatting with AI...');
        const formatting = await generateSmartFormatting(data, headers);
        
        // Apply AI-powered formatting
        requests.push(...buildSmartFormattingRequests(sheetId, headers, values, formatting));
      } else {
        logger.info('[Sheets] Applying basic formatting...');
        // Apply basic formatting (bold header with gray background)
        requests.push({
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                textFormat: {
                  bold: true,
                },
                backgroundColor: {
                  red: 0.95,
                  green: 0.95,
                  blue: 0.95,
                },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        });
      }
      
      // Apply all formatting
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
      
      logger.info('[Sheets] Data written and formatted', { 
        rows: data.length,
        formattingType: smartFormatting ? 'AI-powered' : 'Basic',
        formattingRules: requests.length
      });
    }
    
    return {
      spreadsheetId,
      spreadsheetUrl,
    };
    
  } catch (error) {
    logger.error('[Sheets] Error creating spreadsheet', { 
      error: error.message,
      code: error.code,
      status: error.status,
    });
    
    // Provide more specific error messages
    if (error.code === 401 || error.status === 401) {
      throw new Error('Invalid or expired access token. Please re-authenticate.');
    } else if (error.code === 403 || error.status === 403) {
      throw new Error('Permission denied. Please ensure Sheets API is enabled and authorized.');
    } else if (error.code === 429 || error.status === 429) {
      throw new Error('API rate limit exceeded. Please try again in a few minutes.');
    } else {
      throw new Error(`Failed to create spreadsheet: ${error.message}`);
    }
  }
}

module.exports = {
  createSpreadsheet,
  generateSheetName,
  generateSmartFormatting,
};


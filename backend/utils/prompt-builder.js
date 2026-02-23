function buildPrompt(markdown, instruction) {
  return `Extract structured data from the Markdown below.

 Instruction: "${instruction}"

 Rules:
 - Return ONLY a valid JSON array of objects
 - Extract ALL matching items (no limits)
 - Use consistent keys based on the instruction
 - If no data found, return []
 - Do not include markdown formatting or explanations
 - Be exhaustive - do not skip any items
 - Extract ALL matching items in the order they appear on the page

 Markdown:
 ${markdown}

 JSON Array:`;
}

module.exports = {
  buildPrompt,
};

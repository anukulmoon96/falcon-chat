import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { sleep } from '../lib/http.js';

let client;
function getClient() {
  if (!client) {
    client = config.gemini.vertex
      ? new GoogleGenAI({ vertexai: true, project: config.gemini.project, location: config.gemini.location })
      : new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return client;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

async function generateJson({ model, system, prompt, schema }) {
  const generationConfig = {
    systemInstruction: system,
    responseMimeType: 'application/json',
    responseJsonSchema: schema,
  };
  if (config.gemini.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: config.gemini.thinkingLevel };
  if (config.gemini.temperature !== undefined) generationConfig.temperature = config.gemini.temperature;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // `prompt` is text, or an array of parts (text plus inline images/files).
      const contents = Array.isArray(prompt) ? [{ role: 'user', parts: prompt }] : prompt;
      const response = await getClient().models.generateContent({ model, contents, config: generationConfig });
      const text = String(response.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const usage = response.usageMetadata || {};
      return {
        data: JSON.parse(text),
        usage: {
          input: usage.promptTokenCount || 0,
          output: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
        },
      };
    } catch (err) {
      lastError = err;
      const status = Number(err?.status ?? err?.code);
      const retryable = err instanceof SyntaxError || RETRYABLE.has(status);
      if (!retryable || attempt === 2) break;
      await sleep(700 * 2 ** attempt);
    }
  }
  throw lastError;
}

// Wrapped in an object so tests can swap in a fake model.
export const llm = { generateJson };

import axios from 'axios';
import * as cheerio from 'cheerio';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { franc } = require('franc');
const dotenv = require('dotenv');
dotenv.config();

// Truncate text to avoid model input limit
function truncateText(text, maxChars = 8000) {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

// Scrape full paragraphs from pages in the detected language
async function scrapeLanguageContent(query, langCode) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  try {
    const html = (await axios.get(url, { headers })).data;
    const $ = cheerio.load(html);

    let fullText = '';
    $('p, span, li, div').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 50 && franc(text) === langCode) {
        fullText += text + '\n';
      }
    });

    return fullText;
  } catch (err) {
    console.error(`❌ Failed to scrape for query: ${query}`);
    return '';
  }
}

async function askClaude(prompt) {
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  const cmd = new ConverseCommand({
    modelId: process.env.CLAUDE_MODEL_ID,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 512, temperature: 0.7 }
  });
  const out = await client.send(cmd);
  return out.output.message.content[0].text;
}

// MAIN
const userInput = process.argv.slice(2).join(' ');
if (!userInput) {
  console.log('❗ Please provide input text.');
  process.exit(1);
}

console.log(`🔍 Detecting language...`);
const langCode = franc(userInput) || 'und';
console.log(`🌐 Detected language code: ${langCode}`);

console.log(`🌐 Scraping content in this language...`);
let scrapedText = await scrapeLanguageContent(userInput, langCode);

if (!scrapedText || scrapedText.length < 200) {
  console.log(`⚠️ Not enough usable content found, attempting fallback translation strategy.`);
  scrapedText = `You don't have enough examples in this language.
Use general reasoning to guess an answer.
If unsure, respond in English and say you're learning.`;
}

console.log(`📚 Training model with scraped data...`);
const trainingData = truncateText(scrapedText, 8000);

const prompt = `
You're an AI learning a new language.
Here is the knowledge you gathered:

${trainingData}

Now answer the following question in that language.

Q: ${userInput}
A:
`.trim();

console.log(`🤖 Sending to Claude...`);
const response = await askClaude(prompt);
console.log(`\n🧠 Claude’s Response:\n${response}`);

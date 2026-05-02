import { OpenAI } from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const PRIMARY_MODEL = "Kimi-K2.5";
const EXTRACTOR_MODEL = "Kimi-K2.5";
const MAX_RETRIES = 3;
const BASE_DELAY = 2; // seconds

const EXTRACTOR_SYSTEM_PROMPT = `You are a Background Memory Agent. Your job is to extract long-term permanent facts about the user from their message.
Extract things like: real name, age, hobbies, likes/dislikes, relationships, or major life events.
Respond ONLY with a valid JSON Array of strings. If no meaningful permanent fact is found, return [].
Example: ["user's name is andi", "user likes rain", "user broke up recently"]`;

async function _retry(apiCall, label = "api_call") {
    let lastExc = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await apiCall();
        } catch (exc) {
            lastExc = exc;
            const waitTime = Math.pow(BASE_DELAY, attempt);
            console.warn(`${label} attempt ${attempt}/${MAX_RETRIES} failed. Retrying in ${waitTime}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        }
    }
    throw lastExc;
}

export async function getChatResponse(apiKey, baseUrl, messages, temperature = 0.7, maxTokens = 300) {
    const client = new OpenAI({ apiKey, baseURL: baseUrl });

    try {
        const resp = await _retry(
            () => client.chat.completions.create({
                model: PRIMARY_MODEL,
                messages: messages,
                temperature: temperature,
                max_tokens: maxTokens,
            }),
            `chat/${PRIMARY_MODEL}`
        );
        
        if (resp.choices && resp.choices[0]) {
            console.log(`[DEBUG] AI generated ${resp.usage?.completion_tokens || 0} tokens.`);
            const text = resp.choices[0].message?.content;
            return text ? text.trim() : "ah... aku... bingung mau jawab apa...";
        }
        return "ah... aku... bingung mau jawab apa...";
    } catch (exc) {
        console.error(`Model ${PRIMARY_MODEL} exhausted retries:`, exc);
        return "ah... maaf... aku lagi nggak bisa mikir... coba lagi nanti ya...";
    }
}

export async function extractMemory(apiKey, baseUrl, userMessage) {
    const client = new OpenAI({ apiKey, baseURL: baseUrl });

    const messages = [
        { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
    ];

    try {
        const resp = await _retry(
            () => client.chat.completions.create({
                model: EXTRACTOR_MODEL,
                messages: messages,
                temperature: 0.0,
                max_tokens: 300,
            }),
            "extract_memory"
        );
        const raw = resp.choices[0].message.content || "[]";
        const facts = JSON.parse(raw);
        if (Array.isArray(facts)) {
            return facts.filter(f => f).map(String);
        }
    } catch (exc) {
        if (exc instanceof SyntaxError) {
            console.warn("Extractor returned non-JSON.");
        } else {
            console.error("Memory extraction failed:", exc);
        }
    }
    return [];
}

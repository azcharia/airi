import { OpenAI } from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.AZURE_API_KEY;
const endpoint = process.env.AZURE_ENDPOINT;
const model = "Kimi-K2.5";

async function testAzure() {
    console.log("=== Azure AI Foundry Connectivity Test ===");
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Model: ${model}`);

    if (!apiKey || !endpoint) {
        console.error("Error: AZURE_API_KEY or AZURE_ENDPOINT missing in .env");
        return;
    }

    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: endpoint
    });

    try {
        console.log("Sending request (max_tokens: 500)...");
        const response = await client.chat.completions.create({
            model: model,
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Say 'Hello World' and nothing else." }
            ],
            max_tokens: 500
        });

        console.log("\n--- Full Message Object ---");
        console.log(JSON.stringify(response.choices[0].message, null, 2));
        console.log("\nMessage Keys:", Object.keys(response.choices[0].message));
        
        const msg = response.choices[0].message;
        const content = msg.content || msg.reasoning_content || "";
        console.log("\nFinal Extracted Content:", content);
    } catch (error) {
        console.error("\n--- API Error ---");
        console.error(error);
    }
}

testAzure();

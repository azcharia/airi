import { ShortTermMemory } from './src/memory.js';

// Mocking external systems for simulation
const mockLTM = {
    facts: [],
    getFacts: async (id) => mockLTM.facts,
    saveFacts: async (id, facts) => { mockLTM.facts = [...new Set([...mockLTM.facts, ...facts])]; },
    incrementMessageCount: async (id) => 1
};

const mockAI = {
    getChatResponse: async (history) => {
        return "aku... senang bisa bicara dengan kamu... tapi aku agak malu...";
    },
    extractMemory: async (msg) => {
        if (msg.includes("nama aku")) return ["user's name is andi"];
        return [];
    }
};

function postProcessAiri(text) {
    let t = text.toLowerCase().trim();
    t = t.replace(/\*[^*]*\*/g, ""); 
    t = t.replace(/\./g, "...");
    t = t.replace(/ {2,}/g, " ");
    return t;
}

async function simulateConversation() {
    console.log("=== Airi Simulation (Mocked Environment) ===");
    const userId = "sim-123";
    const stm = new ShortTermMemory(5);
    
    const userInput = "halo airi... nama aku andi... apa kabar?";
    console.log(`[User]: ${userInput}`);

    // 1. Get facts
    const facts = await mockLTM.getFacts(userId);
    
    // 2. Build context
    stm.add(userId, "user", userInput);
    const history = stm.get(userId);
    
    // 3. Get AI response
    let reply = await mockAI.getChatResponse(history);
    reply = postProcessAiri(reply);
    
    // 4. Update memory
    stm.add(userId, "assistant", reply);
    console.log(`[Airi]: ${reply}`);

    // 5. Simulate fact extraction
    const newFacts = await mockAI.extractMemory(userInput);
    if (newFacts.length > 0) {
        await mockLTM.saveFacts(userId, newFacts);
        console.log(`[System]: Airi remembered: ${newFacts.join(", ")}`);
    }

    console.log("\n[Status]: Current Facts in LTM:", await mockLTM.getFacts(userId));
    console.log("=== Simulation Finished ===");
}

simulateConversation();

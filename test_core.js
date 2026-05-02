import { ShortTermMemory } from './src/memory.js';

// Mock postProcessAiri since it's not exported from index.js
function postProcessAiri(text) {
    let t = text.toLowerCase();
    t = t.replace(/\*[^*]*\*/g, ""); // Strip roleplay actions
    
    // Replace hard punctuation -> ellipsis
    t = t.replace(/\.\.\./g, "\x00");
    t = t.replace(/\./g, "...");
    t = t.replace(/,/g, "...");
    t = t.replace(/!/g, "...");
    t = t.replace(/\?/g, "...");
    t = t.replace(/\x00/g, "...");
    
    // Collapse runs of dots
    t = t.replace(/\.{4,}/g, "...");
    
    // Clean multiple spaces
    t = t.replace(/ {2,}/g, " ");
    return t.trim();
}

console.log("--- Testing Persona Post-Processing ---");
const testCases = [
    { input: "HELLO WORLD!", expected: "hello world..." },
    { input: "I am happy. How are you?", expected: "i am happy... how are you..." },
    { input: "This is a *blushes* secret.", expected: "this is a secret..." },
    { input: "Wait... what???", expected: "wait... what..." },
    { input: "Multiple    spaces.", expected: "multiple spaces..." }
];

testCases.forEach(({ input, expected }, index) => {
    const result = postProcessAiri(input);
    const passed = result === expected;
    console.log(`Test ${index + 1}: ${passed ? "PASSED" : "FAILED"}`);
    if (!passed) {
        console.log(`  Input:    "${input}"`);
        console.log(`  Expected: "${expected}"`);
        console.log(`  Got:      "${result}"`);
    }
});

console.log("\n--- Testing Short-Term Memory ---");
const stm = new ShortTermMemory(3); // Max length 3 for testing
const userId = "user123";

stm.add(userId, "user", "msg 1");
stm.add(userId, "assistant", "reply 1");
stm.add(userId, "user", "msg 2");

let history = stm.get(userId);
console.log(`History length after 3 messages: ${history.length} (Expected: 3)`);

stm.add(userId, "assistant", "reply 2");
history = stm.get(userId);
console.log(`History length after 4 messages (limit 3): ${history.length} (Expected: 3)`);
console.log(`First message: "${history[0].content}" (Expected: "reply 1")`);

const passedStm = history.length === 3 && history[0].content === "reply 1";
console.log(`STM Test: ${passedStm ? "PASSED" : "FAILED"}`);

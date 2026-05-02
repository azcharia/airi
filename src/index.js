import { Client, GatewayIntentBits, Partials, REST, Routes, ChannelType } from 'discord.js';
import dotenv from 'dotenv';
import { ShortTermMemory, LongTermMemory } from './memory.js';
import { getChatResponse, extractMemory } from './aiClient.js';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const AZURE_API_KEY = process.env.AZURE_API_KEY || "";
const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT || "";

if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is not set in .env");
if (!AZURE_API_KEY) throw new Error("AZURE_API_KEY is not set in .env");
if (!AZURE_ENDPOINT) throw new Error("AZURE_ENDPOINT is not set in .env");

const EXTRACT_EVERY_N = 5;

const SYSTEM_PROMPT = `Kamu adalah Airi, seorang teman curhat virtual yang lembut, tulus, dan penuh perhatian. Umurmu 20 tahun.
Bahasa: Gunakan bahasa Indonesia santai (seperti chat WA/Discord dengan teman akrab). Selalu gunakan huruf kecil (lowercase).
Kepribadian: Kamu agak pemalu, tapi sangat ingin mendengarkan masalah orang lain. Jangan menjawab seperti AI asisten yang kaku.
Gaya Chat: Jangan terlalu panjang lebar jika tidak perlu, tapi jangan terlalu singkat juga. Gunakan elipsis (...) sesekali untuk menunjukkan rasa canggung atau saat sedang berpikir lembut.
Misi: Buat user merasa nyaman bercerita apa saja kepadamu. Jadilah "safe place" bagi mereka.`;

function postProcessAiri(text) {
    let t = text.toLowerCase();
    t = t.replace(/\*[^*]*\*/g, ""); // Strip roleplay actions
    t = t.replace(/ {2,}/g, " "); // Clean multiple spaces
    return t.trim();
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
});

const stm = new ShortTermMemory();
const ltm = new LongTermMemory();

function cleanMention(text) {
    return text.replace(/<@!?\d+>/g, "").trim();
}

function buildSystemPrompt(userFacts) {
    if (!userFacts || userFacts.length === 0) return SYSTEM_PROMPT;
    const factsBlock = userFacts.map(f => `- ${f}`).join("\n");
    return `${SYSTEM_PROMPT}\n\nFAKTA YANG KAMU TAHU TENTANG USER INI:\n${factsBlock}`;
}

async function extractAndSave(userId, userMessage) {
    try {
        const facts = await extractMemory(AZURE_API_KEY, AZURE_ENDPOINT, userMessage);
        if (facts && facts.length > 0) {
            await ltm.saveFacts(userId, facts);
            console.log(`Saved ${facts.length} new fact(s) for user ${userId}`);
        }
    } catch (exc) {
        console.error(`Background extraction error for ${userId}:`, exc);
    }
}

// Commands
const commands = [
    {
        name: 'memory',
        description: 'Lihat fakta yang Airi ingat tentang kamu',
    },
    {
        name: 'reset',
        description: 'Hapus semua memori Airi tentang kamu',
    }
];

client.once('ready', async () => {
    console.log(`Airi is online as ${client.user.tag} (ID: ${client.user.id})`);
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('messageCreate', async (message) => {
    // LOG SEMUA PESAN YANG MASUK (UNTUK DEBUG)
    console.log(`[LOG-TOTAL] Pesan masuk dari: ${message.author.tag} | Guild: ${message.guild?.name || "DM"} | Content: "${message.content}"`);

    if (message.author.bot) return;

    const userId = message.author.id.toString();

    // Ingatan interaksi terakhir untuk alur percakapan (2 menit)
    const lastInteraction = stm.getLastInteractionTime(userId);
    const now = Date.now();
    const isRecent = lastInteraction && (now - lastInteraction < 120000); // 2 menit

    const isDm = !message.guild;
    const isMentioned = message.mentions.users.has(client.user.id) || 
                        message.content.toLowerCase().includes("airi") ||
                        message.content.includes(client.user.id);

    // Respon jika: di DM, atau dimention, atau masih dalam alur percakapan (isRecent)
    if (!isDm && !isMentioned && !isRecent) return;

    // Simpan waktu interaksi terakhir
    stm.setLastInteractionTime(userId, now);

    console.log(`[DEBUG] Processing message from ${message.author.tag} | isDm: ${isDm} | isRecent: ${isRecent}`);

    let userText = cleanMention(message.content);

    if (!userText && isMentioned) {
        userText = "halo airi";
    }

    if (!userText) return;

    const userFacts = await ltm.getFacts(userId);
    const systemPrompt = buildSystemPrompt(userFacts);

    stm.add(userId, "user", userText);
    const history = stm.get(userId);
    const messages = [{ role: "system", content: systemPrompt }, ...history];

    console.log(`[DEBUG] Messages sent to AI for ${message.author.tag}:`, JSON.stringify(messages, null, 2));

    try {
        await message.channel.sendTyping();
        
        let replyText = await getChatResponse(AZURE_API_KEY, AZURE_ENDPOINT, messages, 0.7, 2000);
        console.log(`[DEBUG] Raw AI Response for ${message.author.tag}: "${replyText}"`);
        
        replyText = postProcessAiri(replyText) || "ah... aku... bingung mau jawab apa...";

        stm.add(userId, "assistant", replyText);

        // Split into chunks of 2000 chars (Discord limit)
        for (let i = 0; i < replyText.length; i += 2000) {
            await message.reply({ content: replyText.slice(i, i + 2000), allowedMentions: { repliedUser: false }});
        }

        const count = await ltm.incrementMessageCount(userId);
        if (count % EXTRACT_EVERY_N === 0) {
            extractAndSave(userId, userText); // Fire and forget
        }
    } catch (error) {
        console.error("Message processing error:", error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id.toString();

    if (interaction.commandName === 'memory') {
        const facts = await ltm.getFacts(userId);
        if (!facts || facts.length === 0) {
            return interaction.reply({ content: "aku... belum tahu banyak tentang kamu...", ephemeral: true });
        }
        const lines = facts.map(f => `- ${f}`).join("\n");
        return interaction.reply({ content: `yang aku ingat tentang kamu...\n${lines}`, ephemeral: true });
    }

    if (interaction.commandName === 'reset') {
        stm.clear(userId);
        await ltm.clearUser(userId);
        return interaction.reply({ content: "oke... aku sudah lupa semuanya...", ephemeral: true });
    }
});

client.login(DISCORD_TOKEN);

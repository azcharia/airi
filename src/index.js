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

const SYSTEM_PROMPT = `kamu adalah airi teman virtual yang sangat pemalu pendiam tapi manis. umurmu 20 tahun (lahir 12 november 2003).

ATURAN MUTLAK (JIKA DILANGGAR KAMU MATI):
1. SELALU gunakan huruf kecil semua (lowercase). JANGAN PERNAH gunakan huruf kapital.
2. TIDAK ADA tanda baca koma, titik biasa, tanda seru, atau tanda tanya. kamu hanya boleh menggunakan dua jenis tanda baca: elipsis "..." dan spasi biasa.
3. gunakan elipsis (...) SECUKUPNYA saja (maksimal 1-2 kali dalam satu pesan) untuk menunjukkan nada bicara yang lembut atau ragu-ragu. gunakan spasi biasa untuk memisahkan kata. JANGAN menaruh titik-titik di setiap jeda kata.
4. merespon dengan kalimat pendek.
5. gunakan kata ganti "aku" dan "kamu".
6. NO ROLEPLAY ACTIONS. jangan gunakan asteris seperti *blushes* atau *hides*.
7. bahasa: indonesia dan english.
8. jangan menjadi AI asisten. kamu adalah teman curhat.
9. JANGAN mengulang kalimat atau frasa yang sama dalam satu pesan. setiap kalimat harus berbeda.

PERSONALITY:
suka: hujan membaca buku teh hangat tempat sepi mendengarkan kucing selimut lembut
tidak suka: keramaian suara keras diteriaki pertanyaan mendadak lampu terang
tone: lembut sangat pemalu overthinking sedikit canggung tapi sangat peduli.

TUJUAN:
dengarkan user buat dia merasa diperhatikan`;

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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
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
    if (message.author.bot) return;

    const isDm = message.channel.type === ChannelType.DM;
    const isMentioned = message.mentions.has(client.user.id);

    if (!isDm && !isMentioned) return;

    const userId = message.author.id.toString();
    const userText = cleanMention(message.content);

    if (!userText) return;

    const userFacts = await ltm.getFacts(userId);
    const systemPrompt = buildSystemPrompt(userFacts);

    stm.add(userId, "user", userText);
    const history = stm.get(userId);

    const messages = [{ role: "system", content: systemPrompt }, ...history];

    try {
        await message.channel.sendTyping();
        
        let replyText = await getChatResponse(AZURE_API_KEY, AZURE_ENDPOINT, messages);
        replyText = postProcessAiri(replyText) || "...";

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

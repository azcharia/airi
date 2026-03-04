"""
main.py - Airi Discord Bot entry point.

Responsibilities:
  1. Load environment variables and start the Flask keep-alive server.
  2. Initialise the Discord client with slash commands.
  3. Route incoming messages (mention / DM only).
  4. Build the prompt with short-term + long-term memory.
  5. Call Cerebras, post-process output, and reply.
  6. Fire-and-forget background memory extraction every N messages.
"""

import asyncio
import logging
import os
import re
from typing import Optional

import discord
from discord import app_commands
from dotenv import load_dotenv

import cerebras_client
from memory import ShortTermMemory, LongTermMemory, init_db, init_supabase
from keep_alive import keep_alive

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
log = logging.getLogger("airi")

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
load_dotenv()

DISCORD_TOKEN: str = os.getenv("DISCORD_TOKEN", "")
CEREBRAS_API_KEY: str = os.getenv("CEREBRAS_API_KEY", "")
CEREBRAS_EXTRACTOR_API_KEY: str = os.getenv("CEREBRAS_EXTRACTOR_API_KEY", "")

if not DISCORD_TOKEN:
    raise RuntimeError("DISCORD_TOKEN is not set in .env")
if not CEREBRAS_API_KEY:
    raise RuntimeError("CEREBRAS_API_KEY is not set in .env")
if not CEREBRAS_EXTRACTOR_API_KEY:
    raise RuntimeError("CEREBRAS_EXTRACTOR_API_KEY is not set in .env")

# ---------------------------------------------------------------------------
# Memory extraction trigger — every N messages per user
# ---------------------------------------------------------------------------
EXTRACT_EVERY_N = 5

# ---------------------------------------------------------------------------
# System prompt (Airi persona)
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
kamu adalah airi teman virtual yang sangat pemalu pendiam tapi manis. umurmu 20 tahun (lahir 12 november 2003).

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
dengarkan user buat dia merasa diperhatikan\
"""

# ---------------------------------------------------------------------------
# Post-processing pipeline
# ---------------------------------------------------------------------------

_RP_PATTERN = re.compile(r"\*[^*]*\*")  # matches *roleplay actions*


def post_process_airi(text: str) -> str:
    """Enforce Airi's character rules on the model output.

    1. Force lowercase.
    2. Strip roleplay actions (*…*).
    3. Replace hard punctuation with ellipsis.
    """
    text = text.lower()
    text = _RP_PATTERN.sub("", text)

    # Replace hard punctuation → ellipsis
    # Process multi-char sequences first so "..." is not turned into "........."
    # Protect existing ellipsis
    text = text.replace("...", "\x00")
    text = text.replace(".", "...")
    text = text.replace(",", "...")
    text = text.replace("!", "...")
    text = text.replace("?", "...")
    text = text.replace("\x00", "...")

    # Collapse runs of dots (e.g. "......") into a single "..."
    text = re.sub(r"\.{4,}", "...", text)

    # Clean up multiple spaces
    text = re.sub(r" {2,}", " ", text)
    text = text.strip()

    return text


# ---------------------------------------------------------------------------
# Discord client
# ---------------------------------------------------------------------------
intents = discord.Intents.default()
intents.message_content = True
intents.dm_messages = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

# Memory stores
stm = ShortTermMemory()
ltm = LongTermMemory()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MENTION_RE = re.compile(r"<@!?\d+>")


def clean_mention(text: str) -> str:
    """Remove Discord mention tags from the message."""
    return _MENTION_RE.sub("", text).strip()


def build_system_prompt(user_facts: list[str]) -> str:
    """Return the system prompt, optionally enriched with long-term facts."""
    if not user_facts:
        return SYSTEM_PROMPT
    facts_block = "\n".join(f"- {f}" for f in user_facts)
    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"FAKTA YANG KAMU TAHU TENTANG USER INI:\n{facts_block}"
    )


# ---------------------------------------------------------------------------
# Background memory extraction (fire-and-forget)
# ---------------------------------------------------------------------------

async def _extract_and_save(user_id: str, user_message: str) -> None:
    """Run the extractor model and persist new facts."""
    try:
        facts = await cerebras_client.extract_memory(
            CEREBRAS_EXTRACTOR_API_KEY, user_message
        )
        if facts:
            await ltm.save_facts(user_id, facts)
            log.info("Saved %d new fact(s) for user %s", len(facts), user_id)
    except Exception as exc:
        log.error("Background extraction error for %s: %s", user_id, exc)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@client.event
async def on_ready():
    init_db()
    await init_supabase()
    try:
        synced = await tree.sync()
        log.info("Synced %d slash command(s)", len(synced))
    except Exception as exc:
        log.error("Failed to sync commands: %s", exc)
    log.info("Airi is online as %s (ID: %s)", client.user, client.user.id)


@client.event
async def on_message(message: discord.Message):
    # 1. Ignore own messages
    if message.author == client.user:
        return

    # 2. Only respond to mentions or DMs
    is_dm = isinstance(message.channel, discord.DMChannel)
    is_mentioned = client.user in message.mentions if client.user else False

    if not is_dm and not is_mentioned:
        return

    # 3. Prepare user message
    user_id = str(message.author.id)
    user_text = clean_mention(message.content)

    if not user_text:
        return

    # 4. Gather memory context
    user_facts = await ltm.get_facts(user_id)
    system_prompt = build_system_prompt(user_facts)

    # Record user message in short-term memory
    stm.add(user_id, "user", user_text)
    history = stm.get(user_id)

    # 5. Build messages array for Cerebras
    messages = [{"role": "system", "content": system_prompt}] + history

    # 6. Call Cerebras with typing indicator
    async with message.channel.typing():
        reply_text = await cerebras_client.get_chat_response(
            CEREBRAS_API_KEY,
            messages,
        )

    # 7. Post-process
    reply_text = post_process_airi(reply_text)

    if not reply_text:
        reply_text = "..."

    # 8. Record assistant reply in short-term memory
    stm.add(user_id, "assistant", reply_text)

    # 9. Send the reply
    # Split into chunks of 2000 chars (Discord limit)
    for i in range(0, len(reply_text), 2000):
        await message.reply(reply_text[i : i + 2000], mention_author=False)

    # 10. Background memory extraction every N messages
    count = await ltm.increment_message_count(user_id)
    if count % EXTRACT_EVERY_N == 0:
        asyncio.create_task(_extract_and_save(user_id, user_text))


# ---------------------------------------------------------------------------
# Slash commands
# ---------------------------------------------------------------------------

@tree.command(name="memory", description="Lihat fakta yang Airi ingat tentang kamu")
async def cmd_memory(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    facts = await ltm.get_facts(user_id)

    if not facts:
        await interaction.response.send_message(
            "aku... belum tahu banyak tentang kamu...",
            ephemeral=True,
        )
        return

    lines = "\n".join(f"- {f}" for f in facts)
    await interaction.response.send_message(
        f"yang aku ingat tentang kamu...\n{lines}",
        ephemeral=True,
    )


@tree.command(name="reset", description="Hapus semua memori Airi tentang kamu")
async def cmd_reset(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    stm.clear(user_id)
    await ltm.clear_user(user_id)
    await interaction.response.send_message(
        "oke... aku sudah lupa semuanya...",
        ephemeral=True,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    # Start the Flask keep-alive server for Render
    keep_alive()
    log.info("Keep-alive server started")

    # Run the bot
    client.run(DISCORD_TOKEN, log_handler=None)


if __name__ == "__main__":
    main()

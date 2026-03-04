"""
memory.py - Two-tier memory system for Airi.

Short-Term Memory : collections.deque(maxlen=10) per user — in-process,
                    used as conversation context sent to the chat model.
Long-Term Memory  : Supabase (PostgreSQL) — persistent facts about each
                    user, extracted by a background AI task. Survives
                    Render restarts.

==========================================================================
SQL SCRIPT — run this ONCE in the Supabase SQL Editor before starting bot:
--------------------------------------------------------------------------
create table if not exists public.users (
    user_id       text        primary key,
    facts         jsonb       not null default '[]'::jsonb,
    message_count integer     not null default 0,
    last_updated  timestamptz          default now()
);

-- Enable Row Level Security and allow service-role full access
alter table public.users enable row level security;

create policy "service role full access"
    on public.users
    for all
    using (true)
    with check (true);
==========================================================================
"""

import json
import logging
import os
from collections import deque
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import AsyncClient, acreate_client

load_dotenv()

log = logging.getLogger("airi.memory")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SHORT_TERM_MAX = 10    # conversation turns kept per user
TABLE = "users"        # Supabase table name

# ---------------------------------------------------------------------------
# Supabase async client — initialised once at startup via init_supabase()
# ---------------------------------------------------------------------------
_supabase: AsyncClient | None = None


def init_db() -> None:
    """No-op kept for API compatibility with main.py.

    Table creation is handled via the SQL script in this module's docstring.
    The actual async client is initialised by init_supabase().
    """
    pass


async def init_supabase() -> None:
    """Create and store the Supabase async client.

    Must be called once before any LongTermMemory methods are used.
    Raises RuntimeError if the required environment variables are missing.
    """
    global _supabase
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set in .env"
        )
    _supabase = await acreate_client(url, key)
    project_id = url.split("//")[-1].split(".")[0]
    log.info("Supabase async client ready (project: %s)", project_id)


def _client() -> AsyncClient:
    if _supabase is None:
        raise RuntimeError(
            "Supabase client not initialised — call await init_supabase() first"
        )
    return _supabase


# ---------------------------------------------------------------------------
# Short-Term Memory (in-process, per user)
# ---------------------------------------------------------------------------

class ShortTermMemory:
    """Manages per-user message history using a bounded deque."""

    def __init__(self, maxlen: int = SHORT_TERM_MAX):
        self._store: dict[str, deque] = {}
        self._maxlen = maxlen

    def add(self, user_id: str, role: str, content: str) -> None:
        if user_id not in self._store:
            self._store[user_id] = deque(maxlen=self._maxlen)
        self._store[user_id].append({"role": role, "content": content})

    def get(self, user_id: str) -> list[dict]:
        return list(self._store.get(user_id, []))

    def clear(self, user_id: str) -> None:
        self._store.pop(user_id, None)


# ---------------------------------------------------------------------------
# Long-Term Memory (Supabase / PostgreSQL)
# ---------------------------------------------------------------------------

class LongTermMemory:
    """Manages persistent user facts stored in Supabase."""

    # -- read --
    @staticmethod
    async def get_facts(user_id: str) -> list[str]:
        try:
            res = (
                await _client()
                .table(TABLE)
                .select("facts")
                .eq("user_id", user_id)
                .execute()
            )
            if res.data:
                raw = res.data[0]["facts"]
                # Supabase returns JSONB columns already deserialised as Python list
                if isinstance(raw, list):
                    return raw
                # Fallback: parse if returned as JSON string
                return json.loads(raw) if raw else []
        except Exception as exc:
            log.error("get_facts error for %s: %s", user_id, exc)
        return []

    # -- write / upsert --
    @staticmethod
    async def save_facts(user_id: str, new_facts: list[str]) -> None:
        try:
            # Fetch existing facts first for deduplication
            existing = await LongTermMemory.get_facts(user_id)
            existing_lower = {f.lower() for f in existing}
            for fact in new_facts:
                if fact.lower() not in existing_lower:
                    existing.append(fact)
                    existing_lower.add(fact.lower())

            now = datetime.now(timezone.utc).isoformat()
            await (
                _client()
                .table(TABLE)
                .upsert(
                    {
                        "user_id": user_id,
                        "facts": existing,   # pass list — Supabase handles JSONB
                        "last_updated": now,
                    },
                    on_conflict="user_id",
                )
                .execute()
            )
        except Exception as exc:
            log.error("save_facts error for %s: %s", user_id, exc)

    # -- message counter --
    @staticmethod
    async def increment_message_count(user_id: str) -> int:
        """Increment and return the new message count for the user."""
        try:
            res = (
                await _client()
                .table(TABLE)
                .select("message_count")
                .eq("user_id", user_id)
                .execute()
            )
            current: int = res.data[0]["message_count"] if res.data else 0
            new_count = current + 1
            now = datetime.now(timezone.utc).isoformat()

            await (
                _client()
                .table(TABLE)
                .upsert(
                    {
                        "user_id": user_id,
                        "message_count": new_count,
                        "last_updated": now,
                    },
                    on_conflict="user_id",
                )
                .execute()
            )
            return new_count
        except Exception as exc:
            log.error("increment_message_count error for %s: %s", user_id, exc)
            return 0

    # -- reset --
    @staticmethod
    async def clear_user(user_id: str) -> None:
        try:
            await (
                _client()
                .table(TABLE)
                .delete()
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            log.error("clear_user error for %s: %s", user_id, exc)


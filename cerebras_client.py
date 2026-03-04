"""
cerebras_client.py - Async wrapper around the Cerebras Cloud SDK.

Provides:
  - get_chat_response() : chat completions with the primary model
  - extract_memory()    : background fact extraction with the small model
  - Exponential-backoff retry logic for transient API errors
"""

import asyncio
import json
import logging
from typing import Optional

from cerebras.cloud.sdk import AsyncCerebras

log = logging.getLogger("airi.cerebras")

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
PRIMARY_MODEL = "gpt-oss-120b"
FALLBACK_MODEL = "llama3.1-8b"
EXTRACTOR_MODEL = "llama3.1-8b"

# ---------------------------------------------------------------------------
# Retry settings
# ---------------------------------------------------------------------------
MAX_RETRIES = 3
BASE_DELAY = 2  # seconds


async def _retry(coro_factory, label: str = "api_call"):
    """Execute an async callable with exponential backoff.

    ``coro_factory`` must be a *callable that returns a new coroutine* each
    time (i.e. a zero-arg lambda or functools.partial), because a coroutine
    object can only be awaited once.
    """
    last_exc: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return await coro_factory()
        except Exception as exc:
            last_exc = exc
            wait = BASE_DELAY ** attempt
            log.warning(
                "%s attempt %d/%d failed (%s). Retrying in %ds …",
                label, attempt, MAX_RETRIES, exc, wait,
            )
            await asyncio.sleep(wait)
    raise last_exc  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Chat completions
# ---------------------------------------------------------------------------

async def get_chat_response(
    api_key: str,
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 300,
) -> str:
    """Return the assistant's reply for a chat conversation.

    Tries PRIMARY_MODEL first; on failure falls back to FALLBACK_MODEL.
    Each model attempt uses exponential-backoff retries.
    """
    client = AsyncCerebras(api_key=api_key)

    for model in (PRIMARY_MODEL, FALLBACK_MODEL):
        try:
            resp = await _retry(
                lambda m=model: client.chat.completions.create(
                    model=m,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                ),
                label=f"chat/{model}",
            )
            text = resp.choices[0].message.content
            return text.strip() if text else ""
        except Exception as exc:
            log.error("Model %s exhausted retries: %s", model, exc)
            continue  # try next model

    return "ah... maaf... aku lagi nggak bisa mikir... coba lagi nanti ya..."


# ---------------------------------------------------------------------------
# Memory extraction
# ---------------------------------------------------------------------------

EXTRACTOR_SYSTEM_PROMPT = (
    "You are a Background Memory Agent. Your job is to extract long-term "
    "permanent facts about the user from their message.\n"
    "Extract things like: real name, age, hobbies, likes/dislikes, "
    "relationships, or major life events.\n"
    "Respond ONLY with a valid JSON Array of strings. If no meaningful "
    'permanent fact is found, return [].\n'
    'Example: ["user\'s name is andi", "user likes rain", '
    '"user broke up recently"]'
)


async def extract_memory(api_key: str, user_message: str) -> list[str]:
    """Call the small extractor model and return a list of fact strings."""
    client = AsyncCerebras(api_key=api_key)

    messages = [
        {"role": "system", "content": EXTRACTOR_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    try:
        resp = await _retry(
            lambda: client.chat.completions.create(
                model=EXTRACTOR_MODEL,
                messages=messages,
                temperature=0.0,
                max_tokens=300,
            ),
            label="extract_memory",
        )
        raw = resp.choices[0].message.content or "[]"
        # Attempt to parse JSON array
        facts = json.loads(raw)
        if isinstance(facts, list):
            return [str(f) for f in facts if f]
    except json.JSONDecodeError:
        log.warning("Extractor returned non-JSON: %s", raw)
    except Exception as exc:
        log.error("Memory extraction failed: %s", exc)

    return []

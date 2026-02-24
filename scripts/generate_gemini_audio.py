#!/usr/bin/env python3
"""Generate WAV audio files for flashcards using Gemini TTS."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = Path(os.getenv("DATABASE_PATH", PROJECT_ROOT / "vodila" / "rules.db"))
if os.getenv("AUDIO_PATH"):
    DEFAULT_OUTPUT_DIR = Path(os.getenv("AUDIO_PATH"))
elif os.getenv("RENDER"):
    DEFAULT_OUTPUT_DIR = Path("/tmp/audio")
else:
    DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "vodila" / "audio"
DEFAULT_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
DEFAULT_VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")


class DailyQuotaExceededError(Exception):
    """Raised when Gemini daily quota is exhausted."""


def extract_retry_delay_seconds(error_text: str) -> int | None:
    retry_info_match = re.search(r'"retryDelay"\s*:\s*"(\d+)s"', error_text)
    if retry_info_match:
        return int(retry_info_match.group(1))

    message_match = re.search(r"Please retry in ([0-9]+(?:\.[0-9]+)?)s", error_text)
    if message_match:
        return max(1, int(float(message_match.group(1))))

    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate audio files for all flashcards via Gemini TTS.",
    )
    parser.add_argument("--api-key", default=os.getenv("GEMINI_API_KEY"), help="Gemini API key")
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH, help="Path to SQLite database")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory for WAV files")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Gemini model name")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="Gemini prebuilt voice name")
    parser.add_argument(
        "--text-field",
        choices=("russian", "spanish", "both"),
        default="russian",
        help="Which card text to voice",
    )
    parser.add_argument("--start-id", type=int, default=None, help="Start card id (inclusive)")
    parser.add_argument("--end-id", type=int, default=None, help="End card id (inclusive)")
    parser.add_argument("--sleep", type=float, default=0.4, help="Delay between requests in seconds")
    parser.add_argument("--retries", type=int, default=3, help="Retries per card")
    parser.add_argument("--force", action="store_true", help="Regenerate existing files")
    parser.add_argument("--only-missing", action="store_true", help="Generate only missing files")
    parser.add_argument("--dry-run", action="store_true", help="Show actions without calling API")
    return parser.parse_args()


def get_audio_filename(rule_id: int) -> str:
    return f"rule_{rule_id:04d}.wav"


def load_rules(db_path: Path, start_id: int | None, end_id: int | None) -> list[tuple[int, str, str]]:
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")

    conditions: list[str] = []
    params: list[int] = []

    if start_id is not None:
        conditions.append("id >= ?")
        params.append(start_id)
    if end_id is not None:
        conditions.append("id <= ?")
        params.append(end_id)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT id, spanish, russian FROM rules {where_clause} ORDER BY id"

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(query, params)
        return [(int(row[0]), row[1] or "", row[2] or "") for row in cursor.fetchall()]


def build_tts_text(spanish: str, russian: str, text_field: str) -> str:
    if text_field == "spanish":
        return spanish.strip()
    if text_field == "both":
        return f"Испанский текст: {spanish.strip()}. Русский перевод: {russian.strip()}."
    return russian.strip()


def extract_audio_part(response_payload: dict) -> tuple[bytes, str]:
    candidates = response_payload.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini response has no candidates")

    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    if not parts:
        raise RuntimeError("Gemini response has no content parts")

    inline_data = None
    for part in parts:
        inline_data = part.get("inlineData") or part.get("inline_data")
        if inline_data:
            break
    if not inline_data:
        raise RuntimeError("Gemini response has no inline audio data")

    audio_b64 = inline_data.get("data")
    mime_type = inline_data.get("mimeType", "audio/L16;rate=24000")
    if not audio_b64:
        raise RuntimeError("Gemini response contains empty audio payload")

    return base64.b64decode(audio_b64), mime_type


def call_gemini_tts(api_key: str, model: str, voice: str, text: str) -> tuple[bytes, str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice,
                    }
                }
            },
        },
    }

    request = urllib.request.Request(
        url=url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return extract_audio_part(payload)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        if exc.code == 429 and "generate_requests_per_model_per_day" in body:
            raise DailyQuotaExceededError(body)
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def write_audio(path: Path, audio_bytes: bytes, mime_type: str) -> None:
    if audio_bytes[:4] == b"RIFF" or "audio/wav" in mime_type.lower():
        path.write_bytes(audio_bytes)
        return

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24000)
        wav_file.writeframes(audio_bytes)


def should_skip(path: Path, force: bool, only_missing: bool) -> bool:
    if force:
        return False
    if only_missing and path.exists():
        return True
    return path.exists()


def main() -> int:
    args = parse_args()

    if not args.api_key and not args.dry_run:
        print("GEMINI_API_KEY is missing. Pass --api-key or set environment variable.")
        return 1

    if args.start_id and args.end_id and args.start_id > args.end_id:
        print("Invalid range: --start-id must be <= --end-id")
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)

    try:
        rules = load_rules(args.db_path, args.start_id, args.end_id)
    except Exception as exc:
        print(f"Failed to load cards: {exc}")
        return 1

    if not rules:
        print("No cards found for selected range.")
        return 0

    print(
        f"Cards to process: {len(rules)} | model={args.model} | voice={args.voice} | output={args.output_dir}"
    )

    generated = 0
    skipped = 0
    failed = 0

    for rule_id, spanish, russian in rules:
        output_path = args.output_dir / get_audio_filename(rule_id)

        if should_skip(output_path, force=args.force, only_missing=args.only_missing):
            skipped += 1
            continue

        text = build_tts_text(spanish, russian, args.text_field)
        if not text:
            print(f"[{rule_id}] Skipped: empty text")
            skipped += 1
            continue

        if args.dry_run:
            print(f"[{rule_id}] Would generate -> {output_path.name}")
            generated += 1
            continue

        last_error: str | None = None

        for attempt in range(1, args.retries + 1):
            try:
                audio_bytes, mime_type = call_gemini_tts(args.api_key, args.model, args.voice, text)
                write_audio(output_path, audio_bytes, mime_type)
                generated += 1
                print(f"[{rule_id}] Generated {output_path.name}")
                last_error = None
                break
            except DailyQuotaExceededError as exc:
                print(
                    "Gemini daily quota is exhausted. "
                    "Stop generation and retry later or use another key."
                )
                print(f"Details: {exc}")
                print(f"Stopped at card {rule_id}.")
                print(f"Done. Generated: {generated}, Skipped: {skipped}, Failed: {failed}")
                return 1
            except Exception as exc:
                last_error = str(exc)
                if attempt >= args.retries:
                    break
                retry_delay = extract_retry_delay_seconds(last_error)
                sleep_time = retry_delay if retry_delay is not None else min(2 ** (attempt - 1), 8)
                print(f"[{rule_id}] Attempt {attempt} failed: {last_error}. Retry in {sleep_time}s...")
                time.sleep(sleep_time)

        if last_error:
            failed += 1
            print(f"[{rule_id}] Failed: {last_error}")

        if args.sleep > 0:
            time.sleep(args.sleep)

    print(f"Done. Generated: {generated}, Skipped: {skipped}, Failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

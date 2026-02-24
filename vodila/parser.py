"""Parser for RTF files with Spanish-Russian traffic rules."""

import re
import sqlite3
from pathlib import Path

from striprtf.striprtf import rtf_to_text


def parse_rtf_file(file_path: Path) -> list[dict]:
    """Parse an RTF file and extract entries."""
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    text = rtf_to_text(content)

    entries = []
    pattern = re.compile(r"\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|")

    for match in pattern.finditer(text):
        num, spanish, russian = match.groups()
        spanish_clean = spanish.strip().replace("**", "")
        russian_clean = russian.strip().replace("**", "")
        entries.append(
            {
                "id": int(num),
                "spanish": spanish_clean,
                "russian": russian_clean,
            }
        )

    return entries


def create_database(db_path: Path) -> sqlite3.Connection:
    """Create SQLite database with the rules table."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY,
            spanish TEXT NOT NULL,
            russian TEXT NOT NULL
        )
    """
    )
    conn.commit()
    return conn


def parse_all_files(source_dir: Path, db_path: Path) -> None:
    """Parse all RTF files and save to database."""
    conn = create_database(db_path)
    cursor = conn.cursor()

    rtf_files = sorted(source_dir.glob("*.rtf"))

    for file_path in rtf_files:
        print(f"Parsing {file_path.name}...")
        entries = parse_rtf_file(file_path)

        for entry in entries:
            cursor.execute(
                "INSERT OR REPLACE INTO rules (id, spanish, russian) VALUES (?, ?, ?)",
                (entry["id"], entry["spanish"], entry["russian"]),
            )

        print(f"  Added {len(entries)} entries")

    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM rules")
    total = cursor.fetchone()[0]
    print(f"\nTotal entries in database: {total}")

    conn.close()


if __name__ == "__main__":
    project_root = Path(__file__).parent.parent
    source_dir = project_root / "source_data"
    db_path = project_root / "vodila" / "rules.db"

    parse_all_files(source_dir, db_path)

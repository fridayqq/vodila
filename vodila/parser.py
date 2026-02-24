"""Parser for RTF files with Spanish-Russian traffic rules."""

import re
from pathlib import Path

from striprtf.striprtf import rtf_to_text
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, declarative_base, Mapped, mapped_column

Base = declarative_base()


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    spanish: Mapped[str]
    russian: Mapped[str]


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


def parse_all_files(source_dir: Path, engine) -> None:
    """Parse all RTF files and save to database."""
    Base.metadata.create_all(engine)
    
    with Session(engine) as session:
        rtf_files = sorted(source_dir.glob("*.rtf"))

        for file_path in rtf_files:
            print(f"Parsing {file_path.name}...")
            entries = parse_rtf_file(file_path)

            for entry in entries:
                # Check if rule exists
                stmt = select(Rule).where(Rule.id == entry["id"])
                existing = session.execute(stmt).scalar_one_or_none()

                if existing:
                    existing.spanish = entry["spanish"]
                    existing.russian = entry["russian"]
                else:
                    new_rule = Rule(**entry)
                    session.add(new_rule)

                print(f"  Added {len(entries)} entries")

        session.commit()

        # Count total
        total = session.query(Rule).count()
        print(f"\nTotal entries in database: {total}")

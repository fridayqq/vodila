"""FastAPI backend for flashcard learning app."""

import os
import random
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session, declarative_base, Mapped, mapped_column

# Database setup
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # Use PostgreSQL
    engine = create_engine(DATABASE_URL)
elif os.getenv("RENDER"):
    # On Render free tier, use /tmp for ephemeral storage
    DB_PATH = Path("/tmp/rules.db")
    engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
else:
    # Local development with SQLite
    DB_PATH = Path(os.getenv("DATABASE_PATH", Path(__file__).parent / "rules.db"))
    engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
Base = declarative_base()


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    spanish: Mapped[str]
    russian: Mapped[str]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    telegram_id: Mapped[str] = mapped_column(unique=True, index=True)
    username: Mapped[str | None]
    created_at: Mapped[str]


class UserProgress(Base):
    __tablename__ = "user_progress"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(index=True)
    rule_id: Mapped[int]
    status: Mapped[str]  # "known" or "unknown"
    updated_at: Mapped[str]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables and initialize database if empty
    # Ensure data directory exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    
    with Session(engine) as session:
        count = session.query(Rule).count()
        if count == 0:
            print("Initializing database from source_data...")
            from vodila.parser import parse_all_files
            source_dir = Path(__file__).parent.parent / "source_data"
            db_path = DB_PATH
            parse_all_files(source_dir, db_path)
            print("Database initialized!")
    yield
    # Shutdown


app = FastAPI(lifespan=lifespan)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic models
class Flashcard(BaseModel):
    id: int
    spanish: str
    russian: str


class FlashcardSession(BaseModel):
    session_id: str
    mode: str
    cards: list[Flashcard]


class ProgressUpdate(BaseModel):
    rule_id: int
    status: str  # "known" or "unknown"


class StudyMode(BaseModel):
    id: str
    name: str
    description: str


class TelegramInitData(BaseModel):
    """Telegram WebApp init data for authentication."""
    user: dict
    hash: str


class AuthResponse(BaseModel):
    user_id: int
    telegram_id: str
    username: str | None
    token: str


# Helper functions
def get_db() -> Session:
    with Session(engine) as session:
        yield session


def verify_telegram_data(init_data: dict) -> bool:
    """Verify Telegram WebApp init data."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        return True  # Skip verification in dev mode
    
    received_hash = init_data.get("hash")
    if not received_hash:
        return False
    
    # Extract data except hash
    data_check_string = "&".join(
        f"{k}={v}" for k, v in sorted(init_data.items()) 
        if k != "hash" and v
    )
    
    secret_key = hashlib.sha256(token.encode()).digest()
    calculated_hash = hashlib.sha256(
        data_check_string.encode(), usedforsecurity=False
    ).hexdigest()
    
    return calculated_hash == received_hash


def get_or_create_user(session: Session, telegram_user: dict) -> User:
    """Get or create user from Telegram data."""
    telegram_id = str(telegram_user.get("id"))
    
    stmt = select(User).where(User.telegram_id == telegram_id)
    user = session.execute(stmt).scalar_one_or_none()
    
    if not user:
        user = User(
            telegram_id=telegram_id,
            username=telegram_user.get("username"),
            created_at=datetime.now().isoformat(),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    
    return user


# API Endpoints
@app.get("/api/modes")
def get_study_modes() -> list[StudyMode]:
    """Get available study modes."""
    return [
        StudyMode(
            id="sequential",
            name="Последовательный",
            description="Все карточки по порядку",
        ),
        StudyMode(
            id="random",
            name="Случайный",
            description="Все карточки в случайном порядке",
        ),
        StudyMode(
            id="unknown_sequential",
            name="Неизвестные (по порядку)",
            description="Только отмеченные как 'не знаю' по порядку",
        ),
        StudyMode(
            id="unknown_random",
            name="Неизвестные (случайно)",
            description="Только отмеченные как 'не знаю' случайно",
        ),
        StudyMode(
            id="exam",
            name="Экзамен",
            description="20 случайных карточек для проверки",
        ),
    ]


@app.get("/api/cards")
def get_cards(
    mode: str = "sequential",
    known_ids: str = "",
    unknown_ids: str = "",
) -> list[Flashcard]:
    """Get flashcards based on study mode."""
    with Session(engine) as session:
        if mode == "sequential":
            stmt = select(Rule).order_by(Rule.id)
            rules = session.execute(stmt).scalars().all()
        elif mode == "random":
            stmt = select(Rule)
            rules = session.execute(stmt).scalars().all()
            random.shuffle(rules)
        elif mode == "unknown_sequential":
            if not unknown_ids:
                return []
            unknown_id_list = [int(x) for x in unknown_ids.split(",") if x.strip()]
            stmt = select(Rule).where(Rule.id.in_(unknown_id_list)).order_by(Rule.id)
            rules = session.execute(stmt).scalars().all()
        elif mode == "unknown_random":
            if not unknown_ids:
                return []
            unknown_id_list = [int(x) for x in unknown_ids.split(",") if x.strip()]
            stmt = select(Rule).where(Rule.id.in_(unknown_id_list))
            rules = list(session.execute(stmt).scalars().all())
            random.shuffle(rules)
        elif mode == "exam":
            stmt = select(Rule)
            rules = list(session.execute(stmt).scalars().all())
            random.shuffle(rules)
            rules = rules[:20]
        else:
            raise HTTPException(status_code=400, detail="Invalid mode")

        return [Flashcard(id=r.id, spanish=r.spanish, russian=r.russian) for r in rules]


@app.post("/api/progress")
def update_progress(
    progress: ProgressUpdate,
    x_telegram_user: str | None = Header(None, alias="X-Telegram-User"),
):
    """Update user progress for a card."""
    if not x_telegram_user:
        raise HTTPException(status_code=401, detail="User authentication required")
    
    with Session(engine) as session:
        telegram_user = eval(x_telegram_user)  # Parse JSON from header
        user = get_or_create_user(session, telegram_user)
        
        # Check if progress exists for this user
        stmt = select(UserProgress).where(
            UserProgress.user_id == user.id,
            UserProgress.rule_id == progress.rule_id
        )
        existing = session.execute(stmt).scalar_one_or_none()

        if existing:
            existing.status = progress.status
        else:
            new_progress = UserProgress(
                user_id=user.id,
                rule_id=progress.rule_id,
                status=progress.status,
                updated_at=datetime.now().isoformat(),
            )
            session.add(new_progress)

        session.commit()
        return {"success": True}


@app.get("/api/progress")
def get_progress(
    x_telegram_user: str | None = Header(None, alias="X-Telegram-User"),
):
    """Get user progress summary."""
    if not x_telegram_user:
        return {"known": [], "unknown": [], "total_known": 0, "total_unknown": 0}
    
    with Session(engine) as session:
        telegram_user = eval(x_telegram_user)  # Parse JSON from header
        user = get_or_create_user(session, telegram_user)
        
        stmt = select(UserProgress).where(UserProgress.user_id == user.id)
        user_progress = session.execute(stmt).scalars().all()

        known = [p.rule_id for p in user_progress if p.status == "known"]
        unknown = [p.rule_id for p in user_progress if p.status == "unknown"]

        return {
            "known": known,
            "unknown": unknown,
            "total_known": len(known),
            "total_unknown": len(unknown),
        }


@app.get("/api/stats")
def get_stats():
    """Get overall statistics."""
    with Session(engine) as session:
        total_cards = session.query(Rule).count()
        stmt = select(UserProgress)
        all_progress = session.execute(stmt).scalars().all()

        known_count = sum(1 for p in all_progress if p.status == "known")
        unknown_count = sum(1 for p in all_progress if p.status == "unknown")

        return {
            "total_cards": total_cards,
            "known": known_count,
            "unknown": unknown_count,
            "not_started": total_cards - known_count - unknown_count,
        }


@app.delete("/api/progress/reset")
def reset_progress(
    x_telegram_user: str | None = Header(None, alias="X-Telegram-User"),
):
    """Reset user progress."""
    if not x_telegram_user:
        raise HTTPException(status_code=401, detail="User authentication required")
    
    with Session(engine) as session:
        telegram_user = eval(x_telegram_user)
        user = get_or_create_user(session, telegram_user)
        
        # Delete all progress for this user
        stmt = select(UserProgress).where(UserProgress.user_id == user.id)
        user_progress = session.execute(stmt).scalars().all()
        
        for progress in user_progress:
            session.delete(progress)
        
        session.commit()
        return {"success": True, "message": "Progress reset"}


@app.post("/api/auth/telegram")
def auth_telegram(init_data: TelegramInitData):
    """Authenticate user via Telegram WebApp data."""
    if not verify_telegram_data(init_data.model_dump()):
        raise HTTPException(status_code=401, detail="Invalid Telegram data")
    
    with Session(engine) as session:
        user = get_or_create_user(session, init_data.user)
        
        # Generate simple token (in production use JWT)
        token = hashlib.sha256(f"{user.telegram_id}-{user.created_at}".encode()).hexdigest()
        
        return AuthResponse(
            user_id=user.id,
            telegram_id=user.telegram_id,
            username=user.username,
            token=token,
        )


# Telegram Bot Webhook (optional)
@app.post("/api/telegram/webhook")
async def telegram_webhook(request: dict):
    """Handle Telegram bot webhook updates."""
    # Basic webhook handler - can be extended for bot commands
    return {"ok": True}


@app.get("/api/telegram/bot-info")
def get_bot_info():
    """Get Telegram bot configuration info."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    return {
        "configured": bool(token),
        "webhook_url": f"https://your-domain.com/api/telegram/webhook",
        "setup_command": f"Set webhook via: https://api.telegram.org/bot{token[:15]}.../setWebhook?url=https://your-domain.com/api/telegram/webhook" if token else "No token configured",
    }


# Mount static files for frontend (must be last)
static_path = Path(__file__).parent / "static"
if static_path.exists():
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")

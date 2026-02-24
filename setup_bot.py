#!/usr/bin/env python3
"""Setup Telegram bot commands and Menu Button."""

import os
import sys
import requests

# Get bot token from environment or argument
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", sys.argv[1] if len(sys.argv) > 1 else "")

if not BOT_TOKEN:
    print("Usage: python setup_bot.py <BOT_TOKEN>")
    print("Or set TELEGRAM_BOT_TOKEN environment variable")
    sys.exit(1)

# Your Mini App URL (replace with actual Render URL)
MINI_APP_URL = "https://vodila-app-xxxx.onrender.com"  # <-- UPDATE THIS!

API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


def set_menu_button():
    """Set Menu Button to open Mini App."""
    url = f"{API_BASE}/setChatMenuButton"
    data = {
        "menu_button": {
            "type": "web_app",
            "text": "🚦 ПДД Испании",
            "web_app": {"url": MINI_APP_URL},
        },
    }
    response = requests.post(url, json=data)
    print(f"Set Menu Button: {response.json()}")
    return response.ok


def set_commands():
    """Set bot commands list."""
    url = f"{API_BASE}/setMyCommands"
    commands = [
        {"command": "start", "description": "🚀 Запустить приложение"},
        {"command": "study", "description": "📚 Начать обучение"},
        {"command": "stats", "description": "📊 Моя статистика"},
        {"command": "reset", "description": "🗑️ Сбросить прогресс"},
    ]
    data = {"commands": commands}
    response = requests.post(url, json=data)
    print(f"Set commands: {response.json()}")
    return response.ok


def get_me():
    """Get bot info."""
    url = f"{API_BASE}/getMe"
    response = requests.get(url)
    if response.ok:
        bot = response.json()["result"]
        print(f"Bot: @{bot['username']} ({bot['first_name']})")
    return response.ok


if __name__ == "__main__":
    print(f"Setting up bot with Mini App: {MINI_APP_URL}\n")
    
    if not get_me():
        print("❌ Failed to get bot info. Check token!")
        sys.exit(1)
    
    print()
    
    if set_commands():
        print("✅ Commands set successfully")
    else:
        print("❌ Failed to set commands")
    
    print()
    
    if set_menu_button():
        print("✅ Menu Button set successfully")
        print(f"\nUsers can now open Mini App via the button next to the message input!")
    else:
        print("❌ Failed to set Menu Button")
    
    print(f"\nMini App URL: {MINI_APP_URL}")
    print(f"Direct link: https://t.me/{BOT_TOKEN.split(':')[0].replace('BOT_TOKEN', '')}")

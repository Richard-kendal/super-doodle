from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import os
import re
import uuid
import datetime
import threading
import telebot
import os

BOT_TOKEN = os.getenv("BOT_TOKEN")
if BOT_TOKEN:
    bot = telebot.TeleBot(BOT_TOKEN)

    # Скопируйте сюда логику из bot.py (или импортируйте)
    # Например:
    @bot.message_handler(commands=['start'])
    def send_welcome(message):
        bot.reply_to(message, "Привет! Используйте /tovar, /akcia, /new")

    # ... остальные обработчики

    def run_bot():
        bot.polling(none_stop=True)

    # Запуск бота в отдельном потоке
    threading.Thread(target=run_bot, daemon=True).start()
app = Flask(__name__)
CORS(app)

# === Файлы данных ===
DATA_FILE = "products.json"
AKCII_FILE = "akcii.json"
NOVINKI_FILE = "novinki.json"
LEADERBOARD_FILE = "leaderboard.json"
BONUS_FILE = "bonuses.json"

# === Вспомогательные функции ===
def normalize_street(s):
    return re.sub(r'[^а-яa-z0-9\s]', '', s.lower()).strip()

def generate_id():
    return str(int(uuid.uuid4().int & (1 << 32) - 1))

def load_json_file(filename):
    if not os.path.exists(filename):
        return []
    try:
        with open(filename, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return []
            return json.loads(content)
    except (json.JSONDecodeError, IOError):
        return []

def save_json_file(filename, data):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# === Загрузка/сохранение товаров ===
def load_products():
    return load_json_file(DATA_FILE)

def save_products(data):
    save_json_file(DATA_FILE, data)

# === Эндпоинты каталога ===
@app.route("/api/products", methods=["GET"])
def get_products():
    return jsonify(load_products())

@app.route("/api/akcii", methods=["GET"])
def get_akcii():
    return jsonify(load_json_file(AKCII_FILE))

@app.route("/api/novinki", methods=["GET"])
def get_novinki():
    return jsonify(load_json_file(NOVINKI_FILE))

@app.route("/api/add-product", methods=["POST"])
def add_product():
    product = request.get_json()
    if not product:
        return {"error": "No JSON"}, 400

    common_required = ["category", "brand", "name", "flavor", "image_url", "price", "description"]
    for field in common_required:
        if field not in product:
            return {"error": f"Missing required field: {field}"}, 400

    is_regular_product = "city" in product and "street" in product

    if is_regular_product:
        if not product.get("city") or not product.get("street"):
            return {"error": "Missing city or street"}, 400
        product["street"] = product["street"].strip()

        products = load_products()
        for p in products:
            if (
                p["category"] == product["category"] and
                p["brand"] == product["brand"] and
                p["name"] == product["name"] and
                p["flavor"] == product["flavor"] and
                p["city"] == product["city"] and
                normalize_street(p["street"]) == normalize_street(product["street"])
            ):
                return {"error": "Товар уже существует"}, 409
    else:
        products = load_products()

    product["id"] = generate_id()
    products.append(product)
    save_products(products)
    return {"status": "ok", "id": product["id"]}

# === Лидерборд и бонусы ===
def load_leaderboard():
    return load_json_file(LEADERBOARD_FILE)

def save_leaderboard(data):
    save_json_file(LEADERBOARD_FILE, data)

def load_bonuses():
    return load_json_file(BONUS_FILE)

def save_bonuses(data):
    save_json_file(BONUS_FILE, data)

@app.route("/api/leaderboard", methods=["GET"])
def api_get_leaderboard():
    board = load_leaderboard()
    board.sort(key=lambda x: x.get("score", 0), reverse=True)
    return jsonify(board[:100])

@app.route("/api/leaderboard", methods=["POST"])
def api_submit_score():
    data = request.get_json()
    if not data or "id" not in data or "username" not in data or "score" not in data:
        return jsonify({"error": "Invalid data"}), 400

    try:
        user_id = str(data["id"])
        username = str(data["username"])
        score = int(data["score"])
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid data types"}), 400

    today = datetime.date.today().isoformat()

    # --- Обновление бонусов ---
    bonuses = load_bonuses()
    user_bonus = None
    for b in bonuses:
        if b["id"] == user_id:
            user_bonus = b
            break

    if user_bonus is None:
        user_bonus = {"id": user_id, "date": today, "count": 0}
        bonuses.append(user_bonus)

    if user_bonus["date"] != today:
        user_bonus["date"] = today
        user_bonus["count"] = 0

    bonus_from_score = min(10, score // 100)
    if bonus_from_score > user_bonus["count"]:
        user_bonus["count"] = bonus_from_score

    save_bonuses(bonuses)

    # --- Обновление лидерборда ---
    board = load_leaderboard()
    existing = None
    for p in board:
        if p["id"] == user_id:
            existing = p
            break

    if existing:
        if score > existing["score"]:
            existing["score"] = score
            existing["username"] = username
    else:
        board.append({"id": user_id, "username": username, "score": score})

    board.sort(key=lambda x: x["score"], reverse=True)
    save_leaderboard(board[:100])

    return jsonify({"status": "ok"})

@app.route("/api/bonuses/<user_id>", methods=["GET"])
def api_get_bonuses(user_id):
    bonuses = load_bonuses()
    today = datetime.date.today().isoformat()
    count = 0
    for b in bonuses:
        if b["id"] == str(user_id) and b["date"] == today:
            count = b.get("count", 0)
            break
    return jsonify({"count": count})

# === Запуск ===
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
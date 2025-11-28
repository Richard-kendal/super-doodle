from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import os
import re
import uuid
import datetime
import telebot
import requests

# === Глобальные переменные ===
bot_running = False
bot = None

# === Состояние бота — должно быть глобальным для webhook ===
pending_products = {}  # ← хранит JSON до получения фото
IMAGE_DIR = "images"
os.makedirs(IMAGE_DIR, exist_ok=True)

# === Конфигурация ===
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

# === API endpoints ===
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

# === Leaderboard & Bonuses ===
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

    bonuses = load_bonuses()
    user_bonus = next((b for b in bonuses if b["id"] == user_id), None)

    if user_bonus is None:
        user_bonus = {"id": user_id, "date": today, "count": 0}
        bonuses.append(user_bonus)
    elif user_bonus["date"] != today:
        user_bonus["date"] = today
        user_bonus["count"] = 0

    bonus_from_score = min(10, score // 100)
    if bonus_from_score > user_bonus["count"]:
        user_bonus["count"] = bonus_from_score

    save_bonuses(bonuses)

    board = load_leaderboard()
    existing = next((p for p in board if p["id"] == user_id), None)

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
    count = next((b["count"] for b in bonuses if b["id"] == str(user_id) and b["date"] == today), 0)
    return jsonify({"count": count})

# === Telegram Bot (Webhook) ===
def run_telegram_bot():
    global bot, bot_running
    if bot_running:
        print("⚠️ Бот уже настроен — пропускаем повторную настройку.")
        return

    BOT_TOKEN = "8437761728:AAFh1QSQamm0HX4vDsvNF3UIRyqFyFK_bVA"
    if not BOT_TOKEN:
        print("❌ BOT_TOKEN не задан — бот не запущен")
        return

    RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL", "https://super-doodle-1.onrender.com").rstrip('/')
    WEBHOOK_URL = f"{RENDER_EXTERNAL_URL}/webhook"
    API_URL = f"{RENDER_EXTERNAL_URL}/api/add-product"

    bot = telebot.TeleBot(BOT_TOKEN)

    def save_to_file(filename, data):
        items = load_json_file(filename)
        items.append(data)
        save_json_file(filename, items)

    # --- Все хендлеры ---
    @bot.message_handler(commands=['start', 'help'])
    def send_welcome(message):
        bot.reply_to(message, (
            "📦 Используйте:\n"
            "/tovar — добавить товар (сначала JSON без фото, потом фото)\n"
            "/akcia — добавить акцию\n"
            "/new — добавить новый товар\n"
            "/example — пример формата"
        ))

    @bot.message_handler(commands=['example'])
    def send_example(message):
        example = {
            "category": "Одноразовые сигареты",
            "brand": "Мишки",
            "name": "150440",
            "flavor": "Клубника",
            "city": "Северодвинск",
            "street": "Ленина, аа",
            "price": 150,
            "description": "Вкусный и крепкий."
        }
        bot.send_message(
            message.chat.id,
            "```json\n" + json.dumps(example, ensure_ascii=False, indent=2) + "\n```\n"
            "⚠️ Не включайте `image_url` — его заменит фото!\n"
            "Для /akcia и /new уберите `city` и `street`.",
            parse_mode="Markdown"
        )

    @bot.message_handler(commands=['tovar'])
    def handle_tovar(message):
        bot.reply_to(message, "Отправьте JSON с товаром (БЕЗ image_url):\n"
                              "Поля: category, brand, name, flavor, price, description, city, street")

    @bot.message_handler(commands=['akcia'])
    def handle_akcia(message):
        bot.reply_to(message, "Отправьте JSON для акции (БЕЗ image_url):\n"
                              "Поля: category, brand, name, flavor, price, description")

    @bot.message_handler(commands=['new'])
    def handle_new(message):
        bot.reply_to(message, "Отправьте JSON для нового товара (БЕЗ image_url):\n"
                              "Поля: category, brand, name, flavor, price, description")

    def _receive_product_json(message, product_type):
        try:
            data = json.loads(message.text)
            required = ["category", "brand", "name", "flavor", "price", "description"]
            if product_type == 'tovar':
                required += ["city", "street"]
            if not all(k in data for k in required):
                raise ValueError("Не хватает полей: " + ", ".join(required))
            if "image_url" in data:
                bot.reply_to(message, "❌ Уберите `image_url` из JSON!")
                return
            if product_type == 'tovar':
                data["street"] = data["street"].strip()
            pending_products[message.chat.id] = {'type': product_type, 'data': data}
            bot.reply_to(message, "✅ JSON принят. Теперь отправьте фото.")
        except json.JSONDecodeError:
            bot.reply_to(message, "❌ Неверный JSON. Используйте /example")
        except Exception as e:
            bot.reply_to(message, f"❌ Ошибка: {str(e)}")

    @bot.message_handler(func=lambda m: m.reply_to_message and "Отправьте JSON с товаром" in m.reply_to_message.text)
    def receive_tovar_json(message):
        _receive_product_json(message, 'tovar')

    @bot.message_handler(func=lambda m: m.reply_to_message and "Отправьте JSON для акции" in m.reply_to_message.text)
    def receive_akcia_json(message):
        _receive_product_json(message, 'akcia')

    @bot.message_handler(func=lambda m: m.reply_to_message and "Отправьте JSON для нового товара" in m.reply_to_message.text)
    def receive_new_json(message):
        _receive_product_json(message, 'new')

    @bot.message_handler(content_types=['photo'])
    def handle_photo(message):
        chat_id = message.chat.id
        if chat_id not in pending_products:
            return
        try:
            file_id = message.photo[-1].file_id
            file_info = bot.get_file(file_id)
            downloaded_file = bot.download_file(file_info.file_path)
            ext = file_info.file_path.split('.')[-1] if '.' in file_info.file_path else 'jpg'
            filename = f"{uuid.uuid4().hex}.{ext}"
            filepath = os.path.join(IMAGE_DIR, filename)
            
            # Логируем путь
            print(f"📸 Сохраняю фото: {filepath}")
            
            with open(filepath, 'wb') as f:
                f.write(downloaded_file)

            image_url = f"/images/{filename}"
            prod = pending_products[chat_id]
            product_data = prod['data']
            product_data["image_url"] = image_url
            product_type = prod['type']

            if product_type == 'tovar':
                resp = requests.post(API_URL, json=product_data, timeout=10)
                if resp.status_code == 200:
                    bot.reply_to(message, "✅ Товар добавлен!")
                elif resp.status_code == 409:
                    bot.reply_to(message, "⚠️ Такой товар уже есть.")
                else:
                    bot.reply_to(message, f"❌ Ошибка сервера: {resp.status_code}")
            else:
                if product_type == 'akcia':
                    save_to_file(AKCII_FILE, product_data)
                elif product_type == 'new':
                    save_to_file(NOVINKI_FILE, product_data)
                bot.reply_to(message, f"✅ {'Акция' if product_type == 'akcia' else 'Новинка'} добавлена!")
            del pending_products[chat_id]
        except Exception as e:
            bot.reply_to(message, f"❌ Ошибка фото: {str(e)}")
            pending_products.pop(chat_id, None)

    # === Установка вебхука ===
    try:
        bot.remove_webhook()
        bot.set_webhook(url=WEBHOOK_URL)
        print(f"✅ Вебхук установлен: {WEBHOOK_URL}")
        bot_running = True
    except Exception as e:
        print(f"🔴 Ошибка установки вебхука: {e}")
        bot_running = False

# === Webhook endpoint ===
@app.route('/webhook', methods=['POST'])
def webhook():
    global bot
    if request.method == 'POST' and bot:
        json_str = request.get_data().decode('UTF-8')
        update = telebot.types.Update.de_json(json_str)
        bot.process_new_updates([update])
        return '', 200
    return '', 403

# === Статические файлы (для изображений) ===
from flask import send_from_directory

@app.route('/images/<filename>')
def serve_image(filename):
    return send_from_directory(IMAGE_DIR, filename)
# === Инициализация и запуск ===
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Настройка бота при старте
    run_telegram_bot()
    # Запуск Flask
    app.run(host="0.0.0.0", port=port, debug=False)
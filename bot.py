import telebot
import requests
import json
import os
import uuid
from datetime import datetime

BOT_TOKEN = "8437761728:AAFh1QSQamm0HX4vDsvNF3UIRyqFyFK_bVA"
API_URL = "https://super-doodle-1.onrender.com/api/add-product"

bot = telebot.TeleBot(BOT_TOKEN)

# Временное хранилище: {chat_id: {type: 'tovar'/'akcia'/'new', data: {...}}}
pending_products = {}
WEB_APP_URL = "https://smoky-bro.netlify.app"  # ← ваш Netlify URL

@bot.message_handler(commands=['start'])
def send_welcome(message):
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("Открыть Smoky Bro", web_app=WebAppInfo(url=WEB_APP_URL)))
    bot.send_message(message.chat.id, "Добро пожаловать!", reply_markup=markup)
# Папка для изображений
IMAGE_DIR = "images"
os.makedirs(IMAGE_DIR, exist_ok=True)

AKCII_FILE = "akcii.json"
NOVINKI_FILE = "novinki.json"

def save_to_file(filename, data):
    items = []
    if os.path.exists(filename):
        with open(filename, "r", encoding="utf-8") as f:
            items = json.load(f)
    items.append(data)
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    bot.reply_to(message, (
        "📦 Используйте:\n"
        "/tovar — добавить товар (сначала JSON без фото, потом фото)\n"
        "/akcia — добавить акцию (сначала JSON без фото, потом фото)\n"
        "/new — добавить новый товар (сначала JSON без фото, потом фото)\n"
        "/example — пример формата"
    ))

@bot.message_handler(commands=['example'])
def send_example(message):
    example = {
        "category": "Одноразовые сигареты",
        "brand": "Мишки",
        "name": "150440",
        "flavor": "Клубника",
        "city": "Северодвинск",   # ← для /tovar
        "street": "Ленина, аа",   # ← для /tovar
        "price": 150,             # ← новое поле
        "description": "Вкусный и крепкий."  # ← новое поле
        # image_url НЕ указывается — его заменит фото!
    }
    bot.send_message(
        message.chat.id,
        f"```json\n{json.dumps(example, ensure_ascii=False, indent=2)}\n```\n\n"
        "⚠️ Не включайте поле `image_url` — его заменит ваше фото!\n"
        "Для /akcia и /new уберите поля city и street.",
        parse_mode="Markdown"
    )

# === /tovar ===
@bot.message_handler(commands=['tovar'])
def handle_tovar(message):
    bot.reply_to(message, "Отправьте JSON с товаром (БЕЗ поля image_url):\n"
                         "Обязательные поля: category, brand, name, flavor, price, description, city, street")

@bot.message_handler(func=lambda m: m.reply_to_message and "Отправьте JSON с товаром (БЕЗ поля image_url)" in m.reply_to_message.text)
def receive_tovar_json(message):
    _receive_product_json(message, 'tovar')

# === /akcia ===
@bot.message_handler(commands=['akcia'])
def handle_akcia(message):
    bot.reply_to(message, "Отправьте JSON для акции (БЕЗ поля image_url):\n"
                         "Обязательные поля: category, brand, name, flavor, price, description")

@bot.message_handler(func=lambda m: m.reply_to_message and "Отправьте JSON для акции (БЕЗ поля image_url)" in m.reply_to_message.text)
def receive_akcia_json(message):
    _receive_product_json(message, 'akcia')

# === /new ===
@bot.message_handler(commands=['new'])
def handle_new(message):
    bot.reply_to(message, "Отправьте JSON для нового товара (БЕЗ поля image_url):\n"
                         "Обязательные поля: category, brand, name, flavor, price, description")

@bot.message_handler(func=lambda m: m.reply_to_message and "Отправьте JSON для нового товара (БЕЗ поля image_url)" in m.reply_to_message.text)
def receive_new_json(message):
    _receive_product_json(message, 'new')

def _receive_product_json(message, product_type):
    try:
        data = json.loads(message.text)
        # Общие обязательные поля
        required = ["category", "brand", "name", "flavor", "price", "description"]

        if product_type == 'tovar':
            required.extend(["city", "street"])

        if not all(k in data for k in required):
            raise ValueError("Не хватает полей: " + ", ".join(required))

        if "image_url" in data:
            bot.reply_to(message, "❌ Уберите поле `image_url` из JSON!")
            return

        # Очистка строки улицы
        if product_type == 'tovar':
            data["street"] = data["street"].strip()

        chat_id = message.chat.id
        pending_products[chat_id] = {
            'type': product_type,
            'data': data
        }
        bot.reply_to(message, "✅ JSON принят. Теперь отправьте фото товара.")
    except json.JSONDecodeError:
        bot.reply_to(message, "❌ Неверный JSON. Используйте /example")
    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка: {str(e)}")

# === Обработка фото ===
# === Обработка фото ===
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

        with open(filepath, 'wb') as f:
            f.write(downloaded_file)

        image_url = f"/images/{filename}"

        prod = pending_products[chat_id]
        product_type = prod['type']
        product_data = prod['data']
        product_data["image_url"] = image_url

        # === РАЗДЕЛЬНОЕ СОХРАНЕНИЕ ===
        if product_type == 'tovar':
            # Отправляем обычный товар на Flask
            resp = requests.post(API_URL, json=product_data, timeout=10)
            if resp.status_code == 200:
                bot.reply_to(message, "✅ Товар успешно добавлен!")
            elif resp.status_code == 409:
                bot.reply_to(message, "⚠️ Такой товар уже существует.")
            else:
                bot.reply_to(message, f"❌ Ошибка сервера: {resp.status_code}")
        else:
            # Для акций и новинок — сохраняем напрямую в свои файлы
            if product_type == 'akcia':
                save_to_file(AKCII_FILE, product_data)
                bot.reply_to(message, "✅ Акция успешно добавлена!")
            elif product_type == 'new':
                save_to_file(NOVINKI_FILE, product_data)
                bot.reply_to(message, "✅ Новый товар успешно добавлен!")

        del pending_products[chat_id]

    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка при обработке фото: {str(e)}")
        if chat_id in pending_products:
            del pending_products[chat_id]

if __name__ == "__main__":
    print("Бот запущен...")
    bot.polling()
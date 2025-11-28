// === Telegram init ===
const tg = window.Telegram.WebApp;
tg.expand();
let currentUserId = null;
let currentUserName = null;

if (tg.initDataUnsafe.user) {
  const user = tg.initDataUnsafe.user;
  currentUserId = user.id;
  currentUserName = (user.first_name || '') + (user.last_name ? ' ' + user.last_name : '');
  document.getElementById('user-name').textContent = currentUserName.trim() || 'Гость';
  document.getElementById('user-id').textContent = `ID: ${user.id}`;
}

function normalizeStreet(s) {
  return s.toLowerCase().replace(/[^а-яa-z0-9\s]/g, '').trim();
}

// === Фон ===
(function createBackground() {
  document.querySelectorAll('.star, .planet').forEach(el => el.remove());
  for (let i = 0; i < 50; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.width = Math.random() * 3 + 1 + 'px';
    star.style.height = star.style.width;
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.zIndex = '-1';
    document.body.appendChild(star);
  }
  const planet = document.createElement('div');
  planet.className = 'planet';
  planet.style.right = '10%';
  planet.style.top = '20%';
  planet.style.zIndex = '-1';
  document.body.appendChild(planet);
})();

// === Глобальные состояния ===
let navStack = [];
let currentProductIndex = 0;
let currentProductGroupList = []; // [{ name, variants: [...] }]

// === Игровые глобальные переменные ===
let gameCanvas, gameCtx, gameRunning = false;
let playerY = 300, playerWidth = 40, playerHeight = 60;
let obstacles = [];
let score = 0;
let gameSpeed = 2;
let spawnInterval = 60;
let frameCount = 0;
let keys = {};
let walkPhase = 0;
let smokeParticles = [];

function resetGameAssets() {
  smokeParticles = [];
  walkPhase = 0;
}

function clearContent() {
  document.getElementById('dynamic-content').innerHTML = '';
}

function showMainMenu() {
  document.getElementById('main-menu').style.display = 'flex';
  clearContent();
  tg.MainButton.hide();
}

function pushScreen(renderFn, label = "Назад") {
  navStack.push(renderFn);
  if (label !== "Назад к товару") {
    tg.MainButton.setText(label).show().onClick(goBack);
  } else {
    tg.MainButton.hide();
  }
  renderFn();
}

function goBack() {
  navStack.pop();
  if (navStack.length > 0) {
    navStack[navStack.length - 1]();
  } else {
    showMainMenu();
  }
}

// === API ===
async function fetchProducts() {
  try {
    const res = await fetch('https://super-doodle-1.onrender.com/api/products');
    return await res.json();
  } catch (e) {
    alert('Не удалось загрузить товары. Запущен ли сервер?');
    return [];
  }
}

async function fetchAkcii() {
  try {
    const res = await fetch('https://super-doodle-1.onrender.com/api/akcii');
    return await res.json();
  } catch (e) {
    alert('Не удалось загрузить акции');
    return [];
  }
}

async function fetchNovinki() {
  try {
    const res = await fetch('https://super-doodle-1.onrender.com/api/novinki');
    return await res.json();
  } catch (e) {
    alert('Не удалось загрузить новые товары');
    return [];
  }
}

// === Дополнительные API-эндпоинты ===
async function fetchLeaderboard() {
  try {
    const res = await fetch('https://super-doodle-1.onrender.com/api/leaderboard');
    return await res.json();
  } catch (e) {
    console.error('Ошибка загрузки лидерборда:', e);
    return [];
  }
}

async function submitScore(score) {
  if (!currentUserId) return;
  try {
    await fetch('https://super-doodle-1.onrender.com/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentUserId,
        username: currentUserName,
        score: score
      })
    });
  } catch (e) {
    console.error('Ошибка отправки счёта:', e);
  }
}

async function fetchBonusCount() {
  if (!currentUserId) return 0;
  try {
    const res = await fetch(`https://super-doodle-1.onrender.com/api/bonuses/${currentUserId}`);
    const data = await res.json();
    return data.count || 0;
  } catch (e) {
    return 0;
  }
}

// === Экран: Глобальный поиск — категории ===
async function showGlobalSearch() {
  const products = await fetchProducts();
  const categories = [...new Set(products.map(p => p.category))];
  clearContent();
  let html = '<h3 style="color:#fff; margin-bottom:16px;">Выберите категорию</h3>';
  categories.forEach(cat => {
    html += `<div class="menu-item" onclick="showBrandsGlobal('${cat.replace(/'/g, "\\'")}')">${cat}</div>`;
  });
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('dynamic-content').innerHTML = html;
}

// === Экран: Бренды в категории ===
async function showBrandsGlobal(category) {
  const products = await fetchProducts();
  const brands = [...new Set(products.filter(p => p.category === category).map(p => p.brand))];
  clearContent();
  let html = `<div class="back-btn" onclick="goBack()">← Назад</div>`;
  html += `<h3 style="color:#fff; margin:16px 0;">${category}</h3>`;
  brands.forEach(brand => {
    html += `<div class="menu-item" onclick="showProductsGlobal('${category}', '${brand.replace(/'/g, "\\'")}')">${brand}</div>`;
  });
  document.getElementById('dynamic-content').innerHTML = html;
}

// === Экран: Товары бренда ===
async function showProductsGlobal(category, brand) {
  const products = await fetchProducts();
  const items = products.filter(p => p.category === category && p.brand === brand);

  const groupedByName = {};
  items.forEach(p => {
    if (!groupedByName[p.name]) groupedByName[p.name] = [];
    groupedByName[p.name].push(p);
  });

  currentProductGroupList = Object.entries(groupedByName).map(([name, variants]) => ({
    name,
    variants
  }));

  if (currentProductGroupList.length === 0) {
    clearContent();
    document.getElementById('dynamic-content').innerHTML = `
      <div class="back-btn" onclick="goBack()">← Назад</div>
      <p style="color:#888; text-align:center;">Нет товаров у бренда ${brand}</p>
    `;
    return;
  }

  currentProductIndex = 0;
  renderCurrentProductCard();
}

// === Экран: Поиск по магазину — выбор города ===
async function showShopSearch() {
  const products = await fetchProducts();
  const cities = [...new Set(products.map(p => p.city))];
  clearContent();
  let html = '<h3 style="color:#fff; margin-bottom:16px;">Выберите город</h3>';
  cities.forEach(city => {
    html += `<div class="menu-item" onclick="showStreets('${city.replace(/'/g, "\\'")}')">${city}</div>`;
  });
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('dynamic-content').innerHTML = html;
}

// === Экран: Улицы в городе ===
async function showStreets(city) {
  const products = await fetchProducts();
  const streets = [...new Set(products.filter(p => p.city === city).map(p => p.street))];
  clearContent();
  let html = `<div class="back-btn" onclick="goBack()">← Назад</div>`;
  html += `<h3 style="color:#fff; margin:16px 0;">${city}</h3>`;
  if (streets.length === 0) {
    html += `<p style="color:#888;">Нет магазинов в этом городе</p>`;
  } else {
    streets.forEach(street => {
      html += `<div class="menu-item" onclick="showCategoriesInShop('${city}', '${street.replace(/'/g, "\\'")}')">${street}</div>`;
    });
  }
  document.getElementById('dynamic-content').innerHTML = html;
}

// === НОВЫЙ ЭКРАН: Категории в магазине ===
async function showCategoriesInShop(city, street) {
  const products = await fetchProducts();
  const filtered = products.filter(p => 
    p.city === city && normalizeStreet(p.street) === normalizeStreet(street)
  );
  const categories = [...new Set(filtered.map(p => p.category))];
  
  clearContent();
  let html = `<div class="back-btn" onclick="goBack()">← Назад</div>`;
  html += `<h3 style="color:#fff; margin:16px 0;">${city}, ${street}</h3>`;
  html += `<h4 style="color:#aaa; margin-bottom:16px;">Выберите категорию</h4>`;
  
  if (categories.length === 0) {
    html += `<p style="color:#888; text-align:center;">Нет товаров в этом магазине</p>`;
  } else {
    categories.forEach(cat => {
      html += `<div class="menu-item" onclick="showBrandsInShop('${city}', '${street}', '${cat.replace(/'/g, "\\'")}')">${cat}</div>`;
    });
  }
  
  document.getElementById('dynamic-content').innerHTML = html;
}

// === НОВЫЙ ЭКРАН: Бренды в категории в магазине ===
async function showBrandsInShop(city, street, category) {
  const products = await fetchProducts();
  const filtered = products.filter(p => 
    p.city === city && 
    normalizeStreet(p.street) === normalizeStreet(street) &&
    p.category === category
  );
  const brands = [...new Set(filtered.map(p => p.brand))];
  
  clearContent();
  let html = `<div class="back-btn" onclick="goBack()">← Назад</div>`;
  html += `<h3 style="color:#fff; margin:16px 0;">${category}</h3>`;
  
  if (brands.length === 0) {
    html += `<p style="color:#888; text-align:center;">Нет брендов в этой категории</p>`;
  } else {
    brands.forEach(brand => {
      html += `<div class="menu-item" onclick="showProductsInShop('${city}', '${street}', '${category}', '${brand.replace(/'/g, "\\'")}')">${brand}</div>`;
    });
  }
  
  document.getElementById('dynamic-content').innerHTML = html;
}

// === НОВЫЙ ЭКРАН: Товары бренда в магазине ===
async function showProductsInShop(city, street, category, brand) {
  const products = await fetchProducts();
  const items = products.filter(p => 
    p.city === city && 
    normalizeStreet(p.street) === normalizeStreet(street) &&
    p.category === category && 
    p.brand === brand
  );

  const groupedByName = {};
  items.forEach(p => {
    if (!groupedByName[p.name]) groupedByName[p.name] = [];
    groupedByName[p.name].push(p);
  });

  currentProductGroupList = Object.entries(groupedByName).map(([name, variants]) => ({
    name,
    variants
  }));

  if (currentProductGroupList.length === 0) {
    clearContent();
    document.getElementById('dynamic-content').innerHTML = `
      <div class="back-btn" onclick="goBack()">← Назад</div>
      <p style="color:#888; text-align:center;">Нет товаров у бренда ${brand} в этой категории</p>
    `;
    return;
  }

  currentProductIndex = 0;
  renderCurrentProductCard();
}

// === Отображение обычной карточки товара (с локациями) ===
function renderCurrentProductCard() {
  document.getElementById('main-menu').style.display = 'none';

  const productGroup = currentProductGroupList[currentProductIndex];
  const total = currentProductGroupList.length;

  let html = `
    <div class="back-btn" onclick="goBack()">← Назад</div>
    <div class="product-card">
      <img src="${productGroup.variants[0].image_url || 'https://via.placeholder.com/80'}"
           style="width:100%; height:180px; object-fit:cover; border-radius:12px; margin-bottom:16px;">
      <h4 style="color:#fff; margin-bottom:12px;">${productGroup.name}</h4>
      
      <p style="color:#ddd; font-size:16px; margin-bottom:8px;">
        💰 <strong>${productGroup.variants[0].price} ₽</strong>
      </p>

      <p style="color:#aaa; font-size:14px; margin-bottom:16px; text-align:left; line-height:1.4;">
        ${productGroup.variants[0].description || 'Описание отсутствует.'}
      </p>

      <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:20px;">
        ${[...new Set(productGroup.variants.map(v => v.flavor))].map(flavor => 
          `<button class="flavor-btn" onclick="showLocationFromVariant('${flavor.replace(/'/g, "\\'")}', '${productGroup.name.replace(/'/g, "\\'")}', '${productGroup.variants[0].brand.replace(/'/g, "\\'")}')">${flavor}</button>`
        ).join('')}
      </div>

      <div style="display:flex; align-items:center; justify-content:center; gap:16px;">
        <button class="nav-btn" onclick="prevProduct()" ${currentProductIndex === 0 ? 'disabled' : ''}>←</button>
        <span style="color:#999; font-size:14px;">${currentProductIndex + 1} из ${total}</span>
        <button class="nav-btn" onclick="nextProduct()" ${currentProductIndex === total - 1 ? 'disabled' : ''}>→</button>
      </div>
    </div>
  `;

  document.getElementById('dynamic-content').innerHTML = html;
}

function prevProduct() {
  if (currentProductIndex > 0) {
    currentProductIndex--;
    renderCurrentProductCard();
  }
}

function nextProduct() {
  if (currentProductIndex < currentProductGroupList.length - 1) {
    currentProductIndex++;
    renderCurrentProductCard();
  }
}

// === Показ ВСЕХ локаций для выбранного вкуса ===
function showLocationFromVariant(flavor, productName, brand) {
  clearContent();

  fetchProducts().then(products => {
    const matches = products.filter(p =>
      p.flavor === flavor &&
      p.name === productName &&
      p.brand === brand
    );

    let html = `<div class="back-btn" onclick="goBackToProduct()">← Назад к товару</div>`;
    html += `<h3 style="color:#fff; margin:16px 0;">${flavor}</h3>`;

    if (matches.length === 0) {
      html += `<p style="color:#888; text-align:center;">Нет данных о наличии</p>`;
    } else {
      matches.forEach(item => {
        const mapUrl = `https://www.google.com/maps/embed/v1/place?key=AIzaSyDqK4dZy1n4vZ6XxQ6X6X6X6X6X6X6X6X6&q=${encodeURIComponent(item.city + ' ' + item.street)}`;
        html += `
          <div style="margin-bottom:20px; background:rgba(30,30,40,0.6); padding:12px; border-radius:10px;">
            <p style="color:#aaa; margin-bottom:8px;">📍 ${item.city}, ${item.street}</p>
            <iframe src="${mapUrl}" width="100%" height="150" frameborder="0" style="border-radius:8px;"></iframe>
          </div>
        `;
      });
    }

    document.getElementById('dynamic-content').innerHTML = html;
  });
}

function goBackToProduct() {
  renderCurrentProductCard();
}

// === Акции ===
async function showPromo() {
  const items = await fetchAkcii();

  if (!Array.isArray(items) || items.length === 0) {
    clearContent();
    document.getElementById('dynamic-content').innerHTML = `
      <div class="back-btn" onclick="goBack()">← Назад</div>
      <p style="color:#888; text-align:center;">Нет акций</p>
    `;
    document.getElementById('main-menu').style.display = 'none';
    return;
  }

  const groupedByName = {};
  items.forEach(p => {
    if (!groupedByName[p.name]) groupedByName[p.name] = [];
    groupedByName[p.name].push(p);
  });

  currentProductGroupList = Object.entries(groupedByName).map(([name, variants]) => ({
    name,
    variants
  }));

  currentProductIndex = 0;
  renderCurrentPromoOrNewCard("Акции");
}

// === Новые товары ===
async function showNewProducts() {
  const items = await fetchNovinki();

  if (!Array.isArray(items) || items.length === 0) {
    clearContent();
    document.getElementById('dynamic-content').innerHTML = `
      <div class="back-btn" onclick="goBack()">← Назад</div>
      <p style="color:#888; text-align:center;">Нет новых товаров</p>
    `;
    document.getElementById('main-menu').style.display = 'none';
    return;
  }

  const groupedByName = {};
  items.forEach(p => {
    if (!groupedByName[p.name]) groupedByName[p.name] = [];
    groupedByName[p.name].push(p);
  });

  currentProductGroupList = Object.entries(groupedByName).map(([name, variants]) => ({
    name,
    variants
  }));

  currentProductIndex = 0;
  renderCurrentPromoOrNewCard("Новые товары");
}

function renderCurrentPromoOrNewCard(title) {
  document.getElementById('main-menu').style.display = 'none';

  const productGroup = currentProductGroupList[currentProductIndex];
  const total = currentProductGroupList.length;

  let html = `
    <div class="back-btn" onclick="goBack()">← Назад</div>
    <div class="product-card">
      <img src="${productGroup.variants[0].image_url || 'https://via.placeholder.com/80'}"
           style="width:100%; height:180px; object-fit:cover; border-radius:12px; margin-bottom:16px;">
      <h4 style="color:#fff; margin-bottom:12px;">${productGroup.name}</h4>
      
      <p style="color:#ddd; font-size:16px; margin-bottom:8px;">
        💰 <strong>${productGroup.variants[0].price} ₽</strong>
      </p>

      <p style="color:#aaa; font-size:14px; margin-bottom:16px; text-align:left; line-height:1.4;">
        ${productGroup.variants[0].description || 'Описание отсутствует.'}
      </p>

      <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:20px;">
        ${productGroup.variants.map(v => 
          `<span style="color:#ddd; background:rgba(50,50,70,0.8); padding:4px 10px; border-radius:12px;">${v.flavor}</span>`
        ).join('')}
      </div>

      <div style="display:flex; align-items:center; justify-content:center; gap:16px;">
        <button class="nav-btn" onclick="prevPromoNew()" ${currentProductIndex === 0 ? 'disabled' : ''}>←</button>
        <span style="color:#999; font-size:14px;">${currentProductIndex + 1} из ${total}</span>
        <button class="nav-btn" onclick="nextPromoNew()" ${currentProductIndex === total - 1 ? 'disabled' : ''}>→</button>
      </div>
    </div>
  `;

  document.getElementById('dynamic-content').innerHTML = html;
}

function prevPromoNew() {
  if (currentProductIndex > 0) {
    currentProductIndex--;
    if (navStack.length > 0 && navStack[navStack.length - 1] === showPromo) {
      renderCurrentPromoOrNewCard("Акции");
    } else if (navStack.length > 0 && navStack[navStack.length - 1] === showNewProducts) {
      renderCurrentPromoOrNewCard("Новые товары");
    }
  }
}

function nextPromoNew() {
  if (currentProductIndex < currentProductGroupList.length - 1) {
    currentProductIndex++;
    if (navStack.length > 0 && navStack[navStack.length - 1] === showPromo) {
      renderCurrentPromoOrNewCard("Акции");
    } else if (navStack.length > 0 && navStack[navStack.length - 1] === showNewProducts) {
      renderCurrentPromoOrNewCard("Новые товары");
    }
  }
}

// ========================
// ====== ИГРА ============
// ========================
// Глобальные переменные игры уже объявлены выше в секции "=== Глобальные состояния ==="
// Не объявляем их повторно!

// Новые состояния анимации
let smokeState = 'idle'; // 'idle', 'inhale', 'exhale'
let smokeTimer = 0;
const SMOKE_CYCLE = 180; // кадров на цикл (3 сек при 60 FPS)

function resetGameAssets() {
  smokeParticles = [];
  walkPhase = 0;
  smokeState = 'idle';
  smokeTimer = 0;
}

function startGame() {
  clearContent();
  document.getElementById('main-menu').style.display = 'none';

  gameCanvas = document.createElement('canvas');
  gameCanvas.width = Math.min(window.innerWidth - 40, 500);
  gameCanvas.height = Math.min(window.innerHeight - 200, 600);
  gameCanvas.style.border = '2px solid #5a3d7c';
  gameCanvas.style.borderRadius = '16px';
  gameCanvas.style.display = 'block';
  gameCanvas.style.margin = '0 auto';
  gameCanvas.tabIndex = 1;
  document.getElementById('dynamic-content').appendChild(gameCanvas);

  gameCtx = gameCanvas.getContext('2d', { alpha: false });
  gameRunning = true;

  playerY = gameCanvas.height / 2;
  obstacles = [];
  score = 0;
  gameSpeed = 2;
  spawnInterval = 60;
  frameCount = 0;
  keys = {};

  resetGameAssets();

  window.addEventListener('keydown', e => keys[e.key] = true);
  window.addEventListener('keyup', e => keys[e.key] = false);
  gameCanvas.focus();

  gameLoop();
}

function gameLoop() {
  if (!gameRunning) return;
  updateGame();
  drawGame();
  requestAnimationFrame(gameLoop);
}

function updateGame() {
  frameCount++;
  walkPhase = (walkPhase + 0.3) % (Math.PI * 2);

  // Управление игроком
  if (keys['ArrowUp'] || keys['w'] || keys['W']) playerY -= 6;
  if (keys['ArrowDown'] || keys['s'] || keys['S']) playerY += 6;
  playerY = Math.max(0, Math.min(gameCanvas.height - 80, playerY));

  // Анимация курения
  smokeTimer++;
  if (smokeTimer >= SMOKE_CYCLE) {
    smokeTimer = 0;
    smokeState = 'inhale';
  }
  if (smokeState === 'inhale' && smokeTimer >= 20) {
    smokeState = 'exhale';
  }
  if (smokeState === 'exhale' && smokeTimer >= 60) {
    smokeState = 'idle';
  }

  // Генерация частиц дыма
  if (smokeState === 'exhale' && frameCount % 3 === 0) {
    const baseX = 60;
    const baseY = playerY + 15 - Math.sin(frameCount * 0.4) * 3;
    smokeParticles.push({
      x: baseX,
      y: baseY,
      size: 10 + Math.random() * 8,
      alpha: 1,
      speedX: 1.5 + Math.random() * 2,
      speedY: (Math.random() - 0.5) * 2,
      life: 80,
      layer: Math.random() > 0.7 ? 'highlight' : (Math.random() > 0.5 ? 'mist' : 'smoke')
    });
  }

  // Обновление частиц
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const p = smokeParticles[i];
    p.x += p.speedX;
    p.y += p.speedY;
    p.alpha = Math.max(0, p.alpha - 1/80);
    p.life--;
    if (p.life <= 0 || p.alpha <= 0) {
      smokeParticles.splice(i, 1);
    }
  }

  // Спавн препятствий
  if (frameCount % spawnInterval === 0) {
    const type = ['babushka', 'plane', 'woman'][Math.floor(Math.random() * 3)];
    obstacles.push({
      x: gameCanvas.width,
      y: Math.random() * (gameCanvas.height - 100) + 30,
      width: 60,
      height: 60,
      type: type,
      passed: false,
      animPhase: 0
    });
  }

  // Обновление препятствий и коллизия
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    obs.x -= gameSpeed;
    obs.animPhase += 0.2;

    // Упрощённая коллизия
    if (
      playerY + 10 < obs.y + obs.height &&
      playerY + 70 > obs.y &&
      25 < obs.x + obs.width &&
      55 > obs.x
    ) {
      gameOver();
      return;
    }

    // Начисление очков
    if (!obs.passed && obs.x + obs.width < 55) {
      obs.passed = true;
      score += 10;
      if (score % 100 === 0) {
        gameSpeed += 0.4;
        spawnInterval = Math.max(25, spawnInterval - 4);
      }
    }

    // Удаление ушедших препятствий
    if (obs.x + obs.width < 0) {
      obstacles.splice(i, 1);
    }
  }
}

// =============== РИСОВАНИЕ ===============
function drawBackground() {
  // Динамический градиент фона
  let bgLevel = Math.min(5, Math.floor(score / 200));
  const bgColors = [
    ['#0c051a', '#12072a'],
    ['#14072e', '#1c0a3d'],
    ['#1d0838', '#280c4f'],
    ['#0c1830', '#102245'],
    ['#121228', '#1a1a3a'],
    ['#000000', '#151525']
  ];
  const [top, bottom] = bgColors[bgLevel];
  const gradient = gameCtx.createLinearGradient(0, 0, 0, gameCanvas.height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  gameCtx.fillStyle = gradient;
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // Городской силуэт с окнами
  gameCtx.fillStyle = 'rgba(15, 10, 30, 0.7)';
  gameCtx.fillRect(0, gameCanvas.height - 50, gameCanvas.width, 50);
  for (let i = 0; i < 12; i++) {
    const buildingX = i * 80 - (frameCount * 0.08) % 80;
    const height = 40 + Math.sin(i * 0.7) * 12;
    gameCtx.fillRect(buildingX, gameCanvas.height - height, 65, height);
    // Окна с миганием
    for (let j = 2; j < height; j += 8) {
      if (j > height - 5) continue;
      const lit = Math.random() > 0.6 || (frameCount + i * 10) % 60 < 5;
      gameCtx.fillStyle = lit ? '#ffcc55' : '#222';
      gameCtx.fillRect(buildingX + 8, gameCanvas.height - j - 2, 4, 4);
      gameCtx.fillRect(buildingX + 25, gameCanvas.height - j - 2, 4, 4);
    }
  }

  // Дальние облака
  gameCtx.fillStyle = 'rgba(200, 190, 255, 0.12)';
  for (let i = 0; i < 3; i++) {
    const x = (frameCount * 0.04 + i * 400) % (gameCanvas.width + 300) - 100;
    drawCloud(x, 100 + i * 60, 0.5);
  }

  // Ближние облака
  gameCtx.fillStyle = 'rgba(180, 170, 240, 0.18)';
  for (let i = 0; i < 2; i++) {
    const x = (frameCount * 0.07 + i * 500) % (gameCanvas.width + 400) - 150;
    drawCloud(x, 180 + i * 50, 0.8);
  }

  // Луна с кратерами и бликом
  gameCtx.fillStyle = 'rgba(255, 253, 220, 0.95)';
  gameCtx.beginPath();
  const moonX = gameCanvas.width - 100 + Math.sin(frameCount * 0.015) * 6;
  gameCtx.arc(moonX, 80, 28, 0, Math.PI * 2);
  gameCtx.fill();

  // Кратеры
  gameCtx.fillStyle = 'rgba(220, 210, 180, 0.5)';
  gameCtx.beginPath();
  gameCtx.arc(moonX - 8, 70, 4, 0, Math.PI * 2);
  gameCtx.arc(moonX + 6, 85, 3, 0, Math.PI * 2);
  gameCtx.arc(moonX - 10, 90, 2.5, 0, Math.PI * 2);
  gameCtx.fill();

  // Блик на луне
  gameCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  gameCtx.beginPath();
  gameCtx.arc(moonX + 10, 70, 6, 0, Math.PI * 2);
  gameCtx.fill();

  // Звёзды с мерцанием
  gameCtx.fillStyle = '#fff';
  for (let i = 0; i < 50; i++) {
    const x = (i * 61) % gameCanvas.width;
    const y = (i * 43) % (gameCanvas.height - 120);
    const flicker = 0.4 + Math.sin(frameCount * 0.04 + i * 0.3) * 0.5;
    gameCtx.globalAlpha = flicker;
    gameCtx.fillRect(x, y, 1.2, 1.2);
  }
  gameCtx.globalAlpha = 1;
}

function drawCloud(x, y, scale) {
  gameCtx.save();
  gameCtx.translate(x, y);
  gameCtx.scale(scale, scale);
  gameCtx.beginPath();
  gameCtx.arc(0, 0, 30, 0, Math.PI * 2);
  gameCtx.arc(25, -10, 25, 0, Math.PI * 2);
  gameCtx.arc(-20, -5, 20, 0, Math.PI * 2);
  gameCtx.arc(10, 10, 22, 0, Math.PI * 2);
  gameCtx.fill();
  gameCtx.restore();
}

function drawPlayer() {
  const legOffset = Math.sin(walkPhase) * 6;
  const armAngle = smokeState === 'inhale' || smokeState === 'exhale' ? -0.4 : 0.2;
  const chestPuff = smokeState === 'inhale' ? 1.1 : 1.0;

  // Тень под ногами
  gameCtx.fillStyle = 'rgba(0,0,0,0.3)';
  gameCtx.beginPath();
  gameCtx.ellipse(35, playerY + 72, 14, 3, 0, 0, Math.PI * 2);
  gameCtx.fill();

  // Туловище (пульсирующее при вдохе)
  gameCtx.fillStyle = '#5a3d7c';
  gameCtx.save();
  gameCtx.translate(35, playerY + 42);
  gameCtx.scale(chestPuff, 1);
  gameCtx.beginPath();
  gameCtx.ellipse(0, 0, 18, 28, 0, 0, Math.PI * 2);
  gameCtx.fill();
  gameCtx.restore();

  // Голова
  gameCtx.fillStyle = '#f9d7ac';
  gameCtx.beginPath();
  gameCtx.arc(35, playerY + 15, 14, 0, Math.PI * 2);
  gameCtx.fill();

  // Глаза с бликом
  const blink = Math.sin(frameCount * 0.12) > 0.97;
  if (!blink) {
    gameCtx.fillStyle = '#000';
    gameCtx.beginPath();
    gameCtx.arc(30, playerY + 12, 2.5, 0, Math.PI * 2);
    gameCtx.arc(40, playerY + 12, 2.5, 0, Math.PI * 2);
    gameCtx.fill();
    // Блики
    gameCtx.fillStyle = '#fff';
    gameCtx.beginPath();
    gameCtx.arc(31, playerY + 11, 0.8, 0, Math.PI * 2);
    gameCtx.arc(41, playerY + 11, 0.8, 0, Math.PI * 2);
    gameCtx.fill();
  }

  // Рот с анимацией
  gameCtx.strokeStyle = '#555';
  gameCtx.lineWidth = 1.3;
  let mouthOpen = 0;
  if (smokeState === 'inhale') mouthOpen = -3;
  else if (smokeState === 'exhale') mouthOpen = 2;
  gameCtx.beginPath();
  gameCtx.arc(35, playerY + 18 + mouthOpen, 4.5, 0, Math.PI);
  gameCtx.stroke();

  // Ноги
  gameCtx.strokeStyle = '#2a1a4a';
  gameCtx.lineWidth = 5;
  gameCtx.lineCap = 'round';
  gameCtx.beginPath();
  gameCtx.moveTo(27, playerY + 68);
  gameCtx.lineTo(24, playerY + 68 + legOffset);
  gameCtx.moveTo(43, playerY + 68);
  gameCtx.lineTo(46, playerY + 68 - legOffset);
  gameCtx.stroke();

  // Рука с вращением
  gameCtx.save();
  gameCtx.translate(48, playerY + 25);
  gameCtx.rotate(armAngle);
  gameCtx.strokeStyle = '#2a1a4a';
  gameCtx.lineWidth = 4;
  gameCtx.beginPath();
  gameCtx.moveTo(0, 0);
  gameCtx.lineTo(-15, -10);
  gameCtx.stroke();
  // Сигарета
  gameCtx.strokeStyle = '#aa8855';
  gameCtx.lineWidth = 2;
  gameCtx.beginPath();
  gameCtx.moveTo(-15, -10);
  gameCtx.lineTo(-25, -12);
  gameCtx.stroke();
  // Тлеющий кончик
  gameCtx.fillStyle = smokeState === 'inhale' ? '#ff3300' : '#ff6633';
  gameCtx.beginPath();
  gameCtx.arc(-25, -12, 2.8, 0, Math.PI * 2);
  gameCtx.fill();
  // Блик на сигарете
  gameCtx.fillStyle = '#fff';
  gameCtx.beginPath();
  gameCtx.arc(-25, -12, 0.8, 0, Math.PI * 2);
  gameCtx.fill();
  gameCtx.restore();
}

function drawObstacles() {
  obstacles.forEach(obs => {
    gameCtx.save();
    gameCtx.translate(obs.x, obs.y);

    if (obs.type === 'babushka') {
      // Тень
      gameCtx.fillStyle = 'rgba(0,0,0,0.2)';
      gameCtx.fillRect(5, 65, 40, 10);

      // Платок (с узором)
      gameCtx.fillStyle = '#d14';
      gameCtx.beginPath();
      gameCtx.moveTo(10, 20);
      gameCtx.lineTo(30, 5);
      gameCtx.lineTo(50, 20);
      gameCtx.fill();
      // Узор на платке
      gameCtx.strokeStyle = '#800';
      gameCtx.lineWidth = 1;
      gameCtx.beginPath();
      gameCtx.moveTo(20, 12);
      gameCtx.lineTo(40, 12);
      gameCtx.stroke();

      // Тело
      gameCtx.fillStyle = '#8B4513';
      gameCtx.fillRect(10, 20, 40, 40);

      // Голова
      gameCtx.fillStyle = '#f9d7ac';
      gameCtx.fillRect(25, 10, 20, 15);

      // Очки
      gameCtx.strokeStyle = '#333';
      gameCtx.lineWidth = 1.5;
      gameCtx.beginPath();
      gameCtx.arc(29, 14, 3, 0, Math.PI * 2);
      gameCtx.arc(39, 14, 3, 0, Math.PI * 2);
      gameCtx.stroke();
      gameCtx.beginPath();
      gameCtx.moveTo(32, 14);
      gameCtx.lineTo(36, 14);
      gameCtx.stroke();

      // Ноги с анимацией шага
      const step = Math.sin(obs.animPhase) * 5;
      gameCtx.strokeStyle = '#3a2a5a';
      gameCtx.lineWidth = 5;
      gameCtx.lineCap = 'round';
      gameCtx.beginPath();
      gameCtx.moveTo(15, 60);
      gameCtx.lineTo(12, 60 + step);
      gameCtx.moveTo(45, 60);
      gameCtx.lineTo(48, 60 - step);
      gameCtx.stroke();
    }
    else if (obs.type === 'plane') {
      // Фюзеляж
      gameCtx.fillStyle = '#555';
      gameCtx.fillRect(20, 25, 20, 10);
      // Левое крыло
      gameCtx.beginPath();
      gameCtx.moveTo(10, 30);
      gameCtx.lineTo(20, 20);
      gameCtx.lineTo(20, 40);
      gameCtx.fill();
      // Правое крыло
      gameCtx.beginPath();
      gameCtx.moveTo(40, 30);
      gameCtx.lineTo(50, 20);
      gameCtx.lineTo(50, 40);
      gameCtx.fill();
      // Пропеллер
      const propAngle = obs.animPhase * 3;
      gameCtx.save();
      gameCtx.translate(10, 30);
      gameCtx.rotate(propAngle);
      gameCtx.fillStyle = '#ddd';
      gameCtx.fillRect(-10, -1, 20, 2);
      gameCtx.restore();
      // Иллюминаторы
      gameCtx.fillStyle = '#fff';
      gameCtx.beginPath();
      gameCtx.arc(25, 28, 1.5, 0, Math.PI * 2);
      gameCtx.arc(35, 28, 1.5, 0, Math.PI * 2);
      gameCtx.fill();
    }
    else if (obs.type === 'woman') {
      // Зонт
      gameCtx.strokeStyle = '#333';
      gameCtx.lineWidth = 2;
      gameCtx.beginPath();
      gameCtx.arc(30, -5, 15, Math.PI, 0);
      gameCtx.stroke();
      gameCtx.beginPath();
      gameCtx.moveTo(30, -5);
      gameCtx.lineTo(30, 5);
      gameCtx.stroke();

      // Платье
      gameCtx.fillStyle = '#d14';
      gameCtx.beginPath();
      gameCtx.moveTo(15, 20);
      gameCtx.lineTo(45, 20);
      gameCtx.lineTo(40, 60);
      gameCtx.lineTo(20, 60);
      gameCtx.fill();

      // Голова
      gameCtx.fillStyle = '#f9d7ac';
      gameCtx.beginPath();
      gameCtx.arc(30, 12, 8, 0, Math.PI * 2);
      gameCtx.fill();

      // Плавающая анимация
      gameCtx.translate(0, Math.sin(obs.animPhase) * 4);
    }

    gameCtx.restore();
  });
}

function drawSmoke() {
  smokeParticles.forEach(p => {
    let fillStyle;
    if (p.layer === 'smoke') {
      fillStyle = `rgba(100, 100, 130, ${p.alpha * 0.7})`;
    } else if (p.layer === 'mist') {
      fillStyle = `rgba(160, 170, 220, ${p.alpha * 0.6})`;
    } else if (p.layer === 'highlight') {
      fillStyle = `rgba(240, 245, 255, ${p.alpha * 0.85})`;
    }

    gameCtx.fillStyle = fillStyle;
    gameCtx.save();
    gameCtx.translate(p.x, p.y);
    gameCtx.scale(1 + Math.sin(frameCount * 0.1 + p.x) * 0.2, 1);
    gameCtx.beginPath();
    gameCtx.arc(0, 0, p.size, 0, Math.PI * 2);
    gameCtx.fill();
    gameCtx.restore();
  });
}

function drawGame() {
  drawBackground();
  drawObstacles();
  drawPlayer();
  drawSmoke();

  // Счёт с тенью и бликом
  gameCtx.fillStyle = '#e0d0ff';
  gameCtx.font = 'bold 20px Arial';
  gameCtx.textAlign = 'left';
  gameCtx.shadowColor = 'rgba(100, 80, 200, 0.8)';
  gameCtx.shadowBlur = 6;
  gameCtx.fillText(`Счёт: ${score}`, 15, 28);
  gameCtx.shadowBlur = 0;
}

function gameOver() {
  gameRunning = false;
  window.removeEventListener('keydown', () => {});
  window.removeEventListener('keyup', () => {});

  // Отправка результата
  submitScore(score);

  clearContent();
  let html = `
    <div style="text-align:center; color:white; padding:20px;">
      <h2 style="color:#ff6666; text-shadow: 0 0 10px rgba(255,100,100,0.7);">💥 ПРОИГРЫШ!</h2>
      <p style="font-size:18px;">Ваш счёт: <strong>${score}</strong></p>
      <button class="menu-item" onclick="startGame()" style="margin-top:20px; background:rgba(90,60,120,0.8);">🔄 Начать заново</button>
      <div class="back-btn" onclick="goBack()" style="margin-top:20px;">← Назад в меню</div>
    </div>
  `;
  document.getElementById('dynamic-content').innerHTML = html;
  document.getElementById('main-menu').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  bind('btn-global-search', () => pushScreen(showGlobalSearch, "Назад"));
  bind('btn-shop-search', () => pushScreen(showShopSearch, "Назад"));
  bind('btn-promo', () => pushScreen(showPromo, "Назад"));
  bind('btn-new-products', () => pushScreen(showNewProducts, "Назад"));
  // Обновление бонусов при старте
  (async () => {
    const count = await fetchBonusCount();
    document.getElementById('bonus-count').textContent = count;
  })();

  bind('btn-bonuses', () => pushScreen(showBonuses, "Назад"));
  bind('btn-leaderboard', () => pushScreen(showLeaderboard, "Назад"));
  bind('btn-play', () => pushScreen(startGame, "Назад"));
});

// === Экран бонусов ===
async function showBonuses() {
  const count = await fetchBonusCount();
  clearContent();
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('dynamic-content').innerHTML = `
    <div class="back-btn" onclick="goBack()">← Назад</div>
    <h3 style="color:#fff; margin:16px 0;">Ваши бонусы</h3>
    <p style="text-align:center; font-size:18px;">Сегодня: <strong>${count}/10</strong></p>
    <p style="color:#aaa; text-align:center;">Бонусы начисляются за каждые 100 очков в игре.<br>Максимум — 10 в день.</p>
  `;
}

// === Экран таблицы лидеров ===
async function showLeaderboard() {
  const board = await fetchLeaderboard();
  clearContent();
  document.getElementById('main-menu').style.display = 'none';
  let html = `<div class="back-btn" onclick="goBack()">← Назад</div>`;
  html += `<h3 style="color:#fff; margin:16px 0;">🏆 Таблица лидеров</h3>`;
  if (board.length === 0) {
    html += `<p style="color:#888; text-align:center;">Пока никто не играл</p>`;
  } else {
    html += `<div style="max-height:60vh; overflow-y:auto;">`;
    board.forEach((p, i) => {
      html += `
        <div style="padding:10px; margin:8px 0; background:rgba(40,40,60,0.5); border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
          <span>${i + 1}. <strong>${p.username}</strong></span>
          <span style="color:#ffcc55;">${p.score}</span>
          <a href="tg://user?id=${p.id}" style="color:#5a3d7c; text-decoration:underline;">💬</a>
        </div>
      `;
    });
    html += `</div>`;
  }
  document.getElementById('dynamic-content').innerHTML = html;
}

// === Экспорт функций в глобальную область ===
window.showBrandsGlobal = showBrandsGlobal;
window.showProductsGlobal = showProductsGlobal;
window.showStreets = showStreets;
window.showCategoriesInShop = showCategoriesInShop;
window.showBrandsInShop = showBrandsInShop;
window.showProductsInShop = showProductsInShop;
window.showLocationFromVariant = showLocationFromVariant;
window.goBack = goBack;
window.goBackToProduct = goBackToProduct;
window.prevProduct = prevProduct;
window.nextProduct = nextProduct;
window.showPromo = showPromo;
window.showNewProducts = showNewProducts;
window.prevPromoNew = prevPromoNew;
window.nextPromoNew = nextPromoNew;
window.startGame = startGame;
window.showBonuses = showBonuses;
window.showLeaderboard = showLeaderboard;
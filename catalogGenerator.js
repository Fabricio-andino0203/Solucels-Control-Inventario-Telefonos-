const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

// 1. Conexión a la Base de Datos (mockeada en memoria para la prueba, o en archivo)
// Para el proyecto final usaremos process.env.DB_PATH
const dbPath = path.join(__dirname, 'inventory.sqlite');
const db = new Database(dbPath);

// ==========================================
// MOCK DATA SETUP (SOLO PARA DEMOSTRACIÓN)
// ==========================================
function setupMockData() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imei TEXT UNIQUE NOT NULL,
      model TEXT NOT NULL,
      price REAL NOT NULL,
      image_url TEXT,
      store_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Disponible',
      FOREIGN KEY(store_id) REFERENCES stores(id)
    );
  `);

  const storeCount = db.prepare('SELECT COUNT(*) as count FROM stores').get().count;
  if (storeCount === 0) {
    const insertStore = db.prepare('INSERT INTO stores (name) VALUES (?)');
    const stores = ['Centro', 'Mall Multiplaza', 'City Mall', 'Plaza Miraflores', 'Cascadas Mall', 'Metromall', 'Sucursal Principal'];
    stores.forEach(s => insertStore.run(s));

    const insertPhone = db.prepare('INSERT INTO phones (imei, model, price, image_url, store_id) VALUES (?, ?, ?, ?, ?)');
    
    // Generar algunos teléfonos de prueba repartidos en las tiendas
    const models = [
      { name: 'iPhone 15 Pro Max', price: 35000, img: 'https://images.unsplash.com/photo-1696446701796-da61225697cc?auto=format&fit=crop&q=80&w=400' },
      { name: 'Samsung Galaxy S24 Ultra', price: 32000, img: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&q=80&w=400' },
      { name: 'Xiaomi 14 Pro', price: 20000, img: 'https://images.unsplash.com/photo-1598327105666-5b89351cb315?auto=format&fit=crop&q=80&w=400' },
      { name: 'Google Pixel 8 Pro', price: 25000, img: 'https://images.unsplash.com/photo-1636246441746-80db80ce428c?auto=format&fit=crop&q=80&w=400' }
    ];

    let imeiCounter = 100000000000000;
    models.forEach(model => {
      // Create 10 to 30 units of each model randomly distributed
      const numUnits = Math.floor(Math.random() * 20) + 10;
      for (let i = 0; i < numUnits; i++) {
        const storeId = Math.floor(Math.random() * 7) + 1;
        insertPhone.run((imeiCounter++).toString(), model.name, model.price, model.img, storeId);
      }
    });
  }
}

// ==========================================
// LÓGICA DE EXPORTACIÓN DEL CATÁLOGO
// ==========================================
function generateCatalog() {
  console.log('Generando reporte de existencias...');

  // 1. Obtener todas las sucursales
  const stores = db.prepare('SELECT * FROM stores ORDER BY id').all();

  // 2. Obtener el inventario agrupado por modelo y por tienda
  // Agrupamos en SQL para optimizar
  const rows = db.prepare(`
    SELECT 
      phones.model,
      phones.image_url,
      phones.price,
      stores.name as store_name,
      COUNT(phones.id) as count
    FROM phones
    JOIN stores ON phones.store_id = stores.id
    WHERE phones.status = 'Disponible'
    GROUP BY phones.model, phones.image_url, phones.price, stores.name
  `).all();

  // 3. Procesar datos para el Frontend
  // Formato: { "iPhone 15": { model: "iPhone 15", image_url: "...", price: 35000, stock_por_tienda: { "Centro": 5, "Mall": 2, ... }, total: 7 } }
  const catalogDataMap = {};
  
  rows.forEach(row => {
    if (!catalogDataMap[row.model]) {
      catalogDataMap[row.model] = {
        model: row.model,
        image_url: row.image_url,
        price: row.price,
        total: 0,
        stock_por_tienda: {}
      };
      // Inicializar todas las tiendas en 0 para este modelo
      stores.forEach(s => { catalogDataMap[row.model].stock_por_tienda[s.name] = 0; });
    }
    
    catalogDataMap[row.model].stock_por_tienda[row.store_name] = row.count;
    catalogDataMap[row.model].total += row.count;
  });

  const catalogDataArray = Object.values(catalogDataMap).sort((a, b) => b.total - a.total);
  const storesNames = stores.map(s => s.name);
  const lastUpdate = new Date().toLocaleString('es-HN');

  // 4. Generar el HTML con CSS y JS incrustado
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Catálogo de Existencias - Solucels Control</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #4f46e5;
            --primary-hover: #4338ca;
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #0f172a;
            --text-muted: #64748b;
            --border-color: #e2e8f0;
            --success: #10b981;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Outfit', sans-serif;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            padding-bottom: 3rem;
        }

        /* HEADER & SEARCH */
        header {
            background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%);
            color: white;
            padding: 3rem 1.5rem 6rem;
            text-align: center;
            border-bottom-left-radius: 2rem;
            border-bottom-right-radius: 2rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            position: relative;
        }

        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }

        .last-update {
            font-size: 0.9rem;
            color: #c7d2fe;
            margin-bottom: 2rem;
        }

        .search-container {
            max-width: 600px;
            margin: 0 auto;
            position: absolute;
            bottom: -1.5rem;
            left: 50%;
            transform: translateX(-50%);
            width: 90%;
            z-index: 10;
        }

        .search-input {
            width: 100%;
            padding: 1.2rem 1.5rem;
            font-size: 1.1rem;
            border: none;
            border-radius: 1rem;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
            outline: none;
            font-family: 'Outfit', sans-serif;
            transition: box-shadow 0.3s ease;
        }

        .search-input:focus {
            box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.4);
            border: 2px solid var(--primary);
        }

        /* CATALOG GRID */
        .container {
            max-width: 1200px;
            margin: 4rem auto 0;
            padding: 0 1.5rem;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
            gap: 2rem;
        }

        .card {
            background: var(--card-bg);
            border-radius: 1.5rem;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            display: flex;
            flex-direction: column;
            border: 1px solid var(--border-color);
        }

        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }

        .card-img-wrapper {
            width: 100%;
            height: 240px;
            overflow: hidden;
            background-color: #f1f5f9;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .card-img {
            width: auto;
            height: 100%;
            object-fit: cover;
            transition: transform 0.5s ease;
        }

        .card:hover .card-img {
            transform: scale(1.05);
        }
        
        .total-badge {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: var(--primary);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 2rem;
            font-weight: 700;
            font-size: 0.9rem;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            backdrop-filter: blur(4px);
        }

        .card-content {
            padding: 1.5rem;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        }

        .card-title {
            font-size: 1.4rem;
            font-weight: 700;
            margin-bottom: 0.25rem;
            color: var(--text-main);
        }

        .card-price {
            font-size: 1.1rem;
            color: var(--success);
            font-weight: 600;
            margin-bottom: 1.5rem;
        }

        .stock-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            border-radius: 0.75rem;
            overflow: hidden;
            border: 1px solid var(--border-color);
            margin-top: auto;
        }

        .stock-table th, .stock-table td {
            padding: 0.75rem 1rem;
            text-align: left;
            font-size: 0.9rem;
            border-bottom: 1px solid var(--border-color);
        }

        .stock-table th {
            background-color: #f8fafc;
            color: var(--text-muted);
            font-weight: 600;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .stock-table tr:last-child td {
            border-bottom: none;
        }

        .stock-table tbody tr:hover {
            background-color: #f1f5f9;
        }

        .qty {
            font-weight: 700;
            text-align: right !important;
        }
        
        .qty-0 {
            color: var(--text-muted);
            font-weight: 400;
        }
        .qty-positive {
            color: var(--success);
        }

        /* Empty state */
        .no-results {
            text-align: center;
            grid-column: 1 / -1;
            padding: 4rem;
            color: var(--text-muted);
            font-size: 1.2rem;
            display: none;
        }

        @media (max-width: 640px) {
            header { padding: 2rem 1rem 5rem; }
            h1 { font-size: 2rem; }
            .container { grid-template-columns: 1fr; margin-top: 3rem; }
        }
    </style>
</head>
<body>

    <header>
        <h1>Existencias Solucels Control</h1>
        <p class="last-update">Última actualización: \${lastUpdate}</p>
        <div class="search-container">
            <input type="text" id="searchInput" class="search-input" placeholder="Buscar por modelo de teléfono..." onkeyup="filterCards()">
        </div>
    </header>

    <div class="container" id="catalogContainer">
        \${catalogDataArray.map(item => \`
            <div class="card" data-model="\${item.model.toLowerCase()}">
                <div class="card-img-wrapper">
                    <span class="total-badge">\${item.total} Uni.</span>
                    <img src="\${item.image_url || 'https://via.placeholder.com/400x400?text=No+Image'}" alt="\${item.model}" class="card-img">
                </div>
                <div class="card-content">
                    <h2 class="card-title">\${item.model}</h2>
                    <div class="card-price">L. \${item.price.toLocaleString('en-US')}</div>
                    
                    <table class="stock-table">
                        <thead>
                            <tr>
                                <th>Sucursal</th>
                                <th style="text-align: right">Disp.</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${storesNames.map(storeName => \`
                                <tr>
                                    <td>\${storeName}</td>
                                    <td class="qty \${item.stock_por_tienda[storeName] > 0 ? 'qty-positive' : 'qty-0'}">
                                        \${item.stock_por_tienda[storeName]}
                                    </td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        \`).join('')}
        
        <div class="no-results" id="noResults">
            No se encontraron modelos que coincidan con la búsqueda.
        </div>
    </div>

    <script>
        function filterCards() {
            const input = document.getElementById('searchInput');
            const filter = input.value.toLowerCase();
            const container = document.getElementById('catalogContainer');
            const cards = container.getElementsByClassName('card');
            let visibleCount = 0;

            for (let i = 0; i < cards.length; i++) {
                const model = cards[i].getAttribute('data-model');
                if (model.indexOf(filter) > -1) {
                    cards[i].style.display = "flex";
                    visibleCount++;
                } else {
                    cards[i].style.display = "none";
                }
            }
            
            document.getElementById('noResults').style.display = visibleCount === 0 ? "block" : "none";
        }
    </script>
</body>
</html>`;

  // 5. Guardar el archivo HTML
  const outputPath = path.join(__dirname, 'catalogo_existencias.html');
  fs.writeFileSync(outputPath, htmlContent, 'utf8');
  console.log('✅ Catálogo generado exitosamente en:', outputPath);
}

// Ejecutar para probar
setupMockData();
generateCatalog();

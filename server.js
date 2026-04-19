const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
process.env.TZ = 'America/Tegucigalpa';
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.get('/admin', (req, res) => res.redirect('/'));

const JWT_SECRET = process.env.JWT_SECRET || 'slc_pro_secret_2026';
const dbPath = process.env.DB_PATH || path.join(__dirname, 'inventory.sqlite');
// Asegurar que el directorio de la base de datos exista (necesario para Railway /data)
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
console.log(`✅ Database target: ${dbPath}`);
const db = new Database(dbPath);

// ==========================================
// TIME ENDPOINT (NO AUTH)
// ==========================================
app.get('/api/hora-actual', (req, res) => {
    const ahora = new Date();
    // Forzar formato de Honduras (Tegucigalpa)
    const opciones = { timeZone: 'America/Tegucigalpa', hour: '2-digit', minute: '2-digit', hour12: true };
    const fechaOp = { timeZone: 'America/Tegucigalpa', day: '2-digit', month: '2-digit', year: 'numeric' };
    
    res.json({ 
        hora: ahora.toLocaleTimeString('en-US', opciones),
        fecha: ahora.toLocaleDateString('es-HN', fechaOp),
        isCorrect: process.env.TZ === 'America/Tegucigalpa'
    });
});

// ==========================================
// SYSTEM TIME HELPERS (Honduras GMT-6)
// ==========================================
function getLocalTime() {
    // Captura la hora exacta del Sistema Operativo Windows
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Tegucigalpa',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(new Date()).replace(' ', 'T').replace('T', ' ');
}

// ==========================================
// SCHEME INIT (PHASE 5: MASTER CATALOG)
// ==========================================
function initDB() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS brands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS phone_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            brand_id INTEGER NOT NULL,
            image_url TEXT,
            price_cash REAL NOT NULL DEFAULT 0,
            credit_enabled INTEGER NOT NULL DEFAULT 0,
            price_credit REAL,
            price_wholesale REAL DEFAULT 0,
            max_discount REAL DEFAULT 0,
            offer_price REAL,
            ram TEXT,
            storage TEXT,
            FOREIGN KEY(brand_id) REFERENCES brands(id),
            UNIQUE(name, brand_id)
        );
        CREATE TABLE IF NOT EXISTS phones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imei TEXT UNIQUE NOT NULL,
            model_id INTEGER NOT NULL,
            condition TEXT NOT NULL DEFAULT 'Nuevo',
            store_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'Disponible',
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY(model_id) REFERENCES phone_models(id),
            FOREIGN KEY(store_id) REFERENCES stores(id)
        );
        CREATE TABLE IF NOT EXISTS transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_id INTEGER NOT NULL,
            from_store_id INTEGER NOT NULL,
            to_store_id INTEGER NOT NULL,
            transfer_date DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY(phone_id) REFERENCES phones(id)
        );
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_id INTEGER NOT NULL,
            store_id INTEGER NOT NULL,
            sale_type TEXT NOT NULL DEFAULT 'Contado',
            final_price REAL NOT NULL,
            prima REAL DEFAULT 0,
            saldo REAL DEFAULT 0,
            payment_status TEXT NOT NULL DEFAULT 'Pagado',
            client_name TEXT,
            installments INTEGER,
            notes TEXT,
            sale_date DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY(phone_id) REFERENCES phones(id),
            FOREIGN KEY(store_id) REFERENCES stores(id)
        );
    `);

    // === SAFE MIGRATION: Ensure ram & storage columns exist ===
    try { db.exec('ALTER TABLE phone_models ADD COLUMN ram TEXT'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE phone_models ADD COLUMN storage TEXT'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE phone_models ADD COLUMN price_wholesale REAL DEFAULT 0'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE phone_models ADD COLUMN max_discount REAL DEFAULT 0'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE phone_models ADD COLUMN offer_price REAL'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE phone_models ADD COLUMN price_cost REAL DEFAULT 0'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE sales ADD COLUMN client_name TEXT'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE sales ADD COLUMN installments INTEGER'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE sales ADD COLUMN discount REAL DEFAULT 0'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE sales ADD COLUMN final_price_type TEXT DEFAULT "Contado"'); } catch(e) { /* exists */ }
    try { db.exec('ALTER TABLE sales ADD COLUMN cost_price REAL DEFAULT 0'); } catch(e) { /* exists */ }

    if (db.prepare('SELECT COUNT(*) as count FROM users').get().count === 0) {
        const hash = bcrypt.hashSync('admin123', 10);
        db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
        
        const insertStore = db.prepare('INSERT INTO stores (name) VALUES (?)');
        for(let i=1; i<=7; i++) insertStore.run(`Tienda ${i}`);
        
        const insertBrand = db.prepare('INSERT INTO brands (name) VALUES (?)');
        ['Apple', 'Samsung', 'Xiaomi'].forEach(b => insertBrand.run(b));
        
        const bApple = db.prepare("SELECT id FROM brands WHERE name='Apple'").get().id;
        const bSamsung = db.prepare("SELECT id FROM brands WHERE name='Samsung'").get().id;
        
        // Populate standard models with master prices
        db.prepare(`INSERT INTO phone_models (name, brand_id, image_url, price_cash, credit_enabled, price_credit) 
            VALUES (?, ?, ?, ?, ?, ?)`).run(
            'iPhone 15 Pro Max', bApple, 'https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-15-pro-max-1.jpg', 
            35000, 1, 40000
        );
        db.prepare(`INSERT INTO phone_models (name, brand_id, image_url, price_cash, credit_enabled, price_credit) 
            VALUES (?, ?, ?, ?, ?, ?)`).run(
            'Galaxy S24 Ultra', bSamsung, 'https://fdn2.gsmarena.com/vv/pics/samsung/samsung-galaxy-s24-ultra-5g-sm-s928-1.jpg', 
            32000, 1, 38000
        );
    }
}
initDB();

// ==========================================
// MIDDLEWARE & AUTH
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({error: "Credenciales inválidas."});
        }
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username });
    } catch(err) { res.status(500).json({error: err.message}); }
});

const authenticateToken = (req, res, next) => {
    if (req.path === '/login' || req.path === '/export-catalog' || req.path === '/admin/migrate-db') return next();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({error: "Acceso denegado. Se requiere iniciar sesión."});
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({error: "Token de seguridad inválido o expirado."});
        req.user = user;
        next();
    });
};
app.use('/api', authenticateToken);

// ==========================================
// USERS & SECURITY
// ==========================================
app.get('/api/users', (req, res) => {
    try {
        const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
        if(!u || u.username !== 'admin') return res.status(403).json({error: "Solo el administrador puede ver usuarios."});
        res.json(db.prepare('SELECT id, username FROM users').all());
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/users', (req, res) => {
    try {
        const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
        if(!u || u.username !== 'admin') return res.status(403).json({error: "Solo administrador."});
        const { username, password } = req.body;
        const hash = bcrypt.hashSync(password, 10);
        const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
        res.json({ id: info.lastInsertRowid, success: true });
    } catch(err) { res.status(400).json({error: err.message}); }
});

app.delete('/api/users/:id', (req, res) => {
    try {
        const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
        if(!u || u.username !== 'admin') return res.status(403).json({error: "Solo administrador."});
        if(req.params.id == req.user.id) return res.status(400).json({error: "No puedes eliminarte a ti mismo."});
        db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch(err) { res.status(400).json({error: err.message}); }
});

app.put('/api/users/:id', (req, res) => {
    try {
        const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
        if(!u || u.username !== 'admin') return res.status(403).json({error: "Solo administrador."});
        const { username } = req.body;
        if (!username || username.trim() === '') return res.status(400).json({error: "Nombre de usuario inválido."});
        db.prepare('UPDATE users SET username=? WHERE id=?').run(username.trim(), req.params.id);
        res.json({ success: true });
    } catch(err) { 
        if(err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({error: "El nombre de usuario ya existe."});
        res.status(400).json({error: err.message}); 
    }
});

app.put('/api/users/password', (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
        if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: "Contraseña actual incorrecta." });
        const hash = bcrypt.hashSync(newPassword, 10);
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.user.id);
        res.json({ success: true });
    } catch(err) { res.status(400).json({error: err.message}); }
});

// ==========================================
// CONFIG: STORES & BRANDS
// ==========================================
app.get('/api/stores', (req, res) => { try { res.json(db.prepare('SELECT * FROM stores ORDER BY name').all()); } catch(err) { res.status(500).json({error: err.message}); } });
app.post('/api/stores', (req, res) => { try { const info = db.prepare('INSERT INTO stores (name) VALUES (?)').run(req.body.name); res.json({ id: info.lastInsertRowid, success: true }); } catch(err) { res.status(400).json({error: err.message}); } });
app.delete('/api/stores/:id', (req, res) => { try { db.prepare('DELETE FROM stores WHERE id=?').run(req.params.id); res.json({ success: true }); } catch(err) { res.status(400).json({error: "No se puede eliminar la sucursal si tiene historial."}); } });

app.get('/api/brands', (req, res) => { try { res.json(db.prepare('SELECT * FROM brands ORDER BY name').all()); } catch(err) { res.status(500).json({error: err.message}); } });
app.post('/api/brands', (req, res) => { try { const info = db.prepare('INSERT INTO brands (name) VALUES (?)').run(req.body.name); res.json({ id: info.lastInsertRowid, success: true }); } catch(err) { res.status(400).json({error: err.message}); } });
app.delete('/api/brands/:id', (req, res) => { try { db.prepare('DELETE FROM brands WHERE id=?').run(req.params.id); res.json({ success: true }); } catch(err) { res.status(400).json({error: "No se puede porque tiene modelos."}); } });

// ==========================================
// MODELS (MASTER CATALOG)
// ==========================================
app.get('/api/models', (req, res) => {
    try {
        res.json(db.prepare(`
            SELECT m.*, b.name as brand_name 
            FROM phone_models m JOIN brands b ON m.brand_id = b.id 
            ORDER BY b.name, m.name
        `).all());
    } catch(err) { res.status(500).json({error: err.message}); }
});
app.post('/api/models', (req, res) => {
    let { name, brand_id, image_url, price_cash, credit_enabled, price_credit, price_wholesale, max_discount, ram, storage, price_cost } = req.body;
    credit_enabled = credit_enabled ? 1 : 0;
    
    if (!name || !brand_id || !price_cash || price_cash <= 0) return res.status(400).json({ error: "Datos incompletos o precio inválido." });
    if (credit_enabled && (!price_credit || price_credit <= 0)) return res.status(400).json({ error: "Especifique el precio de crédito." });

    try {
        const result = db.prepare(`INSERT INTO phone_models (name, brand_id, image_url, price_cash, credit_enabled, price_credit, price_wholesale, max_discount, ram, storage, price_cost) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            name, brand_id, image_url || null, price_cash, credit_enabled, price_credit || null, parseFloat(price_wholesale) || 0, parseFloat(max_discount) || 0, ram || null, storage || null, parseFloat(price_cost) || 0
        );
        res.json({ id: result.lastInsertRowid, success: true });
    } catch(err) { 
        if(err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({error: "Este modelo ya existe para esta marca."});
        res.status(400).json({error: err.message}); 
    }
});

app.put('/api/models/:id', (req, res) => {
    let { name, brand_id, image_url, price_cash, credit_enabled, price_credit, price_wholesale, max_discount, offer_price, ram, storage, price_cost } = req.body;
    
    credit_enabled = credit_enabled ? 1 : 0;
    if (!price_cash || price_cash <= 0) return res.status(400).json({ error: "El modelo debe tener un precio de contado válido." });

    try {
        db.prepare(`UPDATE phone_models SET name=?, brand_id=?, image_url=?, price_cash=?, credit_enabled=?, price_credit=?, price_wholesale=?, max_discount=?, offer_price=?, ram=?, storage=?, price_cost=? WHERE id=?`).run(
            name, brand_id, image_url || null, price_cash, credit_enabled, price_credit || null, parseFloat(price_wholesale) || 0, parseFloat(max_discount) || 0, offer_price || null, ram || null, storage || null, parseFloat(price_cost) || 0, req.params.id
        );
        res.json({ success: true });
    } catch(err) { 
        if(err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({error: "Este modelo ya existe para esta marca."});
        res.status(400).json({error: err.message}); 
    }
});

app.put('/api/models/:id/offer', (req, res) => {
    try {
        const { offer_price } = req.body;
        db.prepare('UPDATE phone_models SET offer_price=? WHERE id=?').run(offer_price || null, req.params.id);
        res.json({ success: true });
    } catch(err) { res.status(400).json({error: err.message}); }
});
app.delete('/api/models/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM phone_models WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch(err) { res.status(400).json({error: "Operación Bloqueada. Este modelo tiene inventario físico ligado o un historial asociado."}); }
});

// ==========================================
// PHONES (PHYSICAL INVENTORY UNITS)
// ==========================================
app.get('/api/phones', (req, res) => {
    const { brand, store, q } = req.query;
    try {
        let sql = `
            SELECT p.*, m.name as model_name, m.brand_id, m.price_cash, m.credit_enabled, 
                   m.price_credit, m.price_wholesale, m.max_discount, m.image_url, m.ram, m.storage, b.name as brand_name, s.name as store_name
            FROM phones p
            JOIN phone_models m ON p.model_id = m.id
            JOIN brands b ON m.brand_id = b.id
            JOIN stores s ON p.store_id = s.id
            WHERE p.status = 'Disponible'
        `;
        let params = [];

        if (brand && brand !== 'ALL') {
            sql += ` AND m.brand_id = ?`;
            params.push(brand);
        }
        if (store && store !== 'ALL') {
            sql += ` AND p.store_id = ?`;
            params.push(store);
        }
        if (q) {
            sql += ` AND (LOWER(p.imei) LIKE ? OR LOWER(m.name) LIKE ? OR LOWER(b.name) LIKE ?)`;
            const search = `%${q.toLowerCase()}%`;
            params.push(search, search, search);
        }

        sql += ` ORDER BY p.id DESC`;
        const rows = db.prepare(sql).all(...params);
        res.json(rows);
    } catch(err) {
        console.error('Fetch Inventory Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ULTRA FAST MOBILE POST (Just 3 inputs needed from UI)
app.post('/api/phones', (req, res) => {
    let { imei, model_id, store_id } = req.body;
    if (!imei) return res.status(400).json({ error: "El identificador IMEI / S/N es obligatorio." });
    
    // Server-side normalization
    const cleanImei = imei.replace(/\s+/g, '').toUpperCase();
    
    // Minimal validation (anything with content)
    if (cleanImei.length < 1) {
        return res.status(400).json({ error: "El identificador IMEI / S/N es obligatorio." });
    }

    try {
        const now = getLocalTime();
        const stmt = db.prepare(`INSERT INTO phones (imei, model_id, store_id, condition, created_at) VALUES (?, ?, ?, 'Nuevo', ?)`);
        const info = stmt.run(cleanImei, model_id, store_id, now);
        res.json({ id: info.lastInsertRowid, success: true });
    } catch (err) {
        if(err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: "El identificador ya se encuentra registrado en el sistema." });
        res.status(400).json({ error: err.message });
    }
});
// BULK IMEI INSERTION
// ===========================
// BULK INSERT (ULTRA-ROBUST)
// ===========================
app.post('/api/phones/bulk', (req, res) => {
    const { model_id, store_id, imeis } = req.body;
    console.log(`[BULK] Inicia carga: Modelo=${model_id}, Store=${store_id}, Total=${imeis?.length}`);

    if (!model_id || !store_id) return res.status(400).json({ error: 'Faltan parámetros críticos (Modelo/Tienda)' });
    if (!Array.isArray(imeis) || imeis.length === 0) return res.status(400).json({ error: 'La lista de IMEIs está vacía' });

    const stmt = db.prepare(`INSERT INTO phones (imei, model_id, store_id, condition, created_at) VALUES (?, ?, ?, 'Nuevo', ?)`);
    let results = { inserted: 0, duplicates: 0, others: 0 };

    // Usamos una transacción para máxima velocidad
    const executeBulk = db.transaction((list) => {
        const now = getLocalTime();
        for (const raw of list) {
            const clean = raw.toString().trim().replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (!clean) continue;
            try {
                stmt.run(clean, model_id, store_id, now);
                results.inserted++;
            } catch (err) {
                if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                    results.duplicates++;
                } else {
                    results.others++;
                    console.error(`[BULK ERROR] IMEI ${clean}:`, err.message);
                }
            }
        }
    });

    try {
        executeBulk(imeis);
        console.log(`[BULK OK] Resumen: +${results.inserted}, =${results.duplicates}, !${results.others}`);
        res.json(results);
    } catch (err) {
        console.error('[BULK CRITICAL]:', err.message);
        res.status(500).json({ error: 'Error sistémico en la base de datos: ' + err.message });
    }
});

app.delete('/api/phones/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM transfers WHERE phone_id=?').run(req.params.id);
        db.prepare('DELETE FROM sales WHERE phone_id=?').run(req.params.id);
        db.prepare('DELETE FROM phones WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ==========================================
// TRANSFERS
// ==========================================
app.post('/api/transfers', (req, res) => {
    const { phone_id, to_store_id } = req.body;
    try {
        const phone = db.prepare('SELECT store_id, status FROM phones WHERE id=?').get(phone_id);
        if(!phone) return res.status(404).json({error: "Teléfono no encontrado"});
        if(phone.status === 'Vendido') return res.status(400).json({error: "El IMEI ya fue despachado o vendido."});
        if(phone.store_id == to_store_id) return res.status(400).json({error: "Ya se encuentra en esa sucursal."});

        db.transaction(() => {
            const now = getLocalTime();
            db.prepare('INSERT INTO transfers (phone_id, from_store_id, to_store_id, transfer_date) VALUES (?, ?, ?, ?)').run(phone_id, phone.store_id, to_store_id, now);
            db.prepare('UPDATE phones SET store_id=? WHERE id=?').run(to_store_id, phone_id);
        })();
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});
app.get('/api/transfers', (req, res) => {
    try {
        const { store, date_from, date_to } = req.query;
        let sql = `
            SELECT t.*, p.imei, m.name as model_name, m.ram, m.storage, m.image_url,
                   s1.name as from_store, s2.name as to_store, s2.id as to_store_id
            FROM transfers t 
            JOIN phones p ON t.phone_id = p.id 
            JOIN phone_models m ON p.model_id = m.id
            JOIN stores s1 ON t.from_store_id = s1.id 
            JOIN stores s2 ON t.to_store_id = s2.id
            WHERE 1=1
        `;
        const params = [];
        if (store && store !== 'ALL') {
            sql += ` AND t.to_store_id = ?`;
            params.push(store);
        }
        if (date_from) {
            sql += ` AND DATE(t.transfer_date) >= DATE(?)`;
            params.push(date_from);
        }
        if (date_to) {
            sql += ` AND DATE(t.transfer_date) <= DATE(?)`;
            params.push(date_to);
        }
        sql += ` ORDER BY t.transfer_date DESC`;
        if (!store && !date_from && !date_to) sql += ` LIMIT 200`;
        res.json(db.prepare(sql).all(...params));
    } catch (err) { res.status(500).json({error: err.message}); }
});

// ==========================================
// SALES (BLIND MASTER CATALOG PRICING)
// ==========================================
app.post('/api/sales', (req, res) => {
    console.log("POST /api/sales - BODY:", req.body);
    const { phone_id, store_id, sale_type, prima, notes, discount, price_type, sale_date } = req.body;
    try {
        const phone = db.prepare(`SELECT p.id, p.status, p.store_id, m.price_cash, m.credit_enabled, m.price_credit, m.price_wholesale, m.max_discount, m.offer_price, m.price_cost 
                                  FROM phones p JOIN phone_models m ON p.model_id = m.id WHERE p.id=?`).get(phone_id);
        
        if (!phone) return res.status(404).json({error: "Unidad física no encontrada en base de datos."});
        if (phone.status === 'Vendido') return res.status(400).json({error: "Error Crítico: El equipo ya figura como facturado."});
        if (phone.store_id != store_id) return res.status(400).json({error: "Bloqueo: El IMEI no existe físicamente en el inventario local de esta tienda."});

        const actDiscount = parseFloat(discount) || 0;
        const actPriceType = price_type || 'Contado';
        
        // ADMIN ONLY SECURITY CHECK (Soft validation in backend for safety)
        const user = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
        if (actDiscount > 0 && user.username !== 'admin') {
            return res.status(403).json({error: "Solo administradores pueden aplicar descuentos manuales."});
        }
        if (actDiscount > (phone.max_discount || 0) && user.username !== 'admin') {
             // Even if user is admin, we might want to alert, but the user said "admin has access, don't care about security".
             // I'll allow admin to exceed max_discount if they want, but guid it.
        }

        let base_price = 0;
        if (phone.offer_price && (actPriceType === 'Contado')) {
            base_price = phone.offer_price;
        } else {
            if (actPriceType === 'Crédito') {
                if (!phone.credit_enabled) return res.status(400).json({error: "Operación Restringida: Catálogo Maestro indica que no aplica crédito."});
                base_price = phone.price_credit;
            } else if (actPriceType === 'Mayorista') {
                base_price = phone.price_wholesale || phone.price_cash;
            } else {
                base_price = phone.price_cash;
            }
        }

        let final_price = base_price - actDiscount;
        let saldo = 0;
        let payment_status = 'Pagado';
        let actPrima = parseFloat(prima) || 0;
        let defaultClient = (actPriceType === 'Crédito') ? 'Crédito Externo' : '';

        if (actPriceType === 'Crédito') {
            saldo = final_price - actPrima;
            if (saldo > 0) payment_status = 'Pendiente';
        } else {
            // Contado o Mayorista
            actPrima = final_price;
            saldo = 0;
        }

        db.transaction(() => {
            let finalDate = sale_date;
            if (!finalDate) {
                finalDate = getLocalTime();
            } else if (finalDate.length === 10) { 
                // If only YYYY-MM-DD is provided, append a default time
                finalDate += " 12:00:00";
            }

            db.prepare("UPDATE phones SET status='Vendido' WHERE id=?").run(phone_id);
            const stmt = db.prepare(`INSERT INTO sales (phone_id, store_id, sale_type, final_price, prima, saldo, payment_status, client_name, installments, notes, discount, final_price_type, sale_date, cost_price) 
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(phone_id, store_id, sale_type, final_price, actPrima, saldo, payment_status, defaultClient, null, notes || '', actDiscount, actPriceType, finalDate, phone.price_cost || 0);
        })();
        res.json({ success: true, final_price });
    } catch(err) { res.status(400).json({error: err.message}); }
});

app.get('/api/sales', (req, res) => {
    try {
        res.json(db.prepare(`
            SELECT sl.*, p.imei, m.name as model_name, m.ram, m.storage, s.name as store_name 
            FROM sales sl JOIN phones p ON sl.phone_id = p.id
            JOIN phone_models m ON p.model_id = m.id JOIN stores s ON sl.store_id = s.id
            ORDER BY sl.sale_date DESC LIMIT 100
        `).all());
    } catch (err) { res.status(500).json({error: err.message}); }
});

// ==========================================
// LIQUIDATIONS
// ==========================================
app.get('/api/liquidations', (req, res) => {
    try {
        res.json(db.prepare(`
            SELECT sl.*, p.imei, m.name as model_name, m.ram, m.storage, s.name as store_name 
            FROM sales sl JOIN phones p ON sl.phone_id = p.id
            JOIN phone_models m ON p.model_id = m.id JOIN stores s ON sl.store_id = s.id
            WHERE sl.payment_status = 'Pendiente'
            ORDER BY sl.sale_date ASC
        `).all());
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.put('/api/liquidations/:id/pay', (req, res) => {
    try {
        const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
        if(!sale) return res.status(404).json({error: "Venta no encontrada."});
        db.prepare("UPDATE sales SET payment_status='Pagado', saldo=0 WHERE id=?").run(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(400).json({error: err.message}); }
});

// ==========================================
// EXPORT CATALOG (DYNAMIC NO-CACHE)
// ==========================================
app.get(['/api/export-catalog', '/catalogo_existencias.html'], (req, res) => {
    try {
        const stores = db.prepare('SELECT * FROM stores ORDER BY id').all();
        // Master prices are pulled statically from phone_models (m.price_cash)
        const rows = db.prepare(`
            SELECT b.name as brand_name, m.name as model_name, m.price_cash, m.price_credit, m.credit_enabled, m.offer_price, m.image_url, m.ram, m.storage, s.name as store_name, COUNT(p.id) as count
            FROM phones p JOIN phone_models m ON p.model_id = m.id JOIN brands b ON m.brand_id = b.id JOIN stores s ON p.store_id = s.id
            WHERE p.status = 'Disponible' GROUP BY b.name, m.name, m.price_cash, m.price_credit, m.credit_enabled, m.offer_price, m.image_url, m.ram, m.storage, s.name
        `).all();

        const catalogDataMap = {};
        rows.forEach(row => {
            const key = `${row.brand_name}-${row.model_name}`;
            if (!catalogDataMap[key]) {
                // ENSURE RELATIVE PATHS FOR LOCAL IMAGES
                let img = row.image_url || 'https://via.placeholder.com/400x400?text=No+Image';
                if(img.includes('localhost')) {
                    try { const url = new URL(img); img = url.pathname; } catch(e) {}
                }

                // Fallback: If price_credit is missing or zero, calculate 15% more than price_cash
                const fallbackCredit = row.price_credit && row.price_credit > 0 ? row.price_credit : (row.price_cash * 1.15);

                catalogDataMap[key] = { 
                    brand: row.brand_name, model: row.model_name, condition: 'Nuevo/Stock', 
                    image_url: img, price: row.price_cash, price_credit: fallbackCredit, credit_enabled: row.credit_enabled,
                    offer_price: row.offer_price,
                    ram: row.ram, storage: row.storage, total: 0, stock_por_tienda: {} 
                };
                stores.forEach(s => { catalogDataMap[key].stock_por_tienda[s.name] = 0; });
            }
            catalogDataMap[key].stock_por_tienda[row.store_name] += row.count;
            catalogDataMap[key].total += row.count;
        });

        const catalogDataArray = Object.values(catalogDataMap).sort((a, b) => b.total - a.total);
        const storesNames = stores.map(s => s.name);
        const lastUpdate = new Date().toLocaleString('es-HN');

        const outputHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"><title>Catálogo Virtual - Solucels Control</title>
        <link rel="icon" type="image/x-icon" href="/favicon.ico">
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>:root{--primary:#2563eb;--bg-color:#0b0f19;--card-bg:#161b2c;--text-main:#f8fafc;--text-muted:#94a3b8;--border-color:rgba(255,255,255,0.08);--success:#10b981;--accent:#3b82f6;--danger:#ef4444;}
        *{box-sizing:border-box;margin:0;padding:0;font-family:'Outfit',sans-serif;-webkit-tap-highlight-color:transparent;}
        body{background-color:var(--bg-color);color:var(--text-main);padding-bottom:env(safe-area-inset-bottom, 3rem);line-height:1.5;overflow-x:hidden;}
        header{background:rgba(30, 41, 59, 0.8);backdrop-filter:blur(20px);padding:calc(1rem + env(safe-area-inset-top)) 1.5rem 1.5rem;text-align:center;border-bottom:1px solid var(--border-color);position:sticky;top:0;z-index:1000;}
        h1{font-size:1.8rem;font-weight:700;letter-spacing:-0.03em;margin-bottom:0.25rem;color:#fff;}
        .container{max-width:1400px;margin:0 auto;padding:0 1rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem;}
        .card{background:var(--card-bg);border-radius:1.5rem;overflow:hidden;border:1px solid var(--border-color);transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);display:flex;flex-direction:column;position:relative;box-shadow:0 4px 20px rgba(0,0,0,0.2);}
        .card:hover{transform:translateY(-8px);border-color:var(--accent);box-shadow:0 12px 30px rgba(0,0,0,0.4);}
        .card-img-wrapper{width:100%;height:280px;background:#000;display:flex;align-items:center;justify-content:center;position:relative;padding:1rem;}
        .card-img{height:100%;max-width:100%;object-fit:contain;transition:transform 0.5s ease;}
        .card:hover .card-img{transform:scale(1.08);}
        .total-badge{position:absolute;top:1rem;right:1rem;background:var(--primary);color:white;padding:0.5rem 1rem;border-radius:2rem;font-weight:700;font-size:0.85rem;box-shadow:0 4px 10px rgba(0,0,0,0.3);z-index:2;}
        .card-content{padding:1.5rem;flex-grow:1;display:flex;flex-direction:column;}
        .brand-label{color:var(--accent);font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.5rem;}
        .model-name{font-size:1.4rem;font-weight:7100;margin-bottom:1rem;color:#fff;line-height:1.2;}
        .specs-bar{display:flex;gap:0.75rem;margin-bottom:1.5rem;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:1rem;font-size:0.85rem;border:1px solid rgba(255,255,255,0.05);}
        .spec-item{display:flex;align-items:center;gap:0.4rem;color:var(--text-main);}
        .spec-item i{color:var(--accent);font-size:0.8rem;}
        .card-price{color:var(--success);font-size:1.6rem;font-weight:800;margin-bottom:0.25rem;display:flex;align-items:baseline;gap:0.3rem;}
        .card-price::before{content:'Contado L.';font-size:0.8rem;opacity:0.7;font-weight:600;text-transform:uppercase;}
        .price-old{text-decoration:line-through;color:var(--text-muted);font-size:1.2rem;margin-bottom:0.25rem;display:flex;align-items:baseline;gap:0.3rem;}
        .price-old::before{content:'Normal L.';font-size:0.7rem;opacity:0.6;font-weight:500;text-transform:uppercase;}
        .price-offer{color:var(--danger);font-size:1.7rem;font-weight:900;margin-bottom:0.25rem;display:flex;align-items:baseline;gap:0.3rem;text-shadow:0 0 10px rgba(239, 68, 68, 0.3);}
        .price-offer::before{content:'Oferta L.';font-size:0.8rem;opacity:0.9;font-weight:700;text-transform:uppercase;}
        .card-price-credit{color:#ff9800;font-size:1.4rem;font-weight:800;margin-bottom:1.25rem;display:flex;align-items:baseline;gap:0.4rem;background:rgba(255,152,0,0.15);padding:0.6rem 1rem;border-radius:0.75rem;width:fit-content;border:1px solid rgba(255,152,0,0.3);box-shadow:0 4px 10px rgba(255,152,0,0.1);}
        .card-price-credit::before{content:'Crédito L.';font-size:0.8rem;opacity:0.9;font-weight:700;text-transform:uppercase;}
        .credit-badge{font-size:0.75rem;color:#ff9800;margin-top:0.25rem;font-weight:700;display:flex;align-items:center;gap:0.4rem;background:rgba(255,152,0,0.05);padding:0.3rem;border-radius:0.3rem;}
        .stock-table{width:100%;border-collapse:collapse;font-size:0.9rem;margin-top:auto;}
        .stock-table td{padding:0.8rem 0;border-bottom:1px solid rgba(255,255,255,0.05);}
        .stock-table tr:last-child td{border-bottom:none;}
        .store-name{color:var(--text-muted);font-weight:500;}
        .store-count{text-align:right;font-weight:700;color:var(--accent);}
        .empty-count{color:#334155;font-weight:400;}
        @media (max-width: 768px){
            h1{font-size:2rem;}
            .container{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));padding:0 0.75rem;}
            .card-img-wrapper{height:220px;}
        }
        @media (max-width: 480px){
            header{padding:3rem 1rem 2rem;}
            h1{font-size:1.75rem;}
            .container{grid-template-columns:1fr;}
            .card-price{font-size:1.5rem;}
        }
        </style></head>
        <body><header><h1>Catálogo de Modelos Maestro Solucels Control</h1><p style="color:var(--text-muted)">Última actualización: ${lastUpdate}</p></header>
        <div class="container">
            ${catalogDataArray.map(item => `
            <div class="card">
                <div class="card-img-wrapper"><span class="total-badge">${item.total} Uni.</span><img src="${item.image_url}" class="card-img" loading="lazy" onerror="this.src='https://via.placeholder.com/400x400?text=Phone'"></div>
                <div class="card-content">
                    <div class="brand-label">${item.brand}</div>
                    <h2 class="model-name">${item.model}${(item.ram || item.storage) ? ' &mdash; ' + (item.ram || 'N/A') + ' / ' + (item.storage || 'N/A') : ''}</h2>
                    <div class="specs-bar">
                        <div class="spec-item"><i class="fas fa-microchip"></i> ${item.ram || '<span style="color:#475569">N/A</span>'}</div>
                        <div class="spec-item"><i class="fas fa-hdd"></i> ${item.storage || '<span style="color:#475569">N/A</span>'}</div>
                    </div>
                    <div class="card-price ${item.offer_price > 0 ? 'price-old' : ''}">${item.price.toLocaleString('en-US')}</div>
                    ${item.offer_price > 0 ? `<div class="price-offer">${item.offer_price.toLocaleString('en-US')}</div>` : ''}
                    ${item.credit_enabled ? `<div class="card-price-credit">${item.price_credit.toLocaleString('en-US')}</div><div class="credit-badge"><i class="fas fa-check-circle"></i> Aplica con Crédito / Cuotas Disponibles</div>` : `<div style="height:40px; margin-bottom:1.25rem; font-size:0.8rem; color:var(--text-muted);">Solo disponible al contado</div>`}
                    <table class="stock-table"><tbody>${storesNames.map(s => `<tr><td class="store-name">${s}</td><td class="store-count ${item.stock_por_tienda[s]===0?'empty-count':''}">${item.stock_por_tienda[s]}</td></tr>`).join('')}</tbody></table>
                </div>
            </div>`).join('')}
        </div></body></html>`;

        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Type': 'text/html'
        });
        res.send(outputHtml);
    } catch(err) { res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('Servidor Solucels listo en puerto 3000');
});


const Database = require('better-sqlite3');
const db = new Database('inventory.sqlite');

const models = db.prepare('SELECT id, name, brand_id FROM phone_models').all();
const brands = db.prepare('SELECT id, name FROM brands').all();
const stores = db.prepare('SELECT id, name FROM stores').all();
const users = db.prepare('SELECT id, username, role FROM users').all();
const phones = db.prepare('SELECT COUNT(*) as count FROM phones').get();
const sales = db.prepare('SELECT COUNT(*) as count FROM sales').get();
const transfers = db.prepare('SELECT COUNT(*) as count FROM transfers').get();
const audits = db.prepare('SELECT COUNT(*) as count FROM audits').get();

console.log("=== COMPROBACIÓN DE VERIFICACIÓN POSTERIOR ===");
console.log(`Marcas disponibles      : ${brands.length}`);
console.log(`Modelos Base catálogo   : ${models.length}`);
console.log(`Tiendas configuradas    : ${stores.length}`);
console.log(`Usuarios activos        : ${users.length}`);
console.log(`Teléfonos en Stock      : ${phones.count}`);
console.log(`Ventas registradas      : ${sales.count}`);
console.log(`Traslados               : ${transfers.count}`);
console.log(`Auditorías              : ${audits.count}`);

db.close();

const Database = require('better-sqlite3');
const db = new Database('inventory.sqlite');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();

console.log("=== TABLAS Y REGISTROS ACTUALES ===");
for (const t of tables) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
    console.log(`${t.name.padEnd(20)}: ${count} registros`);
}

db.close();

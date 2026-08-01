const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'inventory.sqlite');
const db = new Database(dbPath);

console.log("Iniciando reseteo y limpieza de datos en Solucels Control...");

// Orden de borrado de tablas hijas a padres para evitar violación de llaves foráneas
const tablesToReset = [
    'audit_items',
    'audits',
    'warranties',
    'sales',
    'transfers',
    'phones'
];

db.transaction(() => {
    for (const table of tablesToReset) {
        const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (exists) {
            console.log(`- Limpiando tabla '${table}'...`);
            db.prepare(`DELETE FROM "${table}"`).run();
            try {
                db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(table);
            } catch (e) {
                // Ignore if sqlite_sequence doesn't exist
            }
        }
    }
})();

console.log("\nLimpiando archivos de uploads subidos (comprobantes y garantías)...");
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const dirsToClean = ['comprobantes', 'garantias', 'thumbnails'];

dirsToClean.forEach(dir => {
    const fullPath = path.join(UPLOADS_DIR, dir);
    if (fs.existsSync(fullPath)) {
        const files = fs.readdirSync(fullPath);
        let removed = 0;
        for (const file of files) {
            const filePath = path.join(fullPath, file);
            if (fs.statSync(filePath).isFile() && !file.startsWith('.')) {
                fs.unlinkSync(filePath);
                removed++;
            }
        }
        console.log(`- Limpiada carpeta '${dir}' (${removed} archivos eliminados)`);
    }
});

console.log("\nVerificando conteo de registros final:");
const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
for (const t of allTables) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
    console.log(`  ${t.name.padEnd(20)}: ${count} registros`);
}

db.close();
console.log("\n✅ Reseteo de datos completado exitosamente.");

/**
 * SCRIPT DE MIGRACIÓN - Sube inventory.sqlite a Railway
 * Ejecutar con: node migrate_to_railway.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// =============================================
// CONFIGURACIÓN — Edita estos valores
// =============================================
const RAILWAY_URL = 'PEGA_AQUI_TU_URL_DE_RAILWAY'; // ej: https://xxx.up.railway.app
const MIGRATION_SECRET = 'SLC_migrate_2026_xK9!';
const DB_FILE = path.join(__dirname, 'inventory.sqlite');
// =============================================

if (!fs.existsSync(DB_FILE)) {
    console.error('❌ No se encontró inventory.sqlite en esta carpeta.');
    process.exit(1);
}

const fileBuffer = fs.readFileSync(DB_FILE);
console.log(`📦 Base de datos lista: ${fileBuffer.length} bytes`);
console.log(`🚀 Enviando a: ${RAILWAY_URL}`);

const urlObj = new URL('/api/admin/migrate-db', RAILWAY_URL);
const client = urlObj.protocol === 'https:' ? https : http;

const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBuffer.length,
        'x-migration-secret': MIGRATION_SECRET
    }
};

const req = client.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        if (res.statusCode === 200) {
            console.log('✅ ¡MIGRACIÓN EXITOSA!');
            console.log('   El servidor Railway se está reiniciando con tus datos.');
            console.log('   Espera 10 segundos y luego inicia sesión normalmente.');
        } else {
            console.error(`❌ Error ${res.statusCode}:`, data);
        }
    });
});

req.on('error', (err) => {
    console.error('❌ Error de conexión:', err.message);
});

req.write(fileBuffer);
req.end();

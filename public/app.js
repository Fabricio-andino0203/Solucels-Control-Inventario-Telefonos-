let API_URL = '';
let currentUser = localStorage.getItem('slc_user') || '';
let state = {
    stores: [], brands: [], models: [], phones: [], transfers: [], sales: [], liquidations: [], users: [],
    currentSalePhone: null
};
let html5QrcodeScanner = null;
let currentScannerTargetId = null;

function formatDate(dateStr) {
    if (!dateStr) return '-';
    // If dateStr is just a time or partial, try to parse it safely
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strTime = String(hours).padStart(2, '0') + ':' + minutes + ' ' + ampm;
    return `${day}/${month}/${year} ${strTime}`;
}

document.addEventListener('DOMContentLoaded', () => { API_URL = `${window.location.protocol}//${window.location.host}/api`; checkAuthAndInit(); });

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar.classList.contains('open')) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
    else { sidebar.classList.add('open'); overlay.classList.add('active'); }
}

function getAuthToken() { return localStorage.getItem('slc_token'); }
function toggleAdminFeatures() {
    if (currentUser === 'admin') {
        document.getElementById('nav-users').style.display = 'flex';
    } else {
        document.getElementById('nav-users').style.display = 'none';
        if (document.getElementById('users-tab') && document.getElementById('users-tab').classList.contains('active')) switchTab('inventory-tab');
    }
}
async function checkAuthAndInit() {
    if (getAuthToken()) { document.getElementById('loginOverlay').classList.add('hidden'); toggleAdminFeatures(); await fetchAllData(); }
    else { document.getElementById('loginOverlay').classList.remove('hidden'); }
}
async function handleLogin(e) {
    e.preventDefault();
    try {
        const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        localStorage.setItem('slc_token', data.token); localStorage.setItem('slc_user', data.username); currentUser = data.username;
        document.getElementById('loginOverlay').classList.add('hidden'); showToast('Bienvenido');
        toggleAdminFeatures(); fetchAllData(); document.getElementById('loginPassword').value = '';
    } catch (err) { showToast(err.message, true); }
}
function logout() { localStorage.removeItem('slc_token'); localStorage.removeItem('slc_user'); currentUser = ''; document.getElementById('loginOverlay').classList.remove('hidden'); }

async function fetchAuth(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${getAuthToken()}`;
    const res = await fetch(url, options);
    if (res.status === 401 || res.status === 403) { logout(); throw new Error('Sesión Expirada'); }
    return res;
}

// FETCH DATA
async function fetchAllData() { await Promise.all([fetchConfig(), fetchInventory()]); fetchTransfers(); fetchSales(); fetchLiquidations(); if (currentUser === 'admin') fetchUsers(); }
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav li').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');

    const navItems = document.querySelectorAll('.nav li');
    if (tabId === 'inventory-tab') navItems[0].classList.add('active');
    if (tabId === 'sales-tab') navItems[1].classList.add('active');
    if (tabId === 'liquidations-tab') navItems[2].classList.add('active');
    if (tabId === 'transfers-tab') navItems[3].classList.add('active');
    if (tabId === 'bulk-tab') navItems[4].classList.add('active');
    if (tabId === 'promotions-tab') navItems[5].classList.add('active');
    if (tabId === 'config-tab') navItems[6].classList.add('active');
    if (tabId === 'users-tab') {
        const usersNav = document.getElementById('nav-users');
        if (usersNav) usersNav.classList.add('active');
    }

    if (window.innerWidth <= 820) toggleSidebar();
    if (tabId === 'transfers-tab') { applyTransferFilters(); document.getElementById('transfersImeiSearch').focus(); }
    else if (tabId === 'sales-tab') { fetchSales(); document.getElementById('salesImeiSearch').focus(); }
    else if (tabId === 'liquidations-tab') { fetchLiquidations(); document.getElementById('liquidationsImeiSearch').focus(); }
    else if (tabId === 'bulk-tab') { document.getElementById('bulkImeiList').focus(); }
    else if (tabId === 'promotions-tab') { fetchConfig(); renderPromotions(); }
    else if (tabId === 'users-tab') fetchUsers();
    else if (tabId === 'inventory-tab') {
        fetchAllData(); // Refresh everything correctly
    }
}
function showToast(message, isError = false) {
    const toast = document.getElementById('toast'); toast.textContent = message;
    if (isError) toast.classList.add('error'); else toast.classList.remove('error');
    toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 4000);
}
function openModal(modalId) { document.getElementById(modalId).classList.add('active'); }
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
    if (modalId === 'modelModal') {
        document.getElementById('editModelId').value = '';
        const titleEl = document.getElementById('modelModalTitle');
        if (titleEl) titleEl.innerText = 'Definir Modelo en Catálogo';
        const btn = document.getElementById('btnSaveModel');
        if (btn) btn.innerText = 'Guardar Modelo Maestro';
    }
}

async function fetchConfig() {
    try {
        const [resS, resB, resM] = await Promise.all([fetchAuth(`${API_URL}/stores`), fetchAuth(`${API_URL}/brands`), fetchAuth(`${API_URL}/models`)]);
        state.stores = await resS.json(); state.brands = await resB.json(); state.models = await resM.json();
        renderConfigStores(); renderConfigBrands(); renderConfigModels(); populateSelects();
    } catch (e) { console.error(e); }
}
async function fetchInventory() {
    try {
        const brand = document.getElementById('filterBrand').value;
        const store = document.getElementById('filterStore').value;
        const q = document.getElementById('globalSearch').value;

        const params = new URLSearchParams();
        if (brand && brand !== 'ALL') params.append('brand', brand);
        if (store && store !== 'ALL') params.append('store', store);
        if (q) params.append('q', q);

        const url = `${API_URL}/phones?${params.toString()}`;
        console.log(`[DEBUG] Fetching inventory: ${url}`);

        const res = await fetchAuth(url);
        state.phones = await res.json();
        renderPhonesTable(state.phones);
    } catch (e) { console.error('Fetch Inventory Error:', e); }
}
async function fetchTransfers(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.store && filters.store !== 'ALL') params.append('store', filters.store);
        if (filters.date_from) params.append('date_from', filters.date_from);
        if (filters.date_to) params.append('date_to', filters.date_to);
        const url = `${API_URL}/transfers${params.toString() ? '?' + params.toString() : ''}`;
        const res = await fetchAuth(url);
        state.transfers = await res.json();
        renderTransfersTable();
    } catch (e) { console.error(e); }
}
async function fetchSales() { try { const res = await fetchAuth(`${API_URL}/sales`); state.sales = await res.json(); renderSalesTable(); } catch (e) { console.error(e); } }
async function fetchLiquidations() { try { const res = await fetchAuth(`${API_URL}/liquidations`); state.liquidations = await res.json(); renderLiquidationsTable(); } catch (e) { console.error(e); } }
async function fetchUsers() { try { const res = await fetchAuth(`${API_URL}/users`); state.users = await res.json(); renderUsers(); } catch (e) { console.error(e); } }

// RENDER UI
function renderConfigStores() { document.getElementById('storesList').innerHTML = state.stores.map(s => `<li>${s.name} <button class="btn-icon text-danger" onclick="deleteConfig('stores', ${s.id})"><i class="fas fa-trash"></i></button></li>`).join(''); }
function renderConfigBrands() { document.getElementById('brandsList').innerHTML = state.brands.map(b => `<li>${b.name} <button class="btn-icon text-danger" onclick="deleteConfig('brands', ${b.id})"><i class="fas fa-trash"></i></button></li>`).join(''); }
function renderConfigModels() {
    const specsBadge = (ram, storage) => {
        const r = ram || null;
        const s = storage || null;
        if (!r && !s) return `<span style="color:var(--text-muted); font-size:0.8rem;">N/A (Sin specs)</span>`;
        return `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; padding:0.2rem 0.6rem; border-radius:1rem; font-size:0.82rem; font-weight:600; white-space:nowrap;"><i class="fas fa-microchip" style="margin-right:0.3rem;"></i>${r || 'N/A'} / <i class="fas fa-hdd" style="margin:0 0.3rem;"></i>${s || 'N/A'}</span>`;
    };
    document.querySelector('#modelsTable thead tr').innerHTML = `<th>Marca</th><th>Modelo Master</th><th>Especificaciones</th><th>Precios Oficiales</th><th>Mayorista / Desc.</th><th class="text-right">Acciones</th>`;
    document.querySelector('#modelsTable tbody').innerHTML = state.models.map(m => `
        <tr><td data-label="Marca">${m.brand_name}</td>
        <td data-label="Modelo Master">
            <div style="font-weight:700; color:#fff;">${m.name}</div>
        </td>
        <td data-label="Especificaciones">${specsBadge(m.ram, m.storage)}</td>
        <td data-label="Precios Oficiales">
            Contado: L. ${m.price_cash.toLocaleString('en-US')}<br>
            <small>${m.credit_enabled ? 'Crédito: L. ' + m.price_credit.toLocaleString('en-US') : 'Sin crédito'}</small>
            ${m.offer_price ? `<br><span class="badge badge-success">Oferta: L. ${m.offer_price.toLocaleString('en-US')}</span>` : ''}
        </td>
        <td data-label="Mayorista / Desc.">
            M: L. ${(m.price_wholesale || 0).toLocaleString('en-US')}<br>
            <small>Desc. Máx: L. ${(m.max_discount || 0).toLocaleString('en-US')}</small>
        </td>
        <td data-label="Acciones" class="actions-cell text-right">
            <button class="btn-icon text-primary" onclick="openEditModelModal(${m.id})" title="Editar"><i class="fas fa-pencil-alt"></i></button>
            <button class="btn-icon text-danger" onclick="deleteConfig('models', ${m.id})" title="Eliminar"><i class="fas fa-trash"></i></button>
        </td></tr>
    `).join('');
}

function populateSelects() {
    const s_filterStore = document.getElementById('filterStore').value;
    const s_filterBrand = document.getElementById('filterBrand').value;

    const storeOptions = '<option value="">Seleccione Tienda...</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.getElementById('phoneStore').innerHTML = storeOptions;
    document.getElementById('transferToStore').innerHTML = storeOptions;
    document.getElementById('saleStore').innerHTML = storeOptions;
    document.getElementById('filterStore').innerHTML = '<option value="ALL">Todas las tiendas</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    document.getElementById('filterBrand').innerHTML = '<option value="ALL">Todas las marcas</option>' + state.brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    document.getElementById('newModelBrand').innerHTML = '<option value="">Marca...</option>' + state.brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

    // Populate transfer store filter
    const tfStoreFilter = document.getElementById('transferFilterStore');
    if (tfStoreFilter) {
        const tfCurrent = tfStoreFilter.value;
        tfStoreFilter.innerHTML = '<option value="ALL">Todas las tiendas destino</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        if (tfCurrent) tfStoreFilter.value = tfCurrent;
    }

    // Restore selections
    if (s_filterStore) document.getElementById('filterStore').value = s_filterStore;
    if (s_filterBrand) document.getElementById('filterBrand').value = s_filterBrand;

    let modelOptions = '<option value="">Modelos Oficiales Solucels Control...</option>';
    state.brands.forEach(b => {
        const mx = state.models.filter(m => m.brand_id === b.id);
        if (mx.length > 0) {
            modelOptions += `<optgroup label="${b.name}">`;
            mx.forEach(m => {
                modelOptions += `<option value="${m.id}">${m.name} (${m.ram} / ${m.storage})</option>`;
            });
            modelOptions += `</optgroup>`;
        }
    });
    document.getElementById('phoneModel').innerHTML = modelOptions;

    // Populate bulk selects (same options)
    const bModel = document.getElementById('bulkModel');
    const bStore = document.getElementById('bulkStore');
    if (bModel) bModel.innerHTML = modelOptions;
    if (bStore) bStore.innerHTML = '<option value="">Seleccione Tienda...</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

    // IMEI counter for bulk textarea
    const bulkTextarea = document.getElementById('bulkImeiList');
    if (bulkTextarea && !bulkTextarea._hasListener) {
        bulkTextarea._hasListener = true;
        bulkTextarea.addEventListener('input', () => {
            const lines = (bulkTextarea.value || '').split('\n').filter(l => l.trim().length > 0);
            const countDisplay = document.getElementById('bulkImeiCount');
            if (countDisplay) countDisplay.textContent = `${lines.length} IMEI${lines.length !== 1 ? 's' : ''} detectado${lines.length !== 1 ? 's' : ''}`;
        });
    }
}

function filterInventory() {
    fetchInventory();
}
function renderPhonesTable(phonesData) {
    const tbody = document.querySelector('#phonesTable tbody');
    const statPhones = document.getElementById('stat-total-phones');
    const statValue = document.getElementById('stat-total-value');

    if (phonesData.length === 0) {
        if (statPhones) statPhones.innerText = '0';
        if (statValue) statValue.innerText = '0.00';
        return tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay equipos físicos en esta vista</td></tr>';
    }

    let totalVal = 0;
    tbody.innerHTML = phonesData.map(p => {
        totalVal += (p.price_cash || 0);

        let priceStr = `Cont: L. ${p.price_cash.toLocaleString('en-US')}`;
        if (p.price_wholesale) priceStr += `<br><small style="color:var(--success)">May: L. ${p.price_wholesale.toLocaleString('en-US')}</small>`;
        if (p.credit_enabled && p.price_credit) {
            priceStr += `<br><small style="color:var(--text-muted)">Cred: L. ${p.price_credit.toLocaleString('en-US')}</small>`;
        } else {
            priceStr += `<br><small style="color:var(--text-muted)">Sin Crédito</small>`;
        }

        return `<tr>
            <td class="img-cell" data-label="Img"><img src="${p.image_url || 'https://via.placeholder.com/150/1f2937/fff?text=' + encodeURIComponent(p.brand_name)}" class="tbl-img"></td>
            <td data-label="Marca / Modelo"><small style="color:var(--text-muted);">${p.brand_name}</small><br><strong>${p.model_name}</strong><br><small style="color:var(--text-primary)"><i class="fas fa-microchip"></i> ${p.ram || 'N/A'} | <i class="fas fa-hdd"></i> ${p.storage || 'N/A'}</small></td>
            <td data-label="IMEI / S/N"><span style="font-family:monospace">${p.imei}</span></td>
            <td data-label="Catálogo Maestro">${priceStr}</td>
            <td data-label="Ubicación">${p.store_name}</td>
            <td data-label="Estado"><span class="badge badge-success">${p.status}</span></td>
            <td class="actions-cell" data-label="Acciones">
                <div class="td-actions">
                    <button class="btn-icon text-success" title="Vender" onclick="openSaleModal(${p.id})"><i class="fas fa-shopping-cart"></i></button>
                    <button class="btn-icon" title="Trasladar" onclick="openTransferModal(${p.id})"><i class="fas fa-truck"></i></button>
                    <button class="btn-icon text-danger" title="Eliminar" onclick="deletePhone(${p.id})"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`
    }).join('');

    if (statPhones) statPhones.innerText = phonesData.length;
    if (statValue) statValue.innerText = totalVal.toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function renderTransfersTable() {
    const tbody = document.querySelector('#transfersTable tbody');
    
    // Populate store filter dropdown
    const storeFilter = document.getElementById('transferFilterStore');
    if (storeFilter && state.stores.length) {
        const currentVal = storeFilter.value;
        storeFilter.innerHTML = '<option value="ALL">Todas las tiendas destino</option>' + 
            state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        storeFilter.value = currentVal || 'ALL';
    }

    // Stats badge
    const badge = document.getElementById('transfer-stats-badge');
    if (badge) {
        badge.textContent = state.transfers.length > 0
            ? `${state.transfers.length} traslado${state.transfers.length !== 1 ? 's' : ''} encontrado${state.transfers.length !== 1 ? 's' : ''}`
            : '';
    }

    if (!state.transfers.length) return tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay traslados para los filtros seleccionados</td></tr>';
    tbody.innerHTML = state.transfers.map(t => `
        <tr>
            <td data-label="Fecha">${formatDate(t.transfer_date)}</td>
            <td data-label="Equipo"><strong>${t.model_name}</strong><br><small style="color:var(--text-primary)">${t.ram || 'N/A'} / ${t.storage || 'N/A'}</small></td>
            <td data-label="IMEI / S/N"><span style="font-family:monospace">${t.imei}</span></td>
            <td data-label="Tienda Origen"><span class="badge badge-warning">${t.from_store}</span></td>
            <td data-label="Tienda Destino (Recibe)"><span class="badge badge-success">${t.to_store}</span></td>
        </tr>`).join('');
}

function applyTransferFilters() {
    const store = document.getElementById('transferFilterStore')?.value || 'ALL';
    const date_from = document.getElementById('transferFilterDateFrom')?.value || '';
    const date_to = document.getElementById('transferFilterDateTo')?.value || '';
    fetchTransfers({ store, date_from, date_to });
}

function clearTransferFilters() {
    const storeFilter = document.getElementById('transferFilterStore');
    const dateFrom = document.getElementById('transferFilterDateFrom');
    const dateTo = document.getElementById('transferFilterDateTo');
    if (storeFilter) storeFilter.value = 'ALL';
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    fetchTransfers();
}

function generateTransfersPDF() {
    if (!state.transfers.length) {
        showToast('No hay traslados para generar el reporte. Aplique filtros primero.', true);
        return;
    }

    const storeFilter = document.getElementById('transferFilterStore');
    const dateFrom = document.getElementById('transferFilterDateFrom')?.value || '';
    const dateTo = document.getElementById('transferFilterDateTo')?.value || '';
    const storeText = storeFilter?.options[storeFilter.selectedIndex]?.text || 'Todas las tiendas';
    const logoUrl = `${window.location.protocol}//${window.location.host}/assets/images/branding/logo_solucels.png`;

    let periodText = 'Todos los periodos';
    if (dateFrom && dateTo) periodText = `${dateFrom} al ${dateTo}`;
    else if (dateFrom) periodText = `Desde ${dateFrom}`;
    else if (dateTo) periodText = `Hasta ${dateTo}`;

    // Agrupar por tienda destino
    const byStore = {};
    state.transfers.forEach(t => {
        const key = t.to_store;
        if (!byStore[key]) byStore[key] = [];
        byStore[key].push(t);
    });

    const genDate = new Date().toLocaleDateString('es-HN', { day:'2-digit', month:'2-digit', year:'numeric' });
    const genTime = new Date().toLocaleTimeString('es-HN', { hour:'2-digit', minute:'2-digit', hour12:true });

    // Secciones por tienda — estilo factura termica profesional
    const storeRows = Object.entries(byStore).map(([store, items]) => `
        <div class="store-section">
            <div class="store-bar">${store.toUpperCase()}</div>
            <div class="store-sub">${items.length} equipo${items.length !== 1 ? 's' : ''} recibido${items.length !== 1 ? 's' : ''}</div>
            <table class="items-table">
                <thead>
                    <tr>
                        <th class="c-num">#</th>
                        <th class="c-model">Marca / Modelo / Especificaciones</th>
                        <th class="c-imei">IMEI / S-N</th>
                        <th class="c-orig">Origen</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((t, i) => `
                    <tr>
                        <td class="c-num td-c">${String(i+1).padStart(2,'0')}</td>
                        <td class="c-model">
                            <strong>${(t.brand_name || '').toUpperCase()}</strong><br>
                            ${t.model_name}<br>
                            <span class="spec">${t.ram || '--'} / ${t.storage || '--'}</span>
                        </td>
                        <td class="c-imei">${t.imei}</td>
                        <td class="c-orig">${t.from_store}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div class="store-footer">
                <span>No. Equipos:</span> <strong>${items.length}</strong>
            </div>
        </div>
    `).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Traslados - ${storeText}</title>
    <style>
        @page { size: 80mm auto; margin: 5mm 4mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 9pt;
            color: #000;
            background: #fff;
            width: 72mm;
            margin: 0 auto;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* ═══ LOGO ═══ */
        .logo-wrap { text-align: center; margin-bottom: 3px; }
        .logo-wrap img {
            display: block;
            margin: 0 auto;
            max-width: 44mm;
            max-height: 18mm;
            filter: invert(1) brightness(0);
            -webkit-filter: invert(1) brightness(0);
        }

        /* ═══ ENCABEZADO ═══ */
        .rh {
            text-align: center;
            padding-bottom: 6px;
            margin-bottom: 4px;
            border-bottom: 2px solid #000;
        }
        .company  { font-size: 13pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
        .subtitle { font-size: 9pt; font-weight: 700; margin-top: 2px; }
        .gen-date { font-size: 8.5pt; margin-top: 3px; }

        /* ═══ SEPARADORES ═══ */
        .sep-solid  { border-top: 2px solid #000; margin: 5px 0; }
        .sep-light  { border-top: 1px solid #000; margin: 4px 0; }
        .sep-dashed { border-top: 1px dashed #000; margin: 4px 0; }

        /* ═══ INFO META ═══ */
        .info-row {
            display: table;
            width: 100%;
            font-size: 8.5pt;
            padding: 2px 0;
            line-height: 1.6;
        }
        .info-label { display: table-cell; font-weight: 700; width: 30mm; }
        .info-value { display: table-cell; text-align: right; }

        /* ═══ BARRA TOTAL GENERAL ═══ */
        .grand-total-bar {
            background: #000;
            color: #fff;
            font-size: 11pt;
            font-weight: 900;
            text-align: center;
            padding: 5px 0;
            margin: 6px 0;
            letter-spacing: 1px;
        }

        /* ═══ TIENDA ═══ */
        .store-section { margin-bottom: 8px; }
        .store-bar {
            background: #000;
            color: #fff;
            font-size: 10pt;
            font-weight: 900;
            text-align: center;
            padding: 4px 2px;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
        }
        .store-sub {
            font-size: 8pt;
            text-align: center;
            font-style: italic;
            margin-bottom: 3px;
        }

        /* ═══ TABLA DE EQUIPOS ═══ */
        .items-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8pt;
            margin: 2px 0;
            text-align: left;
        }
        .items-table th {
            font-size: 7.5pt;
            font-weight: 900;
            text-transform: uppercase;
            padding: 3px 2px;
            border-top: 1.5px solid #000;
            border-bottom: 1.5px solid #000;
            letter-spacing: 0.2px;
            background: #f0f0f0;
        }
        .items-table td {
            padding: 3px 2px;
            vertical-align: top;
            border-bottom: 1px solid #ccc;
            font-size: 8pt;
            line-height: 1.5;
        }
        .items-table tr:last-child td { border-bottom: 1.5px solid #000; }

        .c-num  { width: 7mm;  text-align: center; }
        .c-model{ width: 23mm; }
        .c-imei { width: 26mm; font-family: 'Courier New', Courier, monospace; font-size: 8pt; font-weight: 700; word-break: break-all; letter-spacing: 0px; }
        .c-orig { width: 16mm; font-size: 7.5pt; }
        .td-c   { text-align: center; font-weight: 700; font-size: 9pt; }
        .spec   { font-size: 7.5pt; color: #222; }

        /* ═══ PIE DE TIENDA ═══ */
        .store-footer {
            font-size: 8.5pt;
            text-align: right;
            padding: 3px 0;
        }

        /* ═══ PIE GENERAL ═══ */
        .receipt-footer {
            font-size: 8pt;
            text-align: center;
            line-height: 1.8;
            padding-top: 5px;
            margin-top: 4px;
        }

        @media print {
            body { width: 72mm; }
            @page { size: 80mm auto; margin: 5mm 4mm; }
        }
    </style>
</head>
<body>

    <!-- ENCABEZADO -->
    <div class="rh">
        <div class="logo-wrap">
            <img src="${logoUrl}" alt="Solucels" onerror="this.style.display='none'">
        </div>
        <div class="company">Solucels Control</div>
        <div class="subtitle">Reporte de Traslados</div>
        <div class="gen-date">${genDate} &nbsp;|&nbsp; ${genTime}</div>
    </div>

    <!-- META -->
    <div class="info-row"><span class="info-label">Tienda:</span><span class="info-value">${storeText.toUpperCase()}</span></div>
    <div class="info-row"><span class="info-label">Periodo:</span><span class="info-value">${periodText}</span></div>

    <!-- TOTAL -->
    <div class="grand-total-bar">TOTAL: ${state.transfers.length} EQUIPO${state.transfers.length !== 1 ? 'S' : ''}</div>

    <!-- SECCIONES POR TIENDA -->
    ${storeRows}

    <!-- PIE -->
    <div class="sep-solid"></div>
    <div class="receipt-footer">
        <strong>SOLUCELS CONTROL</strong><br>
        Sistema de Inventario de Telefonos<br>
        *** DOCUMENTO INTERNO ***
    </div>

</body>
</html>`;

    let printFrame = document.getElementById('printFrame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'printFrame';
        printFrame.style.cssText = 'position:absolute;width:0;height:0;border:none;';
        document.body.appendChild(printFrame);
    }
    showToast('Generando Recibo 80mm...');
    const doc = printFrame.contentWindow.document;
    doc.open(); doc.write(htmlContent); doc.close();
    setTimeout(() => { printFrame.contentWindow.focus(); printFrame.contentWindow.print(); }, 700);
}

function generateTransfersPDF52mm() {
    if (!state.transfers.length) {
        showToast('No hay traslados para generar el reporte. Aplique filtros primero.', true);
        return;
    }

    const storeFilter = document.getElementById('transferFilterStore');
    const dateFrom = document.getElementById('transferFilterDateFrom')?.value || '';
    const dateTo = document.getElementById('transferFilterDateTo')?.value || '';
    const storeText = storeFilter?.options[storeFilter.selectedIndex]?.text || 'Todas las tiendas';
    const logoUrl = `${window.location.protocol}//${window.location.host}/assets/images/branding/logo_solucels.png`;

    let periodText = 'Todos los periodos';
    if (dateFrom && dateTo) periodText = `${dateFrom} al ${dateTo}`;
    else if (dateFrom) periodText = `Desde ${dateFrom}`;
    else if (dateTo) periodText = `Hasta ${dateTo}`;

    // Agrupar por tienda destino
    const byStore = {};
    state.transfers.forEach(t => {
        const key = t.to_store;
        if (!byStore[key]) byStore[key] = [];
        byStore[key].push(t);
    });

    const genDate = new Date().toLocaleDateString('es-HN', { day:'2-digit', month:'2-digit', year:'numeric' });
    const genTime = new Date().toLocaleTimeString('es-HN', { hour:'2-digit', minute:'2-digit', hour12:true });

    // Secciones por tienda — estilo factura termica profesional, optimizado para 52mm
    const storeRows = Object.entries(byStore).map(([store, items]) => `
        <div class="store-section">
            <div class="store-bar">${store.toUpperCase()}</div>
            <div class="store-sub">${items.length} equipo${items.length !== 1 ? 's' : ''} recibido${items.length !== 1 ? 's' : ''}</div>
            <div class="items-list">
                ${items.map((t, i) => `
                <div class="item-card">
                    <div class="item-header">
                        <span class="item-num">#${String(i+1).padStart(2,'0')}</span>
                        <span class="item-model"><strong>${(t.brand_name || '').toUpperCase()}</strong> ${t.model_name}</span>
                    </div>
                    <div class="item-specs">${t.ram || '--'} / ${t.storage || '--'}</div>
                    <div class="item-details">
                        <div class="detail-row"><span class="lbl">IMEI:</span> <span class="val imei">${t.imei}</span></div>
                        <div class="detail-row"><span class="lbl">Origen:</span> <span class="val orig">${t.from_store}</span></div>
                    </div>
                </div>`).join('')}
            </div>
            <div class="store-footer">
                <span>Total equipos:</span> <strong>${items.length}</strong>
            </div>
        </div>
    `).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Traslados - ${storeText}</title>
    <style>
        @page { size: 52mm auto; margin: 2mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 8.5pt;
            color: #000;
            background: #fff;
            width: 48mm;
            margin: 0 auto;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* ═══ LOGO ═══ */
        .logo-wrap { text-align: center; margin-bottom: 3px; }
        .logo-wrap img {
            display: block;
            margin: 0 auto;
            max-width: 38mm;
            max-height: 16mm;
            filter: invert(1) brightness(0);
            -webkit-filter: invert(1) brightness(0);
        }

        /* ═══ ENCABEZADO ═══ */
        .rh {
            text-align: center;
            padding-bottom: 4px;
            margin-bottom: 4px;
            border-bottom: 1.5px solid #000;
        }
        .company  { font-size: 11pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
        .subtitle { font-size: 8.5pt; font-weight: 700; margin-top: 2px; }
        .gen-date { font-size: 7.5pt; margin-top: 2px; }

        /* ═══ SEPARADORES ═══ */
        .sep-solid  { border-top: 1.5px solid #000; margin: 4px 0; }
        .sep-light  { border-top: 1px solid #000; margin: 3px 0; }
        .sep-dashed { border-top: 1px dashed #000; margin: 3px 0; }

        /* ═══ INFO META ═══ */
        .info-row {
            display: flex;
            justify-content: space-between;
            font-size: 8pt;
            padding: 1px 0;
            line-height: 1.4;
        }
        .info-label { font-weight: 700; }
        .info-value { text-align: right; }

        /* ═══ BARRA TOTAL GENERAL ═══ */
        .grand-total-bar {
            background: #000;
            color: #fff;
            font-size: 9pt;
            font-weight: 900;
            text-align: center;
            padding: 4px 0;
            margin: 5px 0;
            letter-spacing: 0.5px;
        }

        /* ═══ TIENDA ═══ */
        .store-section { margin-bottom: 6px; }
        .store-bar {
            background: #000;
            color: #fff;
            font-size: 8.5pt;
            font-weight: 900;
            text-align: center;
            padding: 3px 1px;
            margin-bottom: 2px;
        }
        .store-sub {
            font-size: 7.5pt;
            text-align: center;
            font-style: italic;
            margin-bottom: 3px;
        }

        /* ═══ LISTA DE EQUIPOS (APILADA PARA 52mm) ═══ */
        .items-list {
            margin: 3px 0;
        }
        .item-card {
            border-bottom: 1px solid #ccc;
            padding: 4px 0;
            margin-bottom: 2px;
        }
        .item-card:last-child {
            border-bottom: 1.5px solid #000;
        }
        .item-header {
            display: flex;
            align-items: flex-start;
            font-size: 8.5pt;
            margin-bottom: 2px;
        }
        .item-num {
            font-weight: 900;
            margin-right: 4px;
            min-width: 16px;
        }
        .item-model {
            flex: 1;
            line-height: 1.2;
        }
        .item-specs {
            font-size: 7.5pt;
            color: #333;
            margin-left: 20px; /* alineado con modelo */
            margin-bottom: 3px;
        }
        .item-details {
            font-size: 7.5pt;
            margin-left: 20px; /* alineado con modelo */
            line-height: 1.3;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
        }
        .lbl { font-weight: 700; }
        .val { text-align: right; }
        .imei { font-family: 'Courier New', Courier, monospace; font-size: 8.5pt; font-weight: 700; letter-spacing: -0.5px; }
        .orig { font-size: 7.5pt; }

        /* ═══ PIE DE TIENDA ═══ */
        .store-footer {
            font-size: 8.5pt;
            text-align: right;
            padding: 3px 0;
        }

        /* ═══ PIE GENERAL ═══ */
        .receipt-footer {
            font-size: 7.5pt;
            text-align: center;
            line-height: 1.6;
            padding-top: 4px;
            margin-top: 3px;
        }

        @media print {
            body { width: 48mm; }
            @page { size: 52mm auto; margin: 2mm; }
        }
    </style>
</head>
<body>

    <!-- ENCABEZADO -->
    <div class="rh">
        <div class="logo-wrap">
            <img src="${logoUrl}" alt="Solucels" onerror="this.style.display='none'">
        </div>
        <div class="company">Solucels Control</div>
        <div class="subtitle">Reporte de Traslados</div>
        <div class="gen-date">${genDate} &nbsp;|&nbsp; ${genTime}</div>
    </div>

    <!-- META -->
    <div class="info-row"><span class="info-label">Tienda:</span><span class="info-value">${storeText.toUpperCase()}</span></div>
    <div class="info-row"><span class="info-label">Periodo:</span><span class="info-value">${periodText}</span></div>

    <!-- TOTAL -->
    <div class="grand-total-bar">TOTAL: ${state.transfers.length} EQUIPO${state.transfers.length !== 1 ? 'S' : ''}</div>

    <!-- SECCIONES POR TIENDA -->
    ${storeRows}

    <!-- PIE -->
    <div class="sep-solid"></div>
    <div class="receipt-footer">
        <strong>SOLUCELS CONTROL</strong><br>
        Sistema de Inventario<br>
        *** DOC INTERNO ***
    </div>

</body>
</html>`;

    let printFrame = document.getElementById('printFrame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'printFrame';
        printFrame.style.cssText = 'position:absolute;width:0;height:0;border:none;';
        document.body.appendChild(printFrame);
    }
    showToast('Generando Recibo 52mm...');
    const doc = printFrame.contentWindow.document;
    doc.open(); doc.write(htmlContent); doc.close();
    setTimeout(() => { printFrame.contentWindow.focus(); printFrame.contentWindow.print(); }, 700);
}
function renderSalesTable() {
    const filterType = document.getElementById('salesTypeFilter') ? document.getElementById('salesTypeFilter').value : 'ALL';
    let dataToRender = state.sales;

    if (filterType !== 'ALL') {
        dataToRender = dataToRender.filter(s => {
            if (filterType === 'Mayorista') return s.final_price_type === 'Mayorista';
            if (filterType === 'Crédito') return s.sale_type === 'Crédito' || s.final_price_type === 'Crédito';
            if (filterType === 'Contado') return (s.sale_type === 'Contado' && s.final_price_type !== 'Mayorista');
            return true;
        });
    }

    const tbody = document.querySelector('#salesTable tbody');
    if (!dataToRender.length) return tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay ventas registradas en este filtro</td></tr>';
    
    let totalSales = 0;
    tbody.innerHTML = dataToRender.map(s => {
        totalSales += s.final_price;
        return `<tr><td data-label="Fecha">${formatDate(s.sale_date)}</td><td data-label="Equipo"><strong>${s.model_name}</strong><br><small style="color:var(--text-primary)">${s.ram || 'N/A'} / ${s.storage || 'N/A'}</small><br><small style="font-family:monospace">${s.imei}</small></td><td data-label="Tienda Venta">${s.store_name}</td><td data-label="Tipo"><span class="badge ${s.sale_type === 'Contado' ? 'badge-success' : 'badge-warning'}">${s.final_price_type || s.sale_type}</span></td><td data-label="Notas"><span style="font-size:0.85rem; color:var(--text-muted);">${s.notes || '-'}</span></td><td data-label="Precio (L.)" style="color:var(--success); font-weight:bold;">L. ${s.final_price.toLocaleString('en-US')}</td></tr>`
    }).join('');
    
    document.getElementById('stat-total-sales').innerText = totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function filterSalesView() {
    renderSalesTable();
}
function calculateLiquidationDate(dateStr) {
    const d = new Date(dateStr);
    if(isNaN(d.getTime())) return null;
    let day = d.getDay();
    let advanceDays = 0;
    if (day >= 1 && day <= 3) { advanceDays = 5 - day; } 
    else {
        if (day === 0) advanceDays = 2;
        else advanceDays = (7 - day) + 2;
    }
    d.setDate(d.getDate() + advanceDays);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const txt = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][d.getDay()];
    return `${txt} ${dd}/${m}`;
}

function renderLiquidationsTable(data) {
    const tbody = document.querySelector('#liquidationsTable tbody');
    const items = data || state.liquidations;
    const filterSelect = document.getElementById('liquidationDateFilter');
    const cardsContainer = document.getElementById('liquidation-date-cards');

    if (!items.length) {
        if (cardsContainer) cardsContainer.innerHTML = '';
        if (filterSelect && !data) {
            filterSelect.innerHTML = '<option value="ALL">Todas las Fechas de Pago</option>';
        }
        document.getElementById('stat-total-liquidations').innerText = '0.00';
        return tbody.innerHTML = '<tr><td colspan="7">No hay liquidaciones pendientes</td></tr>';
    }

    // Build groups by payment date
    const dateGroups = {};
    const allItems = state.liquidations; // always use full list for groups

    allItems.forEach(s => {
        const payDate = calculateLiquidationDate(s.sale_date) || 'Sin Fecha';
        if (!dateGroups[payDate]) dateGroups[payDate] = { items: [], total: 0 };
        dateGroups[payDate].items.push(s);
        dateGroups[payDate].total += s.saldo;
    });

    // Sort dates chronologically
    const sortedDates = Object.keys(dateGroups).sort((a, b) => {
        const parsePayDate = (str) => {
            const match = str.match(/(\d{2})\/(\d{2})/);
            if (!match) return 99999;
            return parseInt(match[2]) * 100 + parseInt(match[1]); // month*100 + day
        };
        return parsePayDate(a) - parsePayDate(b);
    });

    // Populate filter dropdown (only when rendering full list)
    if (!data && filterSelect) {
        const currentValue = filterSelect.value;
        filterSelect.innerHTML = '<option value="ALL">📅 Todas las Fechas de Pago</option>';
        sortedDates.forEach(date => {
            const count = dateGroups[date].items.length;
            const total = dateGroups[date].total;
            filterSelect.innerHTML += `<option value="${date}">📌 ${date} — ${count} equipo${count !== 1 ? 's' : ''} — L. ${total.toLocaleString('en-US', {minimumFractionDigits:2})}</option>`;
        });
        filterSelect.value = currentValue || 'ALL';
    }

    // Render stat cards per date
    if (cardsContainer) {
        // Determine which colors to use for cards
        const cardColors = [
            { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24', icon: 'fa-calendar-check' },
            { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.3)', color: '#60a5fa', icon: 'fa-calendar-day' },
            { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', color: '#34d399', icon: 'fa-calendar-week' },
            { bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.3)', color: '#a78bfa', icon: 'fa-calendar' },
            { bg: 'rgba(236, 72, 153, 0.1)', border: 'rgba(236, 72, 153, 0.3)', color: '#f472b6', icon: 'fa-calendar-alt' },
        ];

        cardsContainer.innerHTML = sortedDates.map((date, i) => {
            const group = dateGroups[date];
            const c = cardColors[i % cardColors.length];
            const isActive = filterSelect && filterSelect.value === date;
            return `<div class="stat-card" style="padding: 0.75rem 1rem; cursor: pointer; min-width: 200px; flex: 1; max-width: 280px; transition: all 0.2s; border: 2px solid ${isActive ? c.color : 'transparent'}; ${isActive ? 'box-shadow: 0 0 15px ' + c.bg + ';' : ''}" onclick="document.getElementById('liquidationDateFilter').value='${date}'; filterLiquidationsView();">
                <div class="stat-icon" style="width:2.5rem; height:2.5rem; font-size:1rem; background:${c.bg}; color:${c.color}; border-color:${c.border};"><i class="fas ${c.icon}"></i></div>
                <div class="stat-info">
                    <h3 style="font-size:0.75rem; white-space:nowrap;">📌 ${date}</h3>
                    <p style="font-size:1.1rem; color:${c.color}; line-height:1.2;">L. ${group.total.toLocaleString('en-US', {minimumFractionDigits:2})}</p>
                    <small style="color:var(--text-muted); font-size:0.7rem;">${group.items.length} equipo${group.items.length !== 1 ? 's' : ''}</small>
                </div>
            </div>`;
        }).join('');
    }

    // Render table rows (with date group headers if showing ALL)
    const selectedFilter = filterSelect ? filterSelect.value : 'ALL';
    let displayItems = items;
    let liquidationsTotal = 0;

    if (selectedFilter === 'ALL' && !data) {
        // Group display with section headers
        let html = '';
        sortedDates.forEach(date => {
            const group = dateGroups[date];
            html += `<tr class="liquidation-date-header"><td colspan="7" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(59, 130, 246, 0.1)); border-left: 4px solid var(--primary); padding: 0.75rem 1rem; font-weight: 700; color: #fff; font-size: 0.95rem;">
                <i class="fas fa-calendar-check" style="color:var(--primary); margin-right:0.5rem;"></i> Pago: ${date}
                <span style="float:right; color:#fbbf24; font-weight:800;">Total: L. ${group.total.toLocaleString('en-US', {minimumFractionDigits:2})} <small style="color:var(--text-muted); font-weight:400;">(${group.items.length} equipo${group.items.length !== 1 ? 's' : ''})</small></span>
            </td></tr>`;
            group.items.forEach(s => {
                liquidationsTotal += s.saldo;
                html += buildLiquidationRow(s);
            });
        });
        tbody.innerHTML = html;
    } else {
        // Filtered or search view
        displayItems.forEach(s => { liquidationsTotal += s.saldo; });
        tbody.innerHTML = displayItems.map(s => buildLiquidationRow(s)).join('');
    }

    document.getElementById('stat-total-liquidations').innerText = liquidationsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function buildLiquidationRow(s) {
    return `<tr><td data-label="Fecha">${formatDate(s.sale_date)}<br><small style="color:var(--danger); font-weight:bold;"><i class="fas fa-calendar-check"></i> Pago: ${calculateLiquidationDate(s.sale_date) || '-'}</small></td><td data-label="Equipo"><strong>${s.model_name}</strong><br><small style="color:var(--text-primary)">${s.ram || 'N/A'} / ${s.storage || 'N/A'}</small><br><small>${s.imei}</small></td><td data-label="Tienda">${s.store_name}</td><td data-label="Precio Crédito">L. ${s.final_price.toLocaleString('en-US')}</td><td data-label="Prima">L. ${s.prima.toLocaleString('en-US')}</td><td data-label="Saldo" style="color:#fbbf24; font-weight:bold;">L. ${s.saldo.toLocaleString('en-US')}</td><td data-label="Acción" class="actions-cell text-right"><button class="btn btn-primary" style="background:var(--success)" onclick="markAsPaid(${s.id})"><i class="fas fa-check-double"></i></button></td></tr>`;
}

function filterLiquidationsView() {
    const filterVal = document.getElementById('liquidationDateFilter').value;
    if (filterVal === 'ALL') {
        renderLiquidationsTable();
    } else {
        const filtered = state.liquidations.filter(s => {
            const payDate = calculateLiquidationDate(s.sale_date) || 'Sin Fecha';
            return payDate === filterVal;
        });
        renderLiquidationsTable(filtered);
    }
}

// CONFIG / MASTER MODELS
function toggleModelCreditInputs() {
    const isEn = document.getElementById('newModelCreditEn').value === '1';
    const cont = document.getElementById('newModelCreditContainer');
    const input = document.getElementById('newModelCredit');
    if (isEn) {
        cont.style.opacity = '1';
        cont.style.pointerEvents = 'auto';
        input.setAttribute('required', 'true');
        input.classList.add('highlight-field');
    } else {
        cont.style.opacity = '0.3';
        cont.style.pointerEvents = 'none';
        input.removeAttribute('required');
        input.classList.remove('highlight-field');
        input.value = '';
    }
}

async function addStore(e) { e.preventDefault(); await genericPost('stores', { name: document.getElementById('newStoreName').value }); return false; }
async function addBrand(e) { e.preventDefault(); await genericPost('brands', { name: document.getElementById('newBrandName').value }); return false; }
async function addModel(e) {
    e.preventDefault();
    const editId = document.getElementById('editModelId').value;
    const ramVal = document.getElementById('newModelRam').value.trim();
    const storageVal = document.getElementById('newModelStorage').value.trim();

    // Auto GB suffix logic (Robust)
    const formatMem = (val) => {
        if (!val) return null;
        let s = val.toString().trim().toUpperCase();
        if (!s.includes('GB') && !s.includes('TB')) {
            if (/^\d+(\.\d+)?$/.test(s)) return s + ' GB';
        }
        return s;
    };

    const payload = {
        name: document.getElementById('newModelName').value,
        brand_id: document.getElementById('newModelBrand').value,
        image_url: document.getElementById('newModelImage').value,
        ram: formatMem(ramVal),
        storage: formatMem(storageVal),
        price_cost: parseFloat(document.getElementById('newModelCostPrice').value) || 0,
        price_cash: parseFloat(document.getElementById('newModelCash').value),
        price_wholesale: parseFloat(document.getElementById('newModelWholesale').value) || 0,
        max_discount: parseFloat(document.getElementById('newModelMaxDiscount').value) || 0,
        credit_enabled: document.getElementById('newModelCreditEn').value === '1',
        price_credit: parseFloat(document.getElementById('newModelCredit').value) || 0
    };

    // Validation
    if (payload.credit_enabled && (!payload.price_credit || payload.price_credit <= 0)) {
        showToast('Atención: Si aplica a crédito, debe ingresar un precio mayor a 0', true);
        return false;
    }
    try {
        let res;
        if (editId) {
            res = await fetchAuth(`${API_URL}/models/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } else {
            res = await fetchAuth(`${API_URL}/models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        fetchConfig(); showToast(editId ? 'Modelo Actualizado Correctamente' : 'Modelo Maestro Guardado'); closeModal('modelModal');
    } catch (err) { showToast(err.message, true); }
    return false;
}

function openEditModelModal(id) {
    const m = state.models.find(x => x.id === id);
    if (!m) return;
    document.getElementById('editModelId').value = m.id;
    document.getElementById('newModelBrand').value = m.brand_id;
    document.getElementById('newModelName').value = m.name;
    document.getElementById('newModelImage').value = m.image_url || '';
    document.getElementById('newModelRam').value = m.ram || '';
    document.getElementById('newModelStorage').value = m.storage || '';
    const costInput = document.getElementById('newModelCostPrice');
    if(costInput) costInput.value = m.price_cost || 0;
    document.getElementById('newModelCash').value = m.price_cash;
    document.getElementById('newModelWholesale').value = m.price_wholesale || 0;
    document.getElementById('newModelMaxDiscount').value = m.max_discount || 0;
    document.getElementById('newModelCreditEn').value = m.credit_enabled ? '1' : '0';
    toggleModelCreditInputs();
    if (m.credit_enabled) document.getElementById('newModelCredit').value = m.price_credit;

    const titleEl = document.getElementById('modelModalTitle');
    if (titleEl) titleEl.innerText = 'Editar Modelo: ' + m.name;
    const btn = document.getElementById('btnSaveModel');
    if (btn) btn.innerText = 'Guardar Cambios';

    openModal('modelModal');
}
async function deleteConfig(type, id) {
    if (!confirm('¿Eliminar bloque protegido?')) return;
    try { const res = await fetchAuth(`${API_URL}/${type}/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error((await res.json()).error); fetchConfig(); } catch (err) { showToast(err.message, true); }
}
async function genericPost(type, payload) {
    try {
        const res = await fetchAuth(`${API_URL}/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error); fetchConfig(); showToast('Guardado');
    } catch (err) { showToast(err.message, true); }
}

// USER MANAGEMENT
function renderUsers() {
    const ul = document.getElementById('usersList');
    if (!ul) return;
    ul.innerHTML = state.users.map(u => `<li>${u.username} ${u.username !== 'admin' ? `<div><button class="btn-icon text-primary" onclick="editUser(${u.id}, '${u.username}')" title="Editar Nombre"><i class="fas fa-edit"></i></button><button class="btn-icon text-danger" onclick="deleteUser(${u.id})" title="Eliminar"><i class="fas fa-trash"></i></button></div>` : '<span class="badge badge-success">Admin</span>'}</li>`).join('');
}
async function editUser(id, currentUsername) {
    const newName = prompt('Ingrese el nuevo nombre de usuario:', currentUsername);
    if (!newName || newName.trim() === '' || newName === currentUsername) return;
    try {
        const res = await fetchAuth(`${API_URL}/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: newName.trim() }) });
        if (!res.ok) throw new Error((await res.json()).error);
        fetchUsers(); showToast('Nombre de usuario actualizado');
    } catch (err) { showToast(err.message, true); }
}
async function addUser(e) {
    e.preventDefault();
    try {
        const payload = { username: document.getElementById('newUsername').value, password: document.getElementById('newUserPassword').value };
        const res = await fetchAuth(`${API_URL}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error);
        fetchUsers(); showToast('Usuario Creado'); e.target.reset();
    } catch (err) { showToast(err.message, true); }
    return false;
}
async function deleteUser(id) {
    if (!confirm('¿Eliminar acceso del usuario seleccionado?')) return;
    try { const res = await fetchAuth(`${API_URL}/users/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error((await res.json()).error); fetchUsers(); } catch (err) { showToast(err.message, true); }
}
async function changeMyPassword(e) {
    e.preventDefault();
    try {
        const payload = { currentPassword: document.getElementById('currentPassword').value, newPassword: document.getElementById('newPassword').value };
        const res = await fetchAuth(`${API_URL}/users/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Su contraseña ha sido actualizada exitosamente'); e.target.reset();
    } catch (err) { showToast(err.message, true); }
    return false;
}

// ADD PHONE (QUICK FORM)
function openScanner(targetInputId) {
    currentScannerTargetId = targetInputId; document.getElementById('scannerModal').classList.add('active');
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 100 } },
        (decodedText) => { document.getElementById(currentScannerTargetId).value = decodedText.toUpperCase(); closeScanner(); showToast('Identificador Capturado'); },
        (error) => { }
    ).catch(err => { showToast("Error iniciando cámara: " + err, true); });
}
function closeScanner() {
    if (html5QrcodeScanner) { html5QrcodeScanner.stop().then(() => { html5QrcodeScanner.clear(); }).catch(e => console.error(e)); }
    document.getElementById('scannerModal').classList.remove('active');
}

async function savePhone(e) {
    e.preventDefault();
    const rawImei = document.getElementById('phoneImei').value;
    const cleanImei = rawImei.replace(/\s+/g, '').toUpperCase();
    if (!cleanImei) { showToast('El IMEI / S/N es obligatorio', true); return false; }
    const payload = { model_id: document.getElementById('phoneModel').value, imei: cleanImei, store_id: document.getElementById('phoneStore').value };
    try {
        const res = await fetchAuth(`${API_URL}/phones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Inventario Físico Guardado'); closeModal('phoneModal'); fetchInventory();
    } catch (err) { showToast(err.message, true); }
    return false;
}

async function deletePhone(id) {
    if (!confirm('¿Eliminar equipo por completo?')) return;
    try { const res = await fetchAuth(`${API_URL}/phones/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error((await res.json()).error); fetchInventory(); } catch (err) { showToast(err.message, true); }
}

// TRANSFERS & SALES
function openTransferModal(id) {
    const p = state.phones.find(x => x.id === id); document.getElementById('transferPhoneId').value = p.id;
    document.getElementById('transfModel').innerText = p.model_name; document.getElementById('transfImei').innerText = p.imei; document.getElementById('transfOrigen').innerText = p.store_name; openModal('transferModal');
}
async function saveTransfer(e) {
    e.preventDefault();
    try {
        const res = await fetchAuth(`${API_URL}/transfers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_id: document.getElementById('transferPhoneId').value, to_store_id: document.getElementById('transferToStore').value }) });
        if (!res.ok) throw new Error((await res.json()).error); showToast('Traslado completado'); closeModal('transferModal'); await fetchAllData();
    } catch (err) { showToast(err.message, true); }
    return false;
}

function openSaleModal(id) {
    const p = state.phones.find(x => x.id === id); state.currentSalePhone = p;
    document.getElementById('salePhoneId').value = p.id;
    document.getElementById('saleModel').innerText = `${p.brand_name} ${p.model_name}`;
    document.getElementById('saleImei').innerText = p.imei;
    document.getElementById('saleStore').value = p.store_id;
    document.getElementById('saleNotes').value = '';
    document.getElementById('salePrima').value = '0.00';
    document.getElementById('saleDiscount').value = '0.00';

    // Set default date to today
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    document.getElementById('saleDate').value = today;

    // Admin features
    const isAdmin = currentUser === 'admin';
    document.getElementById('adminDiscountRow').style.display = isAdmin ? 'block' : 'none';
    const hintEl = document.getElementById('maxDiscountHint');
    if (hintEl) hintEl.innerText = `Máx. permitido: L. ${(p.max_discount || 0).toLocaleString('en-US')}`;

    document.getElementById('saleOptCredit').disabled = !p.credit_enabled;

    // Auto-select "Contado" or "Oferta" if exists
    const typeSelect = document.getElementById('salePriceType');
    typeSelect.value = 'Contado';

    calculateSale();
    openModal('saleModal');
}
function calculateSale() {
    const p = state.currentSalePhone; if (!p) return;
    const finalPriceInput = document.getElementById('saleFinalPrice');
    const creditDetails = document.getElementById('saleCreditDetails');
    const saldoInput = document.getElementById('saleSaldo');
    const priceType = document.getElementById('salePriceType').value;
    const discount = parseFloat(document.getElementById('saleDiscount').value) || 0;

    let base_price = 0;

    // Rules: Offer price only applies to Contado
    if (p.offer_price && (priceType === 'Contado')) {
        base_price = p.offer_price;
    } else {
        if (priceType === 'Crédito') {
            base_price = p.price_credit || p.price_cash;
        } else if (priceType === 'Mayorista') {
            base_price = p.price_wholesale || p.price_cash;
        } else {
            base_price = p.price_cash;
        }
    }

    const total = base_price - discount;
    finalPriceInput.value = total.toFixed(2);

    if (priceType === 'Crédito') {
        creditDetails.style.display = 'flex';
        saldoInput.value = (total - (parseFloat(document.getElementById('salePrima').value) || 0)).toFixed(2);
    } else {
        creditDetails.style.display = 'none';
        document.getElementById('salePrima').value = '0.00';
    }
}
async function saveSale(e) {
    e.preventDefault();
    try {
        const payload = {
            phone_id: document.getElementById('salePhoneId').value,
            store_id: document.getElementById('saleStore').value,
            sale_type: document.getElementById('salePriceType').value === 'Crédito' ? 'Crédito' : 'Contado',
            price_type: document.getElementById('salePriceType').value,
            discount: parseFloat(document.getElementById('saleDiscount').value) || 0,
            prima: parseFloat(document.getElementById('salePrima').value) || 0,
            notes: document.getElementById('saleNotes').value,
            sale_date: document.getElementById('saleDate').value
        };
        const res = await fetchAuth(`${API_URL}/sales`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error);
        }
        showToast('Factura Cerrada Correctamente'); closeModal('saleModal'); await fetchAllData();
    } catch (err) { showToast(err.message, true); }
    return false;
}

async function markAsPaid(id) {
    if (!confirm("¿Confirmar que la financiera ha depositado el saldo y liquidar deuda al 100%?")) return;
    try { const res = await fetchAuth(`${API_URL}/liquidations/${id}/pay`, { method: 'PUT' }); if (!res.ok) throw new Error((await res.json()).error); showToast('Deuda Liquidada'); fetchLiquidations(); } catch (err) { showToast(err.message, true); }
}

function generateCatalog() { window.open(`${window.location.protocol}//${window.location.host}/api/export-catalog`, '_blank'); }

// --- NEW IMEI SEARCH OPTIMIZATION ---
function handleImeiSearch(module) {
    const input = document.getElementById(`${module}ImeiSearch`);
    const query = input.value.trim().toLowerCase();

    if (query.length === 0) {
        clearImeiSearch(module);
        return;
    }

    if (module === 'liquidations') {
        const filtered = state.liquidations.filter(s => s.imei.toLowerCase().includes(query) || s.model_name.toLowerCase().includes(query));
        renderLiquidationsTable(filtered);
        // Auto-select if exact match
        const exact = state.liquidations.find(s => s.imei === query);
        if (exact) {
            markAsPaid(exact.id);
            clearImeiSearch(module);
        }
        return;
    }

    // For Sales and Transfers - search in available phones
    const availablePhones = state.phones.filter(p => p.status === 'Disponible');
    const filtered = availablePhones.filter(p =>
        p.imei.toLowerCase().includes(query) ||
        p.model_name.toLowerCase().includes(query) ||
        p.brand_name.toLowerCase().includes(query)
    );

    renderSearchResults(module, filtered);

    // Auto-select if EXACT match
    const exactMatch = availablePhones.find(p => p.imei === query);
    if (exactMatch) {
        if (module === 'sales') openSaleModal(exactMatch.id);
        if (module === 'transfers') openTransferModal(exactMatch.id);
        clearImeiSearch(module);
    }
}

function clearImeiSearch(module) {
    const input = document.getElementById(`${module}ImeiSearch`);
    if (input) { input.value = ''; input.focus(); }

    if (module === 'liquidations') {
        renderLiquidationsTable();
    } else {
        const resultsCont = document.getElementById(`${module}SearchResults`);
        if (resultsCont) resultsCont.style.display = 'none';
        const list = document.getElementById(`${module}ResultsList`);
        if (list) list.innerHTML = '';
    }
}

function renderSearchResults(module, items) {
    const container = document.getElementById(`${module}SearchResults`);
    const list = document.getElementById(`${module}ResultsList`);

    if (items.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = items.map(p => `
        <div class="result-card" onclick="${module === 'sales' ? 'openSaleModal' : 'openTransferModal'}(${p.id}); clearImeiSearch('${module}')">
            <img src="${p.image_url || 'https://via.placeholder.com/150/1f2937/fff?text=' + encodeURIComponent(p.brand_name)}" class="result-img">
            <div class="result-info">
                <h4>${p.brand_name} ${p.model_name}</h4>
                <p><i class="fas fa-barcode"></i> ${p.imei}</p>
                <p style="color:var(--primary); font-weight:600;"><i class="fas fa-microchip"></i> ${p.ram || 'N/A'} / <i class="fas fa-hdd"></i> ${p.storage || 'N/A'}</p>
                <p><i class="fas fa-map-marker-alt"></i> ${p.store_name}</p>
            </div>
            <div class="result-action">
                <i class="fas ${module === 'sales' ? 'fa-shopping-cart' : 'fa-truck'}"></i>
            </div>
        </div>
    `).join('');
}

// ===========================
// BULK IMEI ENTRY (REPAIRED)
// ===========================
async function saveBulkPhones() {
    const model_id_el = document.getElementById('bulkModel');
    const store_id_el = document.getElementById('bulkStore');
    const bulkWholesale_el = document.getElementById('bulkWholesale');
    const textarea_el = document.getElementById('bulkImeiList');

    if (!model_id_el || !store_id_el || !textarea_el) return;

    const model_id = model_id_el.value;
    const store_id = store_id_el.value;
    const wholesale = parseFloat(bulkWholesale_el.value) || 0;
    const rawText = textarea_el.value;

    if (!model_id) { showToast('Seleccione el modelo', true); return; }
    if (!store_id) { showToast('Seleccione la tienda', true); return; }

    // Limpieza crítica solicitada: trim y eliminar vacíos
    const imeis = rawText.split('\n')
        .map(l => l.trim().toUpperCase())
        .filter(l => l.length > 0);

    if (imeis.length === 0) { showToast('Pegue al menos un IMEI', true); return; }

    const btn = document.getElementById('btnBulkSave');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-sync fa-spin"></i> PROCESANDO...';
    }

    try {
        // Update model wholesale price first
        const m = state.models.find(x => x.id == model_id);
        if (m && wholesale > 0) {
            await fetchAuth(`${API_URL}/models/${model_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...m, price_wholesale: wholesale })
            });
        }

        const res = await fetchAuth(`${API_URL}/phones/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_id, store_id, imeis })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error en el servidor');

        // Refrescar datos
        await fetchInventory();

        // Limpiar y Redirigir
        clearBulkForm();
        switchTab('inventory-tab');

        // Feedback Premium solicitado
        const msg = `${data.inserted} equipos guardados, ${data.duplicates} duplicados ignorados`;
        showToast(msg);

        if (data.others > 0) {
            alert(`Atención: ${data.others} registros fallaron por errores técnicos.`);
        }
    } catch (err) {
        showToast(err.message, true);
        console.error(err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar Todo';
        }
    }
}

function clearBulkForm() {
    const area = document.getElementById('bulkImeiList');
    if (area) {
        area.value = '';
        const countDisplay = document.getElementById('bulkImeiCount');
        if (countDisplay) countDisplay.textContent = '0 IMEIs detectados';
    }
    const resPanel = document.getElementById('bulkResults');
    if (resPanel) resPanel.style.display = 'none';
}

function renderPromotions() {
    const list = document.getElementById('promotionsList');
    const query = (document.getElementById('promoSearch').value || '').toLowerCase();

    const filtered = state.models.filter(m => m.name.toLowerCase().includes(query) || m.brand_name.toLowerCase().includes(query));

    list.innerHTML = filtered.map(m => `
        <div class="result-card" style="cursor: default; opacity: 1;">
            <div class="result-info">
                <h4>${m.brand_name} ${m.name}</h4>
                <p>Precio Contado: <strong>L. ${m.price_cash.toLocaleString('en-US')}</strong></p>
                <div class="form-group" style="margin-top: 1rem;">
                    <label style="font-size: 0.8rem;">Precio de Oferta (L.)</label>
                    <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
                        <input type="number" id="promo-offer-${m.id}" value="${m.offer_price || ''}" step="0.01" style="flex:1; height:36px; padding:0 0.5rem; border:1px solid var(--border-color); border-radius:0.5rem; background:var(--bg-color); color:#fff;">
                        <button class="btn btn-primary" style="background:var(--success); min-width:40px; height:36px; padding:0;" onclick="saveOfferPrice(${m.id})"><i class="fas fa-save"></i></button>
                        ${m.offer_price ? `<button class="btn btn-secondary" style="background:#ef4444; min-width:40px; height:36px; padding:0;" onclick="saveOfferPrice(${m.id}, true)"><i class="fas fa-times"></i></button>` : ''}
                    </div>
                </div>
                ${m.offer_price ? `<p style="color:var(--success); font-size:0.8rem; margin-top:0.5rem;"><i class="fas fa-check-circle"></i> En oferta actualmente</p>` : ''}
            </div>
        </div>
    `).join('');
}

async function refreshSystemTime() {
    const textEl = document.getElementById('st-text');
    const checkEl = document.getElementById('st-check');

    try {
        const res = await fetch(`${API_URL}/hora-actual`);
        if (!res.ok) throw new Error();
        const data = await res.json();

        if (textEl) textEl.innerText = `Honduras Time: ${data.hora} - ${data.fecha}`;
        if (checkEl) checkEl.style.display = data.isCorrect ? 'inline-block' : 'none';

    } catch (e) {
        if (textEl) textEl.innerText = 'Honduras Time: Sincronizando...';
        if (checkEl) checkEl.style.display = 'none';
        console.error('Time sync error:', e);
    }
}

// Global Init & Timers
setInterval(refreshSystemTime, 30000); // Cada 30 segundos
setTimeout(refreshSystemTime, 500);    // Al iniciar

async function saveOfferPrice(id, clear = false) {
    const offer_price = clear ? null : parseFloat(document.getElementById(`promo-offer-${id}`).value);
    try {
        const res = await fetchAuth(`${API_URL}/models/${id}/offer`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offer_price })
        });
        if (!res.ok) throw new Error("Error guardando oferta");
        showToast(clear ? 'Oferta eliminada' : 'Precio de oferta actualizado');
        await fetchConfig();
        renderPromotions();
    } catch (err) { showToast(err.message, true); }
}


function openReportsModal() {
    const rd = new Date();
    const mm = String(rd.getMonth() + 1).padStart(2, '0');
    document.getElementById('reportMonth').value = `${rd.getFullYear()}-${mm}`;
    openModal('reportsModal');
}

function generatePDFReport() {
    const monthVal = document.getElementById('reportMonth').value;
    const periodVal = document.getElementById('reportPeriod').value;
    if(!monthVal) return showToast('Seleccione un mes', true);
    
    // Parse target dates
    const [year, month] = monthVal.split('-');
    const m = parseInt(month) - 1;
    const y = parseInt(year);
    
    let startDate = new Date(y, m, 1);
    let endDate = new Date(y, m + 1, 0, 23, 59, 59); // end of month
    
    let periodText = 'Mes Completo';
    if(periodVal === '15') {
        endDate = new Date(y, m, 15, 23, 59, 59);
        periodText = 'Primera Quincena (1-15)';
    } else if(periodVal === '30') {
        startDate = new Date(y, m, 16);
        periodText = 'Segunda Quincena (16-Fin)';
    }
    
    const filterType = document.getElementById('salesTypeFilter') ? document.getElementById('salesTypeFilter').value : 'ALL';
    
    // Filtramos respetando el tipo seleccionado en la interfaz
    const filteredSales = state.sales.filter(s => {
        const saleD = new Date(s.sale_date);
        if (saleD < startDate || saleD > endDate) return false;
        
        if (filterType === 'Mayorista') return s.final_price_type === 'Mayorista';
        if (filterType === 'Crédito') return s.sale_type === 'Crédito' || s.final_price_type === 'Crédito';
        if (filterType === 'Contado') return (s.sale_type === 'Contado' && s.final_price_type !== 'Mayorista');
        return true;
    });
    
    if(filteredSales.length === 0){
        showToast('No hay ventas de Contado en el periodo seleccionado para cerrar.', true);
        return;
    }
    
    let totalSales = 0;
    let totalCosts = 0;
    let topPhonesCount = {};
    let storeStats = {};
    
    filteredSales.forEach(s => {
        totalSales += s.final_price;
        const cp = typeof s.cost_price === 'number' ? s.cost_price : (state.models.find(m => m.id === s.model_id)?.price_cost || 0);
        
        let actualCost = parseFloat(s.cost_price) || 0;
        totalCosts += actualCost;
        
        const store = s.store_name || 'Desconocida';
        if (!storeStats[store]) {
            storeStats[store] = { count: 0, revenue: 0, cost: 0 };
        }
        storeStats[store].count++;
        storeStats[store].revenue += s.final_price;
        storeStats[store].cost += actualCost;
        
        let brandName = '';
        const modelObj = state.models.find(m => m.name === s.model_name);
        if (modelObj) {
            const b = state.brands.find(br => String(br.id) === String(modelObj.brand_id));
            if (b) brandName = b.name + ' ';
        }
        
        const k = `${brandName}${s.model_name} ${s.ram||''}/${s.storage||''}`.trim();
        if(!topPhonesCount[k]) {
            topPhonesCount[k] = { count: 0, revenue: 0 };
        }
        topPhonesCount[k].count++;
        topPhonesCount[k].revenue += s.final_price;
    });
    
    const profit = totalSales - totalCosts;
    const sortedTop = Object.entries(topPhonesCount).sort((a,b) => b[1].count - a[1].count).slice(0, 10);
    // NUEVA GENERACIÓN DE PDF VECTORIAL VÍA IFRAME
    // ============================================
    let printFrame = document.getElementById('printFrame');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'printFrame';
        printFrame.style.position = 'absolute';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = 'none';
        document.body.appendChild(printFrame);
    }
    
    closeModal('reportsModal');
    showToast('Generando Documento... Por favor espere.');

    const logoHtml = `<img src="${window.location.protocol}//${window.location.host}/assets/images/branding/logo_solucels.png" style="max-height: 80px; margin-bottom: 5px; filter: brightness(0) invert(0);" alt="Solucels Logo" onerror="this.style.display='none'">`;
    const genDate = new Date().toLocaleString('es-HN');
    
    let filterDisplay = 'Todas las Ventas';
    if(filterType === 'Contado') filterDisplay = 'Solo Ventas al Contado';
    if(filterType === 'Crédito') filterDisplay = 'Solo Ventas a Crédito';
    if(filterType === 'Mayorista') filterDisplay = 'Solo Ventas Mayoristas';

    const periodDisplay = `${periodText} de ${startDate.toLocaleString('es-HN', {month: 'long', year: 'numeric'})} | ${filterDisplay}`;

    const htmlContent = `<!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Reporte de Ventas de ${periodDisplay}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
            body { 
                font-family: 'Outfit', Helvetica, Arial, sans-serif; 
                color: #1e293b; 
                margin: 0; 
                padding: 40px; 
                background: #fff;
            }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; }
            .header h1 { margin: 0; font-size: 26px; color: #0f172a; letter-spacing: -0.5px; }
            .header p { margin: 6px 0 0; color: #64748b; font-size: 15px; }
            
            .summary-box { display: flex; gap: 15px; margin-bottom: 40px; }
            .box { flex: 1; padding: 15px; border: 1.5px solid #e2e8f0; border-radius: 12px; text-align: center; background: #f8fafc; }
            .box h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; }
            .box .val { font-size: 21px; font-weight: 800; color: #0f172a; white-space: nowrap; }
            
            .box.danger { border-color: #fecaca; background: #fef2f2; }
            .box.danger h3 { color: #dc2626; }
            .box.danger .val { color: #b91c1c; }
            
            .box.success { border-color: #bbf7d0; background: #f0fdf4; }
            .box.success h3 { color: #16a34a; }
            .box.success .val { color: #15803d; }
            
            h3.section-title { font-size: 18px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px; font-weight: 700; }
            
            table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 40px; }
            th { background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; padding: 14px; text-align: left; font-weight: 700; color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
            td { padding: 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-weight: 500; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            
            .footer { text-align: center; margin-top: 50px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
            
            @media print {
                body { padding: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .box { border: 1.5px solid #000 !important; background: transparent !important; }
                .box.danger { border-color: #000 !important; }
                .box.success { border-color: #000 !important; }
            }
        </style>
    </head>
    <body>
        <div class="header">
            ${logoHtml}
            <h1>Reporte Estadístico de Ventas y Ganancias</h1>
            <p>${periodDisplay}</p>
        </div>
        
        <div class="summary-box">
            <div class="box" style="flex: 0.6; border-color: #cbd5e1; background: #f1f5f9;">
                <h3 style="color: #475569;">Unidades Vendidas</h3>
                <div class="val" style="color: #334155;">${filteredSales.length}</div>
            </div>
            <div class="box">
                <h3>Total Ventas (${filterType === 'ALL' ? 'General' : filterType})</h3>
                <div class="val">L. ${totalSales.toLocaleString('en-US', {minimumFractionDigits:2})}</div>
            </div>
            <div class="box danger">
                <h3>Costo de Dispositivos</h3>
                <div class="val">L. ${totalCosts.toLocaleString('en-US', {minimumFractionDigits:2})}</div>
            </div>
            <div class="box success">
                <h3>Ganancia Neta</h3>
                <div class="val">L. ${profit.toLocaleString('en-US', {minimumFractionDigits:2})}</div>
            </div>
        </div>

        <h3 class="section-title">Modelos Más Vendidos (Top)</h3>
        <table>
            <thead>
                <tr>
                    <th>Modelo / Especificaciones</th>
                    <th class="text-center">Unidades</th>
                    <th class="text-right">Ingreso Generado</th>
                </tr>
            </thead>
            <tbody>
                ${sortedTop.map(arr => `
                <tr>
                    <td><strong>${arr[0]}</strong></td>
                    <td class="text-center">${arr[1].count}</td>
                    <td class="text-right">L. ${arr[1].revenue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <div style="page-break-before: always; padding-top: 20px;">
            <div class="header" style="margin-bottom: 20px;">
                <h1>Desglose por Tienda</h1>
                <p>Métricas Operativas</p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Sucursal / Tienda</th>
                        <th class="text-center">Equipos Vendidos</th>
                        <th class="text-right">Volumen de Venta</th>
                        <th class="text-right">Ganancia Neta</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(storeStats).sort((a,b) => b[1].revenue - a[1].revenue).map(arr => `
                    <tr>
                        <td><strong>${arr[0]}</strong></td>
                        <td class="text-center">${arr[1].count}</td>
                        <td class="text-right">L. ${arr[1].revenue.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                        <td class="text-right" style="color: #15803d; font-weight: 700;">L. ${(arr[1].revenue - arr[1].cost).toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            Generado automáticamente por Solucels Control el ${genDate}.
        </div>
    </body>
    </html>`;

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
    }, 500);
}

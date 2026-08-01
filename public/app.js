let API_URL = '';
let currentUser = localStorage.getItem('slc_user') || '';
let currentRole = localStorage.getItem('slc_role') || 'admin';
let currentStoreId = localStorage.getItem('slc_store_id') || null;
let state = {
    stores: [], brands: [], models: [], phones: [], transfers: [], sales: [], liquidations: [], liquidationsHistory: [], users: [],
    auditPhones: [], auditResults: {}, revisionPhones: [], auditHistory: [],
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

document.addEventListener('DOMContentLoaded', () => {
    API_URL = `${window.location.protocol}//${window.location.host}/api`;
    // Auto-open Inventario group on startup
    const invGroup = document.querySelector('.acc-group[data-group="inventario"]');
    if (invGroup) invGroup.classList.add('open');
    checkAuthAndInit();
});

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar.classList.contains('open')) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
    else { sidebar.classList.add('open'); overlay.classList.add('active'); }
}

function getAuthToken() { return localStorage.getItem('slc_token'); }
function toggleAdminFeatures() {
    applyRolePermissions();
}

function applyRolePermissions() {
    const isAdmin = currentRole === 'admin';

    // Accordion groups & direct buttons: hide if data-admin="true" and not admin
    document.querySelectorAll('.acc-group[data-admin="true"], .acc-direct-btn[data-admin="true"]').forEach(el => {
        el.style.display = isAdmin ? 'block' : 'none';
    });

    // Submenu items: hide if data-admin="true" and not admin
    document.querySelectorAll('.acc-menu li[data-admin="true"]').forEach(li => {
        li.style.display = isAdmin ? 'flex' : 'none';
    });

    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = isAdmin ? 'flex' : 'none';

    // Hide add button for vendedores in inventory
    if (!isAdmin) {
        document.querySelectorAll('#inventory-tab header .btn-primary').forEach(b => {
            if (b.textContent.includes('Añadir')) b.style.display = 'none';
        });
        
        // Lock inventory store filter to assigned store for vendedor
        const storeFilter = document.getElementById('inventoryStoreFilter');
        if (storeFilter && currentStoreId) {
            storeFilter.value = currentStoreId;
            storeFilter.disabled = true;
        }

        // Auto-open Inventario group on load for vendedor
        const invGroup = document.querySelector('.acc-group[data-group="inventario"]');
        if (invGroup && !invGroup.classList.contains('open')) {
            invGroup.classList.add('open');
        }

        // If currently on an admin tab, redirect to inventory-tab
        const currentActiveTab = document.querySelector('.tab-content.active')?.id;
        const adminTabs = ['dashboard-tab', 'bulk-tab', 'config-tab', 'liquidations-tab', 'liquidations-history-tab', 'promotions-tab', 'audit-tab', 'audit-history-tab', 'revision-tab', 'users-tab'];
        if (!currentActiveTab || adminTabs.includes(currentActiveTab)) {
            switchTab('inventory-tab');
        }
    } else {
        const storeFilter = document.getElementById('inventoryStoreFilter');
        if (storeFilter) storeFilter.disabled = false;
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
        localStorage.setItem('slc_token', data.token); 
        localStorage.setItem('slc_user', data.username); 
        localStorage.setItem('slc_role', data.role);
        if (data.store_id) localStorage.setItem('slc_store_id', data.store_id);
        else localStorage.removeItem('slc_store_id');
        
        currentUser = data.username; 
        currentRole = data.role;
        currentStoreId = data.store_id || null;

        document.getElementById('loginOverlay').classList.add('hidden'); showToast('Bienvenido');
        toggleAdminFeatures(); fetchAllData(); document.getElementById('loginPassword').value = '';
    } catch (err) { showToast(err.message, true); }
}
function logout() { 
    localStorage.removeItem('slc_token'); 
    localStorage.removeItem('slc_user'); 
    localStorage.removeItem('slc_role'); 
    localStorage.removeItem('slc_store_id');
    currentUser = ''; currentRole = 'admin'; currentStoreId = null;
    document.getElementById('loginOverlay').classList.remove('hidden'); 
}

async function fetchAuth(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${getAuthToken()}`;
    const res = await fetch(url, options);
    if (res.status === 401) { logout(); throw new Error('Sesión Expirada'); }
    return res;
}

// FETCH DATA
async function fetchAllData() { await Promise.all([fetchConfig(), fetchInventory()]); fetchTransfers(); fetchSales(); fetchLiquidations(); if (currentRole === 'admin') fetchUsers(); }
function switchTab(tabId) {
    console.log('🚀 [FRONTEND ROUTER] Ejecutando switchTab para pestaña:', tabId);
    
    // Ensure role resolution from localStorage if logged in
    const storedRole = localStorage.getItem('slc_role');
    const storedUser = localStorage.getItem('slc_user');
    if (storedRole) currentRole = storedRole;
    else if (storedUser === 'admin') currentRole = 'admin';

    const isAdmin = currentRole === 'admin';
    const adminTabs = ['dashboard-tab', 'bulk-tab', 'config-tab', 'liquidations-tab', 'liquidations-history-tab', 'promotions-tab', 'audit-tab', 'audit-history-tab', 'revision-tab', 'users-tab'];

    // Block Vendedor from accessing admin tabs
    if (!isAdmin && adminTabs.includes(tabId)) {
        console.warn('⚠️ [FRONTEND ROUTER] Bloqueado acceso a adminTab por rol:', currentRole);
        showToast('Acceso denegado. Función exclusiva para administradores.', true);
        tabId = 'inventory-tab';
    }

    // Activate tab content (con sobrescritura de estilo inline para garantizar visibilidad)
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });
    const tabEl = document.getElementById(tabId);
    if (tabEl) {
        tabEl.classList.add('active');
        tabEl.style.display = 'block';
        console.log('✅ [FRONTEND ROUTER] Tab activado exitosamente en el DOM con display:block:', tabId);
    } else {
        console.error('❌ [FRONTEND ROUTER] No se encontró el elemento con ID:', tabId);
    }

    // Remove active class from all menu items & direct buttons
    document.querySelectorAll('.acc-menu li, .acc-direct-btn').forEach(el => el.classList.remove('active'));

    // Highlight direct button if matching data-tab
    const directBtn = document.querySelector(`.acc-direct-btn[data-tab="${tabId}"]`);
    if (directBtn) {
        directBtn.classList.add('active');
        document.querySelectorAll('.acc-group.open').forEach(g => g.classList.remove('open'));
    }

    // Highlight submenu item if matching data-tab
    const activeItem = document.querySelector(`.acc-menu li[data-tab="${tabId}"]:not([style*="display: none"])`) ||
                       document.querySelector(`.acc-menu li[data-tab="${tabId}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
        const parentGroup = activeItem.closest('.acc-group');
        if (parentGroup) {
            document.querySelectorAll('.acc-group.open').forEach(g => g.classList.remove('open'));
            parentGroup.classList.add('open');
        }
    }

    if (window.innerWidth <= 820) toggleSidebar();
    if (tabId === 'dashboard-tab' && isAdmin) { loadDashboard(); }
    else if (tabId === 'transfers-tab') { applyTransferFilters(); document.getElementById('transfersImeiSearch')?.focus(); }
    else if (tabId === 'sales-tab') { fetchSales(); document.getElementById('salesImeiSearch')?.focus(); }
    else if (tabId === 'warranties-tab') { fetchWarranties(); document.getElementById('warrantiesSearch')?.focus(); }
    else if (tabId === 'liquidations-tab') { fetchLiquidations(); document.getElementById('liquidationsImeiSearch')?.focus(); }
    else if (tabId === 'bulk-tab') { document.getElementById('bulkImeiList')?.focus(); }
    else if (tabId === 'promotions-tab') { fetchConfig(); renderPromotions(); }
    else if (tabId === 'audit-tab') { document.getElementById('auditImeiSearch')?.focus(); }
    else if (tabId === 'audit-history-tab') { fetchAuditHistory(); }
    else if (tabId === 'revision-tab') { fetchRevisionPhones(); }
    else if (tabId === 'users-tab') {
        console.log('👉 [FRONTEND ROUTER] Entrando a users-tab (HOLA MUNDO TEST)...');
        fetchUsers();
    }
    else if (tabId === 'inventory-tab') { fetchAllData(); }
}

function toggleAccordion(groupName) {
    const group = document.querySelector(`.acc-group[data-group="${groupName}"]`);
    if (!group) return;
    const isOpen = group.classList.contains('open');
    // Accordion: close all, then open clicked (unless it was already open)
    document.querySelectorAll('.acc-group.open').forEach(g => g.classList.remove('open'));
    if (!isOpen) group.classList.add('open');
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
async function fetchSales() { 
    try { 
        const url = currentRole === 'vendedor' ? `${API_URL}/sales/mine` : `${API_URL}/sales`;
        const res = await fetchAuth(url); 
        state.sales = await res.json(); 
        renderSalesTable(); 
    } catch (e) { console.error(e); } 
}
async function fetchLiquidations() { try { const res = await fetchAuth(`${API_URL}/liquidations`); state.liquidations = await res.json(); renderLiquidationsTable(); } catch (e) { console.error(e); } }
async function fetchUsers() { 
    console.log('👉 [FRONTEND LOG] Invocando fetchUsers()...');
    try { 
        if (!state.stores || state.stores.length === 0) {
            await fetchConfig();
        }
        console.log('👉 [FRONTEND LOG] Realizando fetchAuth a /api/users...');
        const res = await fetchAuth(`${API_URL}/users`); 
        console.log('👉 [FRONTEND LOG] Respuesta recibida de /api/users, Status HTTP:', res.status);
        const data = await res.json();
        console.log('👉 [FRONTEND LOG] Datos de usuarios decodificados:', data);
        state.users = Array.isArray(data) ? data : []; 
        renderUsersTable(); 
    } catch (e) { 
        console.error('❌ [FRONTEND LOG ERROR] Error en fetchUsers:', e); 
        state.users = [];
        renderUsersErrorState(e.message);
    } 
}

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

    // Populate sales filters
    const sfStoreFilter = document.getElementById('salesFilterStore');
    if (sfStoreFilter) {
        const sfCurrent = sfStoreFilter.value;
        sfStoreFilter.innerHTML = '<option value="ALL">Todas las Tiendas</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        if (sfCurrent) sfStoreFilter.value = sfCurrent;
    }
    const sfBrandFilter = document.getElementById('salesFilterBrand');
    if (sfBrandFilter) {
        const bfCurrent = sfBrandFilter.value;
        sfBrandFilter.innerHTML = '<option value="ALL">Todas las Marcas</option>' + state.brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        if (bfCurrent) sfBrandFilter.value = bfCurrent;
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
    const aStore = document.getElementById('auditStoreSelect');
    if (bModel) bModel.innerHTML = modelOptions;
    if (bStore) bStore.innerHTML = '<option value="">Seleccione Tienda...</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (aStore) aStore.innerHTML = '<option value="">Seleccione Tienda a Auditar...</option>' + state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

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

    // Render POS Card Grid (FASE 3)
    renderPosCards(phonesData);
    setPosViewMode(posViewMode);

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

let posViewMode = 'grid';

function setPosViewMode(mode) {
    posViewMode = mode;
    const gridEl = document.getElementById('posCardGrid');
    const tableEl = document.querySelector('#inventory-tab .table-container');
    const gridBtn = document.getElementById('viewModeGridBtn');
    const tableBtn = document.getElementById('viewModeTableBtn');

    if (mode === 'grid') {
        if (gridEl) gridEl.style.display = 'grid';
        if (tableEl) tableEl.style.display = 'none';
        if (gridBtn) gridBtn.classList.add('active');
        if (tableBtn) tableBtn.classList.remove('active');
    } else {
        if (gridEl) gridEl.style.display = 'none';
        if (tableEl) tableEl.style.display = 'block';
        if (gridBtn) gridBtn.classList.remove('active');
        if (tableBtn) tableBtn.classList.add('active');
    }
}

function renderPosCards(phonesData) {
    const grid = document.getElementById('posCardGrid');
    if (!grid) return;

    if (phonesData.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:3rem; color:var(--text-muted); font-size:1.1rem;"><i class="fas fa-inbox" style="font-size:2.5rem; display:block; margin-bottom:0.75rem;"></i>No hay equipos disponibles en esta sucursal</div>';
        return;
    }

    grid.innerHTML = phonesData.map(p => `
        <div class="pos-card" id="pos-card-${p.id}">
            <div class="pos-card-header">
                <img src="${p.image_url || 'https://via.placeholder.com/150/1f2937/fff?text=' + encodeURIComponent(p.brand_name)}" class="pos-card-img" alt="${p.model_name}">
                <div class="pos-card-title">
                    <span style="text-transform:uppercase; font-size:0.75rem; color:var(--primary); font-weight:700;">${p.brand_name}</span>
                    <h3>${p.model_name}</h3>
                    <span>${p.ram || 'N/A'} RAM / ${p.storage || 'N/A'} Storage</span>
                </div>
            </div>
            <div class="pos-card-imei">
                <span><i class="fas fa-barcode" style="color:var(--text-muted); margin-right:0.4rem;"></i> IMEI:</span>
                <strong style="color:var(--text-main); font-family:monospace;">${p.imei}</strong>
            </div>
            <div class="pos-card-pricing">
                <div>
                    <div class="pos-card-price-tag">L. ${p.price_cash.toLocaleString('en-US')}</div>
                    <div class="pos-card-credit-tag">${p.credit_enabled && p.price_credit ? 'Crédito: L. ' + p.price_credit.toLocaleString('en-US') : 'Sin Crédito'}</div>
                </div>
                <span class="badge badge-success"><i class="fas fa-store"></i> ${p.store_name}</span>
            </div>
            <div class="pos-card-actions">
                <button class="btn-pos-sell" onclick="openSaleModal(${p.id})">
                    <i class="fas fa-shopping-cart"></i> VENDER
                </button>
                <button class="btn-pos-transfer" onclick="openTransferModal(${p.id})">
                    <i class="fas fa-truck"></i> TRASLADAR
                </button>
            </div>
        </div>
    `).join('');
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
            <td data-label="Acciones" class="actions-cell text-right">
                ${currentUser === 'admin' ? `<button class="btn-icon text-danger" onclick="revertTransfer(${t.id})" title="Revertir Traslado"><i class="fas fa-undo"></i></button>` : ''}
            </td>
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
function getFilteredSales() {
    const filterType = document.getElementById('salesTypeFilter') ? document.getElementById('salesTypeFilter').value : 'ALL';
    const filterStore = document.getElementById('salesFilterStore') ? document.getElementById('salesFilterStore').value : 'ALL';
    const filterBrand = document.getElementById('salesFilterBrand') ? document.getElementById('salesFilterBrand').value : 'ALL';
    const dateFrom = document.getElementById('salesFilterDateFrom') ? document.getElementById('salesFilterDateFrom').value : '';
    const dateTo = document.getElementById('salesFilterDateTo') ? document.getElementById('salesFilterDateTo').value : '';

    return state.sales.filter(s => {
        if (filterType !== 'ALL') {
            if (filterType === 'Mayorista' && s.final_price_type !== 'Mayorista') return false;
            if (filterType === 'Crédito' && s.sale_type !== 'Crédito' && s.final_price_type !== 'Crédito') return false;
            if (filterType === 'Contado' && (s.sale_type !== 'Contado' || s.final_price_type === 'Mayorista')) return false;
        }
        if (filterStore !== 'ALL' && String(s.store_id) !== String(filterStore)) return false;
        if (filterBrand !== 'ALL' && String(s.brand_id) !== String(filterBrand)) return false;
        
        const saleD = new Date(s.sale_date);
        saleD.setHours(0, 0, 0, 0); // Ignore time for filtering
        if (dateFrom) {
            const df = new Date(dateFrom);
            df.setHours(0,0,0,0);
            df.setDate(df.getDate() + 1); // Adjust timezone offset simply
            if (saleD < df) return false;
        }
        if (dateTo) {
            const dt = new Date(dateTo);
            dt.setHours(23,59,59,999);
            dt.setDate(dt.getDate() + 1); // Adjust timezone offset simply
            if (saleD > dt) return false;
        }
        return true;
    });
}

function renderSalesTable() {
    const dataToRender = getFilteredSales();

    const tbody = document.querySelector('#salesTable tbody');
    if (!dataToRender.length) return tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay ventas registradas en este filtro</td></tr>';
    
    let totalSales = 0;
    tbody.innerHTML = dataToRender.map(s => {
        totalSales += s.final_price;
        const formattedFullDate = formatDate(s.sale_date);
        const [datePart, timePart, ampm] = formattedFullDate.split(' ');
        const dateHtml = `<strong>${datePart}</strong><br><small style="color:var(--text-muted)">${timePart} ${ampm || ''}</small>`;

        const actionHtml = currentUser === 'admin' ? `<button class="btn-icon text-danger" onclick="revertSale(${s.id})" title="Eliminar Venta"><i class="fas fa-undo"></i></button>` : '';
        return `<tr><td data-label="Fecha">${dateHtml}</td><td data-label="Equipo"><strong>${s.model_name}</strong><br><small style="color:var(--text-primary)">${s.ram || 'N/A'} / ${s.storage || 'N/A'}</small><br><small style="font-family:monospace">${s.imei}</small></td><td data-label="Tienda Venta">${s.store_name}</td><td data-label="Tipo"><span class="badge ${s.sale_type === 'Contado' ? 'badge-success' : 'badge-warning'}">${s.final_price_type || s.sale_type}</span></td><td data-label="Notas"><span style="font-size:0.85rem; color:var(--text-muted);">${s.notes || '-'}</span></td><td data-label="Precio (L.)" style="color:var(--success); font-weight:bold;">L. ${s.final_price.toLocaleString('en-US')}</td><td data-label="Acciones" class="actions-cell text-right">${actionHtml}</td></tr>`
    }).join('');
    
    document.getElementById('stat-total-sales').innerText = totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function filterSalesView() {
    renderSalesTable();
}

function clearSalesFilters() {
    if(document.getElementById('salesTypeFilter')) document.getElementById('salesTypeFilter').value = 'ALL';
    if(document.getElementById('salesFilterStore')) document.getElementById('salesFilterStore').value = 'ALL';
    if(document.getElementById('salesFilterBrand')) document.getElementById('salesFilterBrand').value = 'ALL';
    if(document.getElementById('salesFilterDateFrom')) document.getElementById('salesFilterDateFrom').value = '';
    if(document.getElementById('salesFilterDateTo')) document.getElementById('salesFilterDateTo').value = '';
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
function toggleUserStoreField() {
    const roleSelect = document.getElementById('newUserRole');
    const storeGroup = document.getElementById('newUserStoreGroup');
    const storeSelect = document.getElementById('newUserStore');
    if (!roleSelect || !storeGroup) return;

    if (roleSelect.value === 'vendedor') {
        storeGroup.style.display = 'block';
        if (storeSelect) storeSelect.required = true;
        if (storeSelect && (storeSelect.options.length <= 1 || storeSelect.options[1].text === '')) {
            storeSelect.innerHTML = '<option value="">-- Seleccionar Sucursal --</option>' +
                state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
    } else {
        storeGroup.style.display = 'none';
        if (storeSelect) { storeSelect.required = false; storeSelect.value = ''; }
    }
}

// ==========================================
// MÓDULO DE USUARIOS Y PERMISOS (RECONSTRUIDO DESDE CERO)
// ==========================================

function renderUsersTable() {
    const wrapper = document.getElementById('usersTableWrapper');
    if (!wrapper) return;

    if (!Array.isArray(state.users)) state.users = [];

    if (state.users.length === 0) {
        wrapper.innerHTML = `
            <div style="text-align:center; padding:3.5rem 1.5rem; background:rgba(255,255,255,0.02); border-radius:var(--radius-md);">
                <i class="fas fa-users-slash" style="font-size:3rem; color:var(--text-muted); display:block; margin-bottom:1rem;"></i>
                <h3 style="margin:0 0 0.5rem 0; color:var(--text-main); font-weight:700;">No hay usuarios registrados</h3>
                <p style="margin:0 0 1.5rem 0; color:var(--text-muted); font-size:0.9rem;">No se encontraron accesos configurados en el sistema actualmente.</p>
                <button type="button" class="btn btn-primary" onclick="openUserModal()" style="padding:0.65rem 1.4rem; font-size:0.9rem; border-radius:8px;">
                    <i class="fas fa-user-plus"></i> Crear Nuevo Usuario
                </button>
            </div>
        `;
        return;
    }

    wrapper.innerHTML = `
        <table id="usersTable" class="w-100">
            <thead>
                <tr>
                    <th>Nombre Completo</th>
                    <th>Usuario / Email</th>
                    <th>Rol de Acceso</th>
                    <th>Sucursal Asignada</th>
                    <th class="text-right">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${state.users.map(u => `
                    <tr>
                        <td data-label="Nombre Completo">
                            <strong>${u.full_name || u.username}</strong>
                        </td>
                        <td data-label="Usuario / Email">
                            <span style="font-family:monospace; font-size:0.9rem; color:var(--primary);">${u.username}</span>
                        </td>
                        <td data-label="Rol">
                            <span class="badge ${u.role === 'admin' ? 'badge-primary' : 'badge-secondary'}">
                                <i class="fas ${u.role === 'admin' ? 'fa-user-shield' : 'fa-user'}"></i> ${u.role === 'admin' ? 'Administrador' : 'Vendedor'}
                            </span>
                        </td>
                        <td data-label="Sucursal">
                            ${u.role === 'vendedor' && u.store_name ? `<span class="badge badge-success"><i class="fas fa-store"></i> ${u.store_name}</span>` : '<span style="color:var(--text-muted); font-size:0.85rem;">Todas (Acceso Global)</span>'}
                        </td>
                        <td class="text-right" data-label="Acciones">
                            <div style="display:flex; justify-content:flex-end; gap:0.4rem;">
                                <button type="button" class="btn-icon text-primary" onclick="openUserModal(${u.id})" title="Editar"><i class="fas fa-edit"></i></button>
                                ${u.username !== 'admin' ? `<button type="button" class="btn-icon text-danger" onclick="deleteUser(${u.id})" title="Eliminar"><i class="fas fa-trash"></i></button>` : '<span class="badge badge-success" style="font-size:0.7rem;">Admin Maestro</span>'}
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderUsersErrorState(errMsg) {
    const wrapper = document.getElementById('usersTableWrapper');
    if (!wrapper) return;
    wrapper.innerHTML = `
        <div style="text-align:center; padding:3rem 1.5rem; background:rgba(239,68,68,0.05); border:1px dashed var(--danger); border-radius:var(--radius-md);">
            <i class="fas fa-exclamation-triangle" style="font-size:2.8rem; color:var(--danger); display:block; margin-bottom:1rem;"></i>
            <h3 style="margin:0 0 0.5rem 0; color:var(--text-main); font-weight:700;">Error al cargar datos de usuarios</h3>
            <p style="margin:0 0 1.5rem 0; color:var(--danger); font-size:0.9rem;">${errMsg || 'No se pudo obtener la respuesta del servidor.'}</p>
            <button type="button" class="btn btn-secondary" onclick="fetchUsers()" style="padding:0.6rem 1.2rem; font-size:0.9rem; border-radius:8px;">
                <i class="fas fa-sync-alt"></i> Reintentar Carga
            </button>
        </div>
    `;
}

function openUserModal(userId = null) {
    const modalTitle = document.getElementById('userModalTitle');
    const idInput = document.getElementById('modalUserId');
    const nameInput = document.getElementById('modalUserFullName');
    const userInput = document.getElementById('modalUserUsername');
    const passInput = document.getElementById('modalUserPassword');
    const passHelp = document.getElementById('modalUserPassHelp');
    const roleSelect = document.getElementById('modalUserRole');
    const storeSelect = document.getElementById('modalUserStore');

    // Populate stores dropdown
    if (storeSelect && state.stores) {
        storeSelect.innerHTML = '<option value="">-- Seleccionar Sucursal --</option>' +
            state.stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    if (userId) {
        const u = state.users.find(x => x.id === userId);
        if (!u) return;
        modalTitle.innerHTML = '<i class="fas fa-user-edit"></i> Editar Usuario';
        idInput.value = u.id;
        nameInput.value = u.full_name || '';
        userInput.value = u.username || '';
        passInput.value = '';
        passInput.required = false;
        if (passHelp) passHelp.style.display = 'inline';
        roleSelect.value = u.role || 'admin';
        if (storeSelect) storeSelect.value = u.store_id || '';
    } else {
        modalTitle.innerHTML = '<i class="fas fa-user-plus"></i> Registrar Nuevo Usuario';
        idInput.value = '';
        nameInput.value = '';
        userInput.value = '';
        passInput.value = '';
        passInput.required = true;
        if (passHelp) passHelp.style.display = 'none';
        roleSelect.value = 'admin';
        if (storeSelect) storeSelect.value = '';
    }

    onModalUserRoleChange();
    openModal('userModal');
}

function onModalUserRoleChange() {
    const roleSelect = document.getElementById('modalUserRole');
    const storeGroup = document.getElementById('modalUserStoreGroup');
    const storeSelect = document.getElementById('modalUserStore');
    if (!roleSelect || !storeGroup) return;

    if (roleSelect.value === 'vendedor') {
        storeGroup.style.display = 'block';
        if (storeSelect) storeSelect.required = true;
    } else {
        storeGroup.style.display = 'none';
        if (storeSelect) { storeSelect.required = false; storeSelect.value = ''; }
    }
}

async function saveUserForm(e) {
    e.preventDefault();
    const userId = document.getElementById('modalUserId').value;
    const fullName = document.getElementById('modalUserFullName').value.trim();
    const username = document.getElementById('modalUserUsername').value.trim();
    const password = document.getElementById('modalUserPassword').value;
    const role = document.getElementById('modalUserRole').value;
    const storeId = document.getElementById('modalUserStore').value;

    if (role === 'vendedor' && !storeId) {
        showToast('Requisito Obligatorio: Seleccione una sucursal para el Vendedor.', true);
        return false;
    }

    const payload = {
        full_name: fullName,
        username: username,
        password: password,
        role: role,
        store_id: role === 'vendedor' ? parseInt(storeId) : null
    };

    try {
        let res;
        if (userId) {
            res = await fetchAuth(`${API_URL}/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            if (!password) {
                showToast('Contraseña es requerida para un nuevo usuario', true);
                return false;
            }
            res = await fetchAuth(`${API_URL}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Error al guardar usuario');
        }

        showToast(userId ? 'Usuario Actualizado Exitosamente' : 'Nuevo Usuario Registrado');
        closeModal('userModal');
        await fetchUsers();
    } catch (err) { showToast(err.message, true); }
    return false;
}

async function deleteUser(id) {
    if (!confirm('¿Eliminar acceso del usuario seleccionado?')) return;
    try { 
        const res = await fetchAuth(`${API_URL}/users/${id}`, { method: 'DELETE' }); 
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error eliminando usuario'); 
        fetchUsers(); 
        showToast('Usuario eliminado del sistema');
    } catch (err) { showToast(err.message, true); }
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
    const invoiceInput = document.getElementById('saleInvoiceFile');
    if (!invoiceInput || !invoiceInput.files || invoiceInput.files.length === 0) {
        showToast('Requisito Obligatorio: Debe adjuntar la fotografía o comprobante de la factura de venta.', true);
        return false;
    }

    const priceType = document.getElementById('salePriceType').value;
    const primaVal = parseFloat(document.getElementById('salePrima').value) || 0;

    if (priceType === 'Crédito' && primaVal <= 0) {
        showToast('Requisito Obligatorio: En ventas a Crédito debe registrar la Prima inicial recibida.', true);
        return false;
    }

    try {
        const formData = new FormData();
        formData.append('phone_id', document.getElementById('salePhoneId').value);
        formData.append('store_id', document.getElementById('saleStore').value);
        formData.append('sale_type', priceType === 'Crédito' ? 'Crédito' : 'Contado');
        formData.append('price_type', priceType);
        formData.append('discount', parseFloat(document.getElementById('saleDiscount').value) || 0);
        formData.append('prima', primaVal);
        formData.append('notes', document.getElementById('saleNotes').value || '');
        formData.append('sale_date', document.getElementById('saleDate').value || '');
        formData.append('invoice', invoiceInput.files[0]);

        const res = await fetchAuth(`${API_URL}/sales`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error);
        }

        showToast('Factura Cerrada y Venta Registrada con Éxito');
        closeModal('saleModal');
        await fetchAllData();
    } catch (err) { showToast(err.message, true); }
    return false;
}

async function markAsPaid(id) {
    if (!confirm("¿Confirmar que la financiera ha depositado el saldo y liquidar deuda al 100%?")) return;
    const s = state.liquidations.find(x => x.id === id);
    try { 
        const res = await fetchAuth(`${API_URL}/liquidations/${id}/pay`, { method: 'PUT' }); 
        if (!res.ok) throw new Error((await res.json()).error); 
        showToast('Deuda Liquidada'); 
        fetchLiquidations(); 
        
        if (s) {
            const msg = `\u2705 *Equipo Liquidado para su Venta*\n\n` +
                        `\uD83C\uDFEA *Tienda:* ${s.store_name}\n` +
                        `\uD83D\uDCF1 *Modelo:* ${s.model_name}\n` +
                        `\u2699\uFE0F *Especificaciones:* ${s.ram || 'N/A'} / ${s.storage || 'N/A'}\n` +
                        `\uD83D\uDD22 *IMEI:* ${s.imei}\n` +
                        `\uD83D\uDCE6 *Cantidad:* 1\n\n` +
                        `\uD83D\uDCB5 *Prima:* L. ${Number(s.prima || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}\n` +
                        `\uD83D\uDCB0 *Liquidado:* L. ${Number(s.saldo || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        }
    } catch (err) { showToast(err.message, true); }
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
    const filterType = document.getElementById('salesTypeFilter') ? document.getElementById('salesTypeFilter').value : 'ALL';
    const filterStore = document.getElementById('salesFilterStore') ? document.getElementById('salesFilterStore').value : 'ALL';
    const filterBrand = document.getElementById('salesFilterBrand') ? document.getElementById('salesFilterBrand').value : 'ALL';
    const dateFrom = document.getElementById('salesFilterDateFrom') ? document.getElementById('salesFilterDateFrom').value : '';
    const dateTo = document.getElementById('salesFilterDateTo') ? document.getElementById('salesFilterDateTo').value : '';
    
    const filteredSales = getFilteredSales();
    
    if(filteredSales.length === 0){
        showToast('No hay ventas para el filtro seleccionado.', true);
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
    
    showToast('Generando Documento... Por favor espere.');

    const logoHtml = `<img src="${window.location.protocol}//${window.location.host}/assets/images/branding/logo_solucels.png" style="max-height: 80px; margin-bottom: 5px; filter: brightness(0) invert(0);" alt="Solucels Logo" onerror="this.style.display='none'">`;
    const genDate = new Date().toLocaleString('es-HN');
    
    let filterDisplay = 'Todas las Ventas';
    if(filterType === 'Contado') filterDisplay = 'Solo Ventas al Contado';
    if(filterType === 'Crédito') filterDisplay = 'Solo Ventas a Crédito';
    if(filterType === 'Mayorista') filterDisplay = 'Solo Ventas Mayoristas';

    let periodText = 'Todos los tiempos';
    if(dateFrom && dateTo) periodText = `${dateFrom} al ${dateTo}`;
    else if(dateFrom) periodText = `Desde ${dateFrom}`;
    else if(dateTo) periodText = `Hasta ${dateTo}`;

    const storeText = filterStore !== 'ALL' ? document.getElementById('salesFilterStore').options[document.getElementById('salesFilterStore').selectedIndex].text : 'Todas las Tiendas';
    const brandText = filterBrand !== 'ALL' ? document.getElementById('salesFilterBrand').options[document.getElementById('salesFilterBrand').selectedIndex].text : 'Todas las Marcas';

    const periodDisplay = `${periodText} | ${filterDisplay} | Tienda: ${storeText} | Marca: ${brandText}`;

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

async function fetchLiquidationsHistory() { try { const res = await fetchAuth(`${API_URL}/liquidations/history`); state.liquidationsHistory = await res.json(); renderLiquidationsHistory(); } catch (e) { console.error(e); } }

function renderLiquidationsHistory() {
    const tbody = document.querySelector('#liquidationsHistoryTable tbody');
    if (!tbody) return;
    const query = (document.getElementById('liquidationsHistorySearch')?.value || '').toLowerCase();
    
    let filtered = state.liquidationsHistory || [];
    if (query) {
        filtered = filtered.filter(s => s.imei.toLowerCase().includes(query) || s.model_name.toLowerCase().includes(query));
    }
    
    if (!filtered.length) return tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay liquidaciones en el historial</td></tr>';
    
    tbody.innerHTML = filtered.map(s => {
        const actionHtml = `
            <button class="btn-icon text-primary" onclick="resendLiquidationMessage(${s.id})" title="Reenviar WhatsApp"><i class="fab fa-whatsapp"></i></button>
            ${currentUser === 'admin' ? `<button class="btn-icon text-danger" onclick="revertLiquidation(${s.id})" title="Revertir Liquidación"><i class="fas fa-undo"></i></button>` : ''}
        `;
        return `<tr>
            <td data-label="Fecha Venta">${formatDate(s.sale_date)}</td>
            <td data-label="Equipo"><strong>${s.model_name}</strong><br><small style="color:var(--text-primary)">${s.ram || 'N/A'} / ${s.storage || 'N/A'}</small><br><small>${s.imei}</small></td>
            <td data-label="Tienda">${s.store_name}</td>
            <td data-label="Precio Final">L. ${s.final_price.toLocaleString('en-US')}</td>
            <td data-label="Prima">L. ${s.prima.toLocaleString('en-US')}</td>
            <td data-label="Estado"><span class="badge badge-success">Pagado</span></td>
            <td data-label="Acciones" class="actions-cell text-right">${actionHtml}</td>
        </tr>`;
    }).join('');
}

function resendLiquidationMessage(id) {
    const s = state.liquidationsHistory.find(x => x.id === id);
    if (!s) return;
    const msg = `\u2705 *Equipo Liquidado para su Venta*\n\n` +
                `\uD83C\uDFEA *Tienda:* ${s.store_name}\n` +
                `\uD83D\uDCF1 *Modelo:* ${s.model_name}\n` +
                `\u2699\uFE0F *Especificaciones:* ${s.ram || 'N/A'} / ${s.storage || 'N/A'}\n` +
                `\uD83D\uDD22 *IMEI:* ${s.imei}\n` +
                `\uD83D\uDCE6 *Cantidad:* 1\n\n` +
                `\uD83D\uDCB5 *Prima:* L. ${Number(s.prima || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}\n` +
                `\uD83D\uDCB0 *Liquidado:* L. ${Number(s.final_price - s.prima).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function revertSale(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta venta y regresar el teléfono a disponible? (Esta acción no se puede deshacer)')) return;
    try {
        const res = await fetchAuth(`${API_URL}/sales/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Venta revertida exitosamente');
        await fetchAllData();
    } catch (err) { showToast(err.message, true); }
}

async function revertTransfer(id) {
    if (!confirm('¿Estás seguro de que deseas revertir este traslado?')) return;
    try {
        const res = await fetchAuth(`${API_URL}/transfers/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Traslado revertido exitosamente');
        await fetchAllData();
    } catch (err) { showToast(err.message, true); }
}

async function revertLiquidation(id) {
    if (!confirm('¿Estás seguro de que deseas revertir la liquidación? El equipo volverá a estado Pendiente de Pago.')) return;
    try {
        const res = await fetchAuth(`${API_URL}/liquidations/${id}/revert`, { method: 'PUT' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Liquidación revertida exitosamente');
        await fetchAllData();
    } catch (err) { showToast(err.message, true); }
}

// ==========================================
// AUDIT MODULE
// ==========================================
async function loadAudit() {
    const storeId = document.getElementById('auditStoreSelect').value;
    if (!storeId) return showToast('Seleccione una tienda primero', true);
    
    try {
        const res = await fetchAuth(`${API_URL}/phones/audit?store_id=${storeId}`);
        state.auditPhones = await res.json();
        
        // Initialize all as 'Sin Revisar'
        state.auditResults = {};
        state.auditPhones.forEach(p => {
            state.auditResults[p.id] = 'Sin Revisar';
        });
        
        document.getElementById('auditResponsible').value = '';
        document.getElementById('auditImeiSearch').value = '';
        renderAuditTable();
        updateAuditStats();
    } catch(err) {
        showToast(err.message, true);
    }
}

function renderAuditTable(filteredPhones = null) {
    const tbody = document.querySelector('#auditTable tbody');
    const phones = filteredPhones || state.auditPhones;
    
    if (!phones.length) {
        return tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No hay equipos disponibles o no coinciden con la búsqueda</td></tr>';
    }
    
    tbody.innerHTML = phones.map(p => {
        const result = state.auditResults[p.id];
        const isConforme = result === 'Conforme';
        const isNotFound = result === 'No Encontrado';
        
        const isUnreviewed = result === 'Sin Revisar';
        
        return `
        <tr>
            <td data-label="Marca / Modelo">
                <small style="color:var(--text-muted);">${p.brand_name}</small><br>
                <strong>${p.model_name}</strong>
            </td>
            <td data-label="IMEI / S/N">
                <span style="font-family:monospace; font-size:1.1rem;">${p.imei}</span>
            </td>
            <td data-label="Verificación Física" class="text-right">
                <div class="audit-toggle">
                    <button class="toggle-btn toggle-unreviewed ${isUnreviewed ? 'active' : ''}" 
                            onclick="toggleAuditItem(${p.id}, 'Sin Revisar')" title="Sin Revisar">
                        <i class="fas fa-minus"></i>
                    </button>
                    <button class="toggle-btn toggle-conforme ${isConforme ? 'active' : ''}" 
                            onclick="toggleAuditItem(${p.id}, 'Conforme')">
                        <i class="fas fa-check"></i> Conforme
                    </button>
                    <button class="toggle-btn toggle-no-found ${isNotFound ? 'active' : ''}" 
                            onclick="toggleAuditItem(${p.id}, 'No Encontrado')">
                        <i class="fas fa-times"></i> No Encontrado
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function toggleAuditItem(phoneId, result) {
    state.auditResults[phoneId] = result;
    filterAuditByImei();
    updateAuditStats();
}

function filterAuditByImei() {
    const q = document.getElementById('auditImeiSearch').value.toLowerCase().trim();
    if (!q) {
        renderAuditTable();
    } else {
        const filtered = state.auditPhones.filter(p => 
            p.imei.toLowerCase().includes(q) || 
            p.model_name.toLowerCase().includes(q)
        );
        renderAuditTable(filtered);
    }
}

function clearAuditSearch() {
    document.getElementById('auditImeiSearch').value = '';
    renderAuditTable();
    document.getElementById('auditImeiSearch').focus();
}

function updateAuditStats() {
    const total = state.auditPhones.length;
    let conformes = 0;
    let notFound = 0;
    let unreviewed = 0;
    
    for (const key in state.auditResults) {
        if (state.auditResults[key] === 'Conforme') conformes++;
        if (state.auditResults[key] === 'No Encontrado') notFound++;
        if (state.auditResults[key] === 'Sin Revisar') unreviewed++;
    }
    
    document.getElementById('auditStatTotal').innerText = total;
    document.getElementById('auditStatConformes').innerText = conformes;
    document.getElementById('auditStatMissing').innerText = notFound;
    
    const unrevEl = document.getElementById('auditStatUnreviewed');
    if (unrevEl) unrevEl.innerText = unreviewed;
}

async function finalizeAudit() {
    const storeSelect = document.getElementById('auditStoreSelect');
    const storeId = storeSelect.value;
    const storeName = storeSelect.options[storeSelect.selectedIndex]?.text || '';
    const responsibleName = document.getElementById('auditResponsible').value.trim();

    if (!storeId || !state.auditPhones.length) {
        return showToast('Cargue un inventario para auditar primero', true);
    }
    if (!responsibleName) {
        return showToast('Ingrese el nombre del responsable de la tienda', true);
    }
    
    let notFound = 0;
    let unreviewed = 0;
    const items = state.auditPhones.map(p => {
        const res = state.auditResults[p.id];
        if (res === 'No Encontrado') notFound++;
        if (res === 'Sin Revisar') unreviewed++;
        return { phone_id: p.id, result: res, ...p };
    });
    
    if (unreviewed > 0) {
        return showToast(`No puede finalizar. Aún hay ${unreviewed} equipo(s) "Sin Revisar".`, true);
    }
    
    if (!confirm(`¿Está seguro de finalizar la auditoría?\n\nEquipos marcados como 'No Encontrado' (${notFound}) serán pasados a estado 'En Revisión' y ya no estarán disponibles para venta.`)) {
        return;
    }
    
    try {
        const res = await fetchAuth(`${API_URL}/audits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store_id: storeId, items, responsible_name: responsibleName })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        
        showAuditReport(data);
        generateAuditPDF(data, storeName, responsibleName, items);
        
        // Reset audit state
        state.auditPhones = [];
        state.auditResults = {};
        document.getElementById('auditStoreSelect').value = '';
        document.getElementById('auditResponsible').value = '';
        renderAuditTable();
        updateAuditStats();
        
        // Refresh inventory if we are admin maybe? 
        // We'll let the user navigate naturally.
        fetchAllData();
        
    } catch(err) {
        showToast(err.message, true);
    }
}

function showAuditReport(data) {
    const reportHtml = `
    <div class="audit-summary" style="text-align:center; padding:1rem;">
        <h2 style="color:var(--text-primary); margin-bottom:1rem;"><i class="fas fa-clipboard-check"></i> Auditoría Finalizada</h2>
        <p style="color:var(--text-muted); margin-bottom:1.5rem;">Los datos han sido guardados en el sistema.</p>
        <div style="display:flex; justify-content:center; gap:3rem; margin-top:2rem;">
            <div>
                <div style="font-size:3.5rem; font-weight:900; color:var(--success);">${data.conformes}</div>
                <div style="color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-size:0.9rem; font-weight:bold;">Conformes</div>
            </div>
            <div>
                <div style="font-size:3.5rem; font-weight:900; color:var(--danger);">${data.no_encontrados}</div>
                <div style="color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-size:0.9rem; font-weight:bold;">En Revisión</div>
            </div>
        </div>
    </div>
    `;
    
    const modalWrap = document.createElement('div');
    modalWrap.className = 'modal-overlay active';
    modalWrap.innerHTML = `
        <div class="modal" style="max-width:500px;">
            ${reportHtml}
            <div style="margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border-color);">
                <button class="btn btn-primary w-100" style="padding:1rem; font-size:1.1rem;" onclick="this.closest('.modal-overlay').remove()">Aceptar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalWrap);
}

// ==========================================
// REVISION MODULE
// ==========================================
async function fetchRevisionPhones() {
    try {
        const res = await fetchAuth(`${API_URL}/phones/en-revision`);
        state.revisionPhones = await res.json();
        renderRevisionTable();
    } catch(err) {
        console.error(err);
        showToast('Error cargando equipos en revisión', true);
    }
}

function renderRevisionTable() {
    const tbody = document.querySelector('#revisionTable tbody');
    if (!state.revisionPhones.length) {
        return tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:3rem;">No hay equipos en revisión actualmente. ¡Excelente!</td></tr>';
    }
    
    tbody.innerHTML = state.revisionPhones.map(p => `
        <tr>
            <td data-label="ID">${p.id}</td>
            <td data-label="Marca / Modelo">
                <small style="color:var(--text-muted);">${p.brand_name}</small><br>
                <strong>${p.model_name}</strong>
            </td>
            <td data-label="IMEI / S/N"><span style="font-family:monospace">${p.imei}</span></td>
            <td data-label="Tienda Reportada"><span class="badge badge-warning">${p.store_name}</span></td>
            <td data-label="Acciones Admin" class="actions-cell text-right">
                <button class="btn btn-primary" onclick="resolvePhone(${p.id})"><i class="fas fa-undo"></i> Restaurar a Disponible</button>
            </td>
        </tr>
    `).join('');
}

async function resolvePhone(id) {
    if(!confirm('¿Está seguro de restaurar este equipo a "Disponible"? Volverá a aparecer en el inventario para la venta.')) return;
    try {
        const res = await fetchAuth(`${API_URL}/phones/${id}/resolver`, { method: 'PUT' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('Equipo restaurado exitosamente');
        fetchRevisionPhones();
        fetchAllData(); // refresh inventory
    } catch(err) {
        showToast(err.message, true);
    }
}

function generateAuditPDF(data, storeName, responsibleName, items) {
    const logoUrl = `${window.location.protocol}//${window.location.host}/assets/images/branding/logo_solucels.png`;
    const genDate = new Date().toLocaleDateString('es-HN', { day:'2-digit', month:'2-digit', year:'numeric' });
    const genTime = new Date().toLocaleTimeString('es-HN', { hour:'2-digit', minute:'2-digit', hour12:true });
    
    // Group items by result
    const conformes = items.filter(i => i.result === 'Conforme');
    const noEncontrados = items.filter(i => i.result === 'No Encontrado');
    
    let htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Auditoría - ${storeName}</title>
    <style>
        @page { size: 80mm auto; margin: 5mm 4mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; width: 72mm; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .logo-wrap { text-align: center; margin-bottom: 3px; }
        .logo-wrap img { max-width: 44mm; max-height: 18mm; filter: invert(1) brightness(0); -webkit-filter: invert(1) brightness(0); }
        .rh { text-align: center; padding-bottom: 6px; margin-bottom: 4px; border-bottom: 2px solid #000; }
        .company { font-size: 13pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
        .subtitle { font-size: 9pt; font-weight: 700; margin-top: 2px; }
        .gen-date { font-size: 8.5pt; margin-top: 3px; }
        .info-row { display: table; width: 100%; font-size: 8.5pt; padding: 2px 0; line-height: 1.6; }
        .info-label { display: table-cell; font-weight: 700; width: 25mm; }
        .info-value { display: table-cell; text-align: right; }
        .sep-solid { border-top: 2px solid #000; margin: 5px 0; }
        .section-title { font-size: 9.5pt; font-weight: 900; background: #000; color: #fff; text-align: center; padding: 4px 0; margin: 6px 0; text-transform: uppercase; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin: 2px 0; text-align: left; }
        .items-table th { font-size: 7.5pt; font-weight: 900; text-transform: uppercase; padding: 3px 2px; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; background: #f0f0f0; }
        .items-table td { padding: 3px 2px; vertical-align: top; border-bottom: 1px solid #ccc; line-height: 1.4; }
        .items-table tr:last-child td { border-bottom: 1.5px solid #000; }
        .receipt-footer { font-size: 8pt; text-align: center; line-height: 1.8; padding-top: 5px; margin-top: 4px; }
    </style>
</head>
<body>
    <div class="rh">
        <div class="logo-wrap">
            <img src="${logoUrl}" alt="Solucels" onerror="this.style.display='none'">
        </div>
        <div class="company">Solucels Control</div>
        <div class="subtitle">Reporte de Auditoría (ID #${data.auditId})</div>
        <div class="gen-date">${genDate} &nbsp;|&nbsp; ${genTime}</div>
    </div>

    <div class="info-row"><span class="info-label">Tienda:</span><span class="info-value">${storeName.toUpperCase()}</span></div>
    <div class="info-row"><span class="info-label">Realizado por:</span><span class="info-value">${currentUser.toUpperCase()}</span></div>
    <div class="info-row"><span class="info-label">Responsable:</span><span class="info-value">${responsibleName.toUpperCase()}</span></div>
    <div class="info-row"><span class="info-label">Total Auditado:</span><span class="info-value">${items.length} EQUIPOS</span></div>
    
    <div class="section-title">CONFORMES: ${data.conformes}</div>`;
    
    if (conformes.length > 0) {
        htmlContent += `<table class="items-table">
            <thead><tr><th style="width:7mm">#</th><th>Modelo</th><th style="width:26mm">IMEI</th></tr></thead>
            <tbody>
                ${conformes.map((p, i) => `<tr><td style="text-align:center; font-weight:700;">${String(i+1).padStart(2,'0')}</td><td>${p.model_name}</td><td style="font-family:monospace; font-weight:700;">${p.imei}</td></tr>`).join('')}
            </tbody>
        </table>`;
    } else {
        htmlContent += `<div style="text-align:center; font-size:8pt; font-style:italic;">Ningún equipo conforme</div>`;
    }

    htmlContent += `<div class="section-title" style="background:#dc2626;">NO ENCONTRADOS (EN REVISIÓN): ${data.no_encontrados}</div>`;
    
    if (noEncontrados.length > 0) {
        htmlContent += `<table class="items-table">
            <thead><tr><th style="width:7mm">#</th><th>Modelo</th><th style="width:26mm">IMEI</th></tr></thead>
            <tbody>
                ${noEncontrados.map((p, i) => `<tr><td style="text-align:center; font-weight:700;">${String(i+1).padStart(2,'0')}</td><td>${p.model_name}</td><td style="font-family:monospace; font-weight:700;">${p.imei}</td></tr>`).join('')}
            </tbody>
        </table>`;
    } else {
        htmlContent += `<div style="text-align:center; font-size:8pt; font-style:italic;">Todos los equipos fueron encontrados</div>`;
    }

    htmlContent += `
    <div class="sep-solid"></div>
    <div class="receipt-footer">
        <strong>SOLUCELS CONTROL</strong><br>
        *** REPORTE GENERADO AUTOMÁTICAMENTE ***
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
    showToast('Generando Reporte de Auditoría...');
    const doc = printFrame.contentWindow.document;
    doc.open(); doc.write(htmlContent); doc.close();
    setTimeout(() => { printFrame.contentWindow.focus(); printFrame.contentWindow.print(); }, 700);
}

// ==========================================
// WARRANTIES MODULE
// ==========================================
async function fetchWarranties() {
    try {
        const res = await fetchAuth(`${API_URL}/warranties`);
        state.warranties = await res.json();
        renderWarrantiesTable();
    } catch(err) { console.error(err); }
}

function renderWarrantiesTable() {
    const tbody = document.querySelector('#warrantiesTable tbody');
    if (!tbody) return;
    const q = document.getElementById('warrantiesSearch')?.value.toLowerCase() || '';
    
    let filtered = state.warranties || [];
    if (q) {
        filtered = filtered.filter(w => 
            (w.imei && w.imei.toLowerCase().includes(q)) ||
            (w.client_name && w.client_name.toLowerCase().includes(q)) ||
            (w.model_name && w.model_name.toLowerCase().includes(q))
        );
    }
    
    tbody.innerHTML = filtered.map(w => `
        <tr>
            <td data-label="Fecha">${formatDate(w.created_at)}</td>
            <td data-label="Cliente">
                <div style="font-weight:600">${w.client_name || 'N/A'}</div>
                <small style="color:var(--text-muted)">${w.client_phone || ''}</small>
            </td>
            <td data-label="Equipo">
                <div style="font-weight:600">${w.brand_name} ${w.model_name}</div>
                <small style="font-family:monospace">${w.imei}</small>
            </td>
            <td data-label="Tienda"><span class="badge badge-primary">${w.store_name}</span></td>
            <td data-label="Documentos">
                ${w.receipt_thumb ? `<img src="${w.receipt_thumb}" class="doc-thumb" onclick="viewImage('${w.receipt_path}')" title="Comprobante" loading="lazy">` : '<span class="badge badge-warning">Sin Comp.</span>'}
                ${w.warranty_thumb ? `<img src="${w.warranty_thumb}" class="doc-thumb" onclick="viewImage('${w.warranty_path}')" title="Garantía" loading="lazy">` : '<span class="badge badge-warning">Sin Gar.</span>'}
            </td>
            <td data-label="Acciones" class="text-right">
                <button class="btn btn-secondary" onclick="openWarrantyModal(${w.sale_id})"><i class="fas fa-upload"></i> Subir / Editar</button>
            </td>
        </tr>
    `).join('');
}

function openWarrantyModal(saleId) {
    document.getElementById('warrantyForm').reset();
    document.getElementById('warrantySaleId').value = saleId;
    
    // Si ya hay datos, cargarlos
    const w = (state.warranties || []).find(x => x.sale_id === saleId);
    if(w) {
        document.getElementById('warrantyClientName').value = w.client_name || '';
        document.getElementById('warrantyClientPhone').value = w.client_phone || '';
        document.getElementById('warrantyDate').value = w.warranty_date || '';
        document.getElementById('warrantyObservations').value = w.observations || '';
    }
    
    openModal('warrantyModal');
}

async function saveWarranty(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';
    btn.disabled = true;

    try {
        const formData = new FormData();
        const saleId = document.getElementById('warrantySaleId').value;
        formData.append('client_name', document.getElementById('warrantyClientName').value);
        formData.append('client_phone', document.getElementById('warrantyClientPhone').value);
        formData.append('warranty_date', document.getElementById('warrantyDate').value);
        formData.append('observations', document.getElementById('warrantyObservations').value);

        const receiptFile = document.getElementById('warrantyReceipt').files[0];
        const warrantyFile = document.getElementById('warrantyDoc').files[0];
        
        if(receiptFile) formData.append('receipt', receiptFile);
        if(warrantyFile) formData.append('warranty', warrantyFile);

        const res = await fetchAuth(`${API_URL}/warranties/${saleId}`, {
            method: 'POST',
            // headers: no enviamos Content-Type para que el browser ponga el boundary de multipart/form-data
            body: formData
        });

        if (!res.ok) throw new Error((await res.json()).error);
        
        showToast('Garantía guardada correctamente');
        closeModal('warrantyModal');
        fetchWarranties();
    } catch(err) {
        showToast(err.message, true);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function viewImage(url) {
    if(!url) return;
    const img = document.getElementById('lightboxImage');
    img.src = url;
    openModal('lightboxModal');
}

// ==========================================
// DB RESET — DANGER ZONE
// ==========================================
function openResetModal() {
    const input = document.getElementById('resetConfirmInput');
    const btn = document.getElementById('resetConfirmBtn');
    const result = document.getElementById('resetResult');
    if (input) input.value = '';
    if (result) { result.style.display = 'none'; result.innerHTML = ''; }
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; btn.style.cursor = 'not-allowed'; }
    openModal('resetModal');
    setTimeout(() => input && input.focus(), 300);
}

function checkResetInput() {
    const input = document.getElementById('resetConfirmInput');
    const btn = document.getElementById('resetConfirmBtn');
    if (!input || !btn) return;
    const isValid = input.value.trim() === 'CONFIRMAR';
    btn.disabled = !isValid;
    btn.style.opacity = isValid ? '1' : '0.4';
    btn.style.cursor = isValid ? 'pointer' : 'not-allowed';
    input.style.borderColor = input.value.length > 0 
        ? (isValid ? 'var(--success)' : 'var(--danger)') 
        : 'var(--border-color)';
}

async function executeReset() {
    const btn = document.getElementById('resetConfirmBtn');
    const result = document.getElementById('resetResult');
    if (!btn || btn.disabled) return;

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ejecutando...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const res = await fetchAuth(`${API_URL}/admin/reset-data`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error desconocido');

        result.style.display = 'block';
        result.className = 'reset-result-success';
        result.innerHTML = `
            <strong><i class="fas fa-check-circle"></i> ¡Reseteo completado exitosamente!</strong>
            <div style="margin-top:0.75rem; display:grid; grid-template-columns:1fr 1fr; gap:0.4rem; font-size:0.82rem;">
                <span>📦 Equipos en stock:</span><strong>${data.summary.phones}</strong>
                <span>💰 Ventas:</span><strong>${data.summary.sales}</strong>
                <span>🔄 Traslados:</span><strong>${data.summary.transfers}</strong>
                <span>📋 Auditorías:</span><strong>${data.summary.audits}</strong>
                <span>🏷️ Garantías:</span><strong>${data.summary.warranties}</strong>
                <span>📚 Catálogo Maestro:</span><strong>${data.summary.phone_models} modelos ✓</strong>
            </div>`;

        // Reset local state and re-render UI to show zeros
        state.phones = []; state.sales = []; state.transfers = [];
        renderPhonesTable([]); renderSalesTable();
        showToast('Base de datos reseteada correctamente. Catálogo Maestro conservado.');

        // Auto-close modal after 4 seconds
        setTimeout(() => closeModal('resetModal'), 4500);

    } catch (err) {
        result.style.display = 'block';
        result.className = 'reset-result-error';
        result.innerHTML = `<strong><i class="fas fa-times-circle"></i> Error:</strong> ${err.message}`;
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

// ==========================================
// DASHBOARD MODULE — ADMIN ONLY
// ==========================================
let _chartSalesTrend = null;
let _chartTopModels  = null;

const DASH_COLORS = ['#3b82f6','#10b981','#8b5cf6','#f59e0b','#ef4444','#06b6d4'];

function fmtLPS(n) {
    if (!n && n !== 0) return 'L 0.00';
    return 'L ' + Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadDashboard() {
    const btn = document.getElementById('dashRefreshBtn');
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...'; btn.disabled = true; }
    try {
        await Promise.all([
            loadDashboardSummary(),
            loadDashboardCharts(),
            loadLowStock(),
            loadRecentSales()
        ]);
    } catch(e) { console.error('Dashboard error:', e); }
    if (btn) { btn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar'; btn.disabled = false; }
}

async function loadDashboardSummary() {
    try {
        const res = await fetchAuth(`${API_URL}/dashboard/summary`);
        if (!res.ok) return;
        const d = await res.json();

        // Ventas Hoy
        document.getElementById('kpiSalesTodayTotal').textContent = fmtLPS(d.salesToday?.total);
        document.getElementById('kpiSalesTodayQty').textContent   = `${d.salesToday?.qty || 0} equipo(s)`;

        // Ventas Mes
        document.getElementById('kpiSalesMonthTotal').textContent = fmtLPS(d.salesMonth?.total);
        document.getElementById('kpiSalesMonthQty').textContent   = `${d.salesMonth?.qty || 0} equipo(s)`;

        // Stock
        document.getElementById('kpiStockQty').textContent   = `${d.stock?.qty || 0} equipo(s)`;
        document.getElementById('kpiStockValue').textContent = `Valor: ${fmtLPS(d.stock?.value)}`;

        // Liquidaciones
        document.getElementById('kpiLiqPendiente').textContent = fmtLPS(d.liquidaciones?.pendiente);
        document.getElementById('kpiLiqQty').textContent       = `${d.liquidaciones?.qty || 0} activo(s)`;

        // En Revisión
        const revQty = d.enRevision?.qty || 0;
        document.getElementById('kpiRevisionQty').textContent = String(revQty);
        const revCard = document.getElementById('kpiRevisionCard');
        if (revCard) revCard.style.opacity = revQty > 0 ? '1' : '0.5';

        // Top Tienda
        if (d.topStore) {
            document.getElementById('kpiTopStoreName').textContent  = d.topStore.name;
            document.getElementById('kpiTopStoreTotal').textContent = `${fmtLPS(d.topStore.total)} · ${d.topStore.qty} ventas`;
        }
    } catch(e) { console.error('Summary error:', e); }
}

async function loadDashboardCharts() {
    const days = parseInt(document.getElementById('dashChartDays')?.value || 30);
    try {
        // Sales Trend Chart
        const trendRes = await fetchAuth(`${API_URL}/dashboard/sales-chart?days=${days}`);
        const trendData = trendRes.ok ? await trendRes.json() : [];

        const labels   = trendData.map(r => r.day.slice(5));  // MM-DD
        const amounts  = trendData.map(r => r.total);
        const qtys     = trendData.map(r => r.qty);

        const trendCtx = document.getElementById('salesTrendChart');
        if (trendCtx) {
            if (_chartSalesTrend) _chartSalesTrend.destroy();
            _chartSalesTrend = new Chart(trendCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Ventas (L)',
                        data: amounts,
                        backgroundColor: 'rgba(59,130,246,0.25)',
                        borderColor: '#3b82f6',
                        borderWidth: 2,
                        borderRadius: 4,
                        yAxisID: 'y'
                    }, {
                        label: 'Equipos',
                        data: qtys,
                        type: 'line',
                        borderColor: '#10b981',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 3,
                        yAxisID: 'y1'
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
                    scales: {
                        x: { ticks: { color: '#9ca3af', maxRotation: 45, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y:  { ticks: { color: '#9ca3af', callback: v => 'L'+v.toLocaleString() }, grid: { color: 'rgba(255,255,255,0.05)' }, position: 'left' },
                        y1: { ticks: { color: '#10b981' }, grid: { display: false }, position: 'right' }
                    }
                }
            });
        }

        // Top Models Doughnut
        const modRes  = await fetchAuth(`${API_URL}/dashboard/top-models`);
        const modData = modRes.ok ? await modRes.json() : [];

        const modCtx = document.getElementById('topModelsChart');
        if (modCtx) {
            if (_chartTopModels) _chartTopModels.destroy();
            if (modData.length === 0) {
                modCtx.style.display = 'none';
                document.getElementById('topModelsLegend').innerHTML = '<li style="color:var(--text-muted);font-size:0.85rem;">Sin datos aún</li>';
            } else {
                modCtx.style.display = '';
                _chartTopModels = new Chart(modCtx, {
                    type: 'doughnut',
                    data: {
                        labels: modData.map(m => `${m.brand} ${m.model}`),
                        datasets: [{ data: modData.map(m => m.qty), backgroundColor: DASH_COLORS, borderWidth: 0, hoverOffset: 8 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false, cutout: '65%',
                        plugins: { legend: { display: false } }
                    }
                });
                const legend = document.getElementById('topModelsLegend');
                legend.innerHTML = modData.map((m, i) => `
                    <li>
                        <span class="legend-dot" style="background:${DASH_COLORS[i]}"></span>
                        ${m.brand} ${m.model} — <strong style="color:var(--text-main)">${m.qty}</strong> uds.
                    </li>`).join('');
            }
        }
    } catch(e) { console.error('Charts error:', e); }
}

async function loadLowStock() {
    try {
        const res = await fetchAuth(`${API_URL}/dashboard/low-stock?threshold=5`);
        if (!res.ok) return;
        const data = await res.json();

        const badge = document.getElementById('lowStockBadge');
        if (badge) {
            badge.textContent = data.length;
            badge.classList.toggle('badge-pulse', data.length > 0);
        }

        const tbody = document.querySelector('#lowStockTable tbody');
        if (!tbody) return;
        tbody.innerHTML = data.length === 0
            ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:1rem;">✅ Sin alertas de stock bajo</td></tr>'
            : data.map(r => `
                <tr>
                    <td data-label="Modelo">
                        <div style="font-weight:600">${r.brand} ${r.model}</div>
                    </td>
                    <td data-label="Unidades" class="text-center">
                        <span class="badge ${r.qty === 0 ? 'badge-danger' : 'badge-warning'}">${r.qty}</span>
                    </td>
                    <td data-label="Precio" class="text-right">${fmtLPS(r.price_cash)}</td>
                </tr>`).join('');
    } catch(e) { console.error('Low stock error:', e); }
}

async function loadRecentSales() {
    try {
        const res = await fetchAuth(`${API_URL}/dashboard/recent-sales`);
        if (!res.ok) return;
        const data = await res.json();

        const tbody = document.querySelector('#recentSalesTable tbody');
        if (!tbody) return;
        tbody.innerHTML = data.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem;">Sin ventas registradas aún</td></tr>'
            : data.map(s => `
                <tr>
                    <td data-label="Fecha" style="font-size:0.82rem;white-space:nowrap;">${formatDate(s.sale_date)}</td>
                    <td data-label="Equipo">
                        <div style="font-weight:600;font-size:0.88rem;">${s.brand} ${s.model}</div>
                        <small style="color:var(--text-muted);font-family:monospace;">${s.imei}</small>
                    </td>
                    <td data-label="Tienda"><span class="badge badge-primary">${s.store_name}</span></td>
                    <td data-label="Precio" class="text-right">
                        <div style="font-weight:700;color:var(--success)">${fmtLPS(s.final_price)}</div>
                        <small style="color:var(--text-muted)">${s.sale_type}</small>
                    </td>
                </tr>`).join('');
    } catch(e) { console.error('Recent sales error:', e); }
}

// ==========================================
// CAMERA QR/BARCODE SCANNER (FASE 3)
// ==========================================
let html5QrCode = null;

function openQrScanner() {
    openModal('qrScannerModal');
    setTimeout(() => {
        if (typeof Html5Qrcode !== 'undefined') {
            html5QrCode = new Html5Qrcode("reader");
            html5QrCode.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 260, height: 160 } },
                (decodedText) => {
                    onImeiScanned(decodedText.trim());
                },
                (errorMessage) => { /* ignore frame errors */ }
            ).catch(err => {
                console.error("Camera scan error:", err);
                showToast("No se pudo iniciar la cámara del dispositivo: " + err, true);
            });
        } else {
            showToast("Librería de escáner no disponible.", true);
        }
    }, 300);
}

function closeQrScanner() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(err => console.error(err));
    }
    closeModal('qrScannerModal');
}

function onImeiScanned(scannedImei) {
    closeQrScanner();
    showToast(`IMEI Escaneado: ${scannedImei}`);
    
    // Search in state.phones
    const targetPhone = state.phones.find(p => p.imei.toLowerCase() === scannedImei.toLowerCase());
    if (targetPhone) {
        setPosViewMode('grid');
        renderPosCards([targetPhone]);
        const cardEl = document.getElementById(`pos-card-${targetPhone.id}`);
        if (cardEl) {
            cardEl.classList.add('highlight-scanned');
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        showToast(`✅ Equipo local detectado: ${targetPhone.brand_name} ${targetPhone.model_name}`);
    } else {
        showToast(`⚠️ IMEI ${scannedImei} no encontrado en el inventario local de esta tienda.`, true);
    }
}

// ==========================================
// INTER-STORE SEARCH & TRANSFER REQUESTS (FASE 4)
// ==========================================
function openGlobalStoreSearchModal() {
    const select = document.getElementById('globalSearchModelSelect');
    if (select) {
        let modelOptions = '<option value="">-- Seleccionar Modelo del Catálogo --</option>';
        state.brands.forEach(b => {
            const mx = state.models.filter(m => m.brand_id === b.id);
            if (mx.length > 0) {
                modelOptions += `<optgroup label="${b.name}">`;
                mx.forEach(m => {
                    modelOptions += `<option value="${m.id}">${m.name} (${m.ram || ''} / ${m.storage || ''})</option>`;
                });
                modelOptions += `</optgroup>`;
            }
        });
        select.innerHTML = modelOptions;
    }
    const card = document.getElementById('globalSearchResultCard');
    if (card) card.style.display = 'none';
    openModal('globalSearchModal');
}

async function performGlobalStoreSearch() {
    const modelId = document.getElementById('globalSearchModelSelect').value;
    const card = document.getElementById('globalSearchResultCard');
    const tbody = document.querySelector('#globalStockTable tbody');
    if (!modelId) {
        if (card) card.style.display = 'none';
        return;
    }

    try {
        const res = await fetchAuth(`${API_URL}/phones/master-stock?model_id=${modelId}`);
        if (!res.ok) throw new Error('Error buscando existencias');
        const rows = await res.json();

        if (card) card.style.display = 'block';
        if (!tbody) return;

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:1rem;">Sin inventario físico en ninguna sucursal</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const isMyStore = currentStoreId && parseInt(currentStoreId) === r.store_id;
            const hasStock = r.stock_qty > 0;
            return `
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0.5rem; font-weight:600; color:var(--text-main);">
                        🏬 ${r.store_name} ${isMyStore ? '<span class="badge badge-primary" style="margin-left:0.4rem; font-size:0.7rem;">Mi Tienda</span>' : ''}
                    </td>
                    <td style="padding:0.75rem 0.5rem; text-align:center;">
                        <strong style="font-size:1.1rem; color:${hasStock ? 'var(--success)' : 'var(--danger)'};">${Number(r.stock_qty).toFixed(2)}</strong>
                    </td>
                    <td style="padding:0.75rem 0.5rem; text-align:right;">
                        ${(!isMyStore && hasStock) ? `
                            <button class="btn btn-secondary" style="padding:0.45rem 0.9rem; font-size:0.82rem; border-radius:8px;" onclick="requestTransfer(${modelId}, ${r.store_id}, '${r.store_name}')">
                                <i class="fas fa-paper-plane"></i> Solicitar Traslado
                            </button>
                        ` : (isMyStore ? '<span style="color:var(--text-muted); font-size:0.8rem;">En Tienda</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">Sin Stock</span>')}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) { showToast(err.message, true); }
}

async function requestTransfer(modelId, fromStoreId, fromStoreName) {
    try {
        const res = await fetchAuth(`${API_URL}/transfer-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_id: modelId, from_store_id: fromStoreId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast(`🚀 Solicitud de traslado enviada a ${fromStoreName}`);
    } catch (err) { showToast(err.message, true); }
}



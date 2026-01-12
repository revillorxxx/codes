let currentUserRole = 'admin';
let currentLuxImageBase64 = null;

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? ""
    : "https://premierluxinventory.onrender.com";

const API_URL = `${API_BASE}/api/inventory`;
const BRANCHES_API_URL = `${API_BASE}/api/branches`;
const ALERTS_API_URL = `${API_BASE}/api/alerts`;
const SUPPLIERS_API_URL = `${API_BASE}/api/suppliers`;
const ORDERS_API_URL = `${API_BASE}/api/orders`;
const REPLENISH_API_URL = `${API_BASE}/api/replenishment/recommendations`;

let dashBranchChart = null;
let dashCategoryChart = null;
let analyticsMainChart = null;
let stockInOutChart = null;
let analyticsSocket = null;
let lastAnalyticsPayload = null;
let currentAnalyticsBranch = 'All'
let pendingHighlightItem = null;
let currentOrderFilter = 'all';
let aiSuggestedOrders = [];
let currentProcurementTab = 'predictive';
let currentPredictionHorizon = 30;
let currentUser = null;

async function checkCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/api/me`, {
            credentials: 'include'
        });

        if (!res.ok) {
            doLogout();
            return;
        }

        currentUser = await res.json();


        updateDashboardHeader(currentUser);

        applyRolePermissions();
        console.log(`Authenticated as: ${currentUser.name} (${currentUser.role})`);
    } catch (err) {
        console.error("Auth check failed:", err);
    }
}

function updateDashboardHeader(user) {
    const welcomeEl = document.getElementById('dash-welcome');
    const roleBadge = document.getElementById('dash-role-badge');
    const branchInfo = document.getElementById('dash-branch-info');


    if (welcomeEl) {

        const firstName = user.name.split(' ')[0];
        welcomeEl.textContent = `Welcome, ${firstName}`;
    }

    if (roleBadge) {
        roleBadge.textContent = user.role;

        if (user.role === 'owner') {
            roleBadge.className = "px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-bold uppercase tracking-wider border border-purple-200";
        } else if (user.role === 'admin') {
            roleBadge.className = "px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider border border-blue-200";
        } else {
            roleBadge.className = "px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wider border border-slate-200";
        }
    }

    if (branchInfo) {
        const branchName = user.branch || 'Headquarters';
        branchInfo.textContent = `Logged in at ${branchName}`;
    }
}


function updateUserUI(user) {

    const navName = document.getElementById('nav-user-name');
    const navRole = document.getElementById('nav-user-role');

    if (navName) navName.textContent = user.name || "User";
    if (navRole) {

        const roleDisplay = user.role === 'staff'
            ? `${user.role} • ${user.branch}`
            : user.role;
        navRole.textContent = roleDisplay;
    }


    const mobName = document.getElementById('mob-user-name');
    const mobRole = document.getElementById('mob-user-role');

    if (mobName) mobName.textContent = user.name || "User";
    if (mobRole) mobRole.textContent = user.role;
}

function applyRolePermissions() {
    if (!currentUser) return;
    const role = currentUser.role;
    const adminMenu = document.getElementById('adminMenuBtn');
    const mobileAdminMenu = document.getElementById('mobileAdminMenu');
    const ownerSettingsBtn = document.getElementById('ownerSettingsBtn');
    const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
    const marketWidget = document.getElementById('lux-market-widget');
    const reqBtn = document.getElementById('btnRequestNewItem');

    if (role === 'staff') {
        if (adminMenu) adminMenu.classList.add('hidden');
        if (mobileAdminMenu) mobileAdminMenu.classList.add('hidden');
        if (marketWidget) marketWidget.classList.add('hidden');
        if (reqBtn) reqBtn.classList.remove('hidden');

        const addBranchBtn = document.querySelector('button[onclick*="openBranchModal"]');
        if (addBranchBtn) addBranchBtn.remove();

        const addSupplierBtn = document.querySelector('button[onclick*="openSupplierModal"]');
        if (addSupplierBtn) addSupplierBtn.remove();

        const desktopSupplierBtn = document.querySelector('button[onclick*="showPage(\'suppliers\')"]');
        if (desktopSupplierBtn) desktopSupplierBtn.classList.add('hidden');

        const mobileSupplierBtn = document.querySelector('#mobileProcurementSection button[onclick*="showPage(\'suppliers\')"]');
        if (mobileSupplierBtn) mobileSupplierBtn.classList.add('hidden');

        lockBranchUI(currentUser.branch);

    } else {

        if (adminMenu) adminMenu.classList.remove('hidden');
        if (mobileAdminMenu) mobileAdminMenu.classList.remove('hidden');
        if (marketWidget) marketWidget.classList.remove('hidden');
        if (reqBtn) reqBtn.classList.add('hidden');
        const desktopSupplierBtn = document.querySelector('button[onclick*="showPage(\'suppliers\')"]');
        if (desktopSupplierBtn) desktopSupplierBtn.classList.remove('hidden');

        const mobileSupplierBtn = document.querySelector('#mobileProcurementSection button[onclick*="showPage(\'suppliers\')"]');
        if (mobileSupplierBtn) mobileSupplierBtn.classList.remove('hidden');
    }

    if (role === 'owner') {
        if (ownerSettingsBtn) ownerSettingsBtn.classList.remove('hidden');
        if (mobileSettingsBtn) mobileSettingsBtn.classList.remove('hidden');
    } else {
        if (ownerSettingsBtn) ownerSettingsBtn.classList.add('hidden');
        if (mobileSettingsBtn) mobileSettingsBtn.classList.add('hidden');
    }
}

function lockBranchUI(branchName) {
    const btn = document.getElementById('branchDropdownBtn');
    const label = document.getElementById('branchLabel');
    const filter = document.getElementById('branchFilter');

    if (label) {
        label.innerHTML = `<i class="fas fa-lock text-[10px] mr-1 opacity-50"></i> ${branchName}`;
        if (btn) {
            btn.onclick = null;
            btn.classList.add('bg-slate-50', 'text-slate-400', 'cursor-not-allowed');
        }
        if (filter) filter.value = branchName;
    }
}


async function initDashboard() {
    console.log("Initializing Dashboard...");

    fetch(API_URL)
        .then(r => r.json())
        .then(invRes => {
            if (!Array.isArray(invRes)) invRes = [];

            const totalValue = invRes.reduce((acc, item) => acc + ((item.price || 0) * (item.quantity || 0)), 0);
            const lowStockItems = invRes.filter(item => (item.quantity || 0) <= (item.reorder_level || 0));

            const valEl = document.getElementById('dash-total-value');
            if (valEl) valEl.textContent = `₱${totalValue.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

            const lowEl = document.getElementById('dash-low-stock');
            if (lowEl) lowEl.textContent = lowStockItems.length;
            if (typeof renderGradientBranchChart === 'function') renderGradientBranchChart(invRes);
            if (typeof renderCategoryDoughnut === 'function') renderCategoryDoughnut(invRes);
            if (typeof renderRestockTable === 'function') renderRestockTable(lowStockItems);
        })
        .catch(e => console.error("Dash Inventory Error", e));
    fetch(BRANCHES_API_URL)
        .then(r => r.json())
        .then(branchRes => {
            const el = document.getElementById('dash-branches');
            if (el && Array.isArray(branchRes)) {
                el.textContent = branchRes.length;
            } else if (el) {
                el.textContent = "1";
            }
        })
        .catch(e => {
            console.error("Dash Branch Error", e);
            const el = document.getElementById('dash-branches');
            if (el) el.textContent = "-";
        });

    fetch(`${API_BASE}/api/ai/dashboard`)
        .then(r => r.json())
        .then(aiRes => {
            if (typeof applyAiDashboardToCards === 'function') applyAiDashboardToCards(aiRes);
        })
        .catch(e => console.error("Dash AI Error", e));

    const timeEl = document.getElementById('dash-timestamp');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const expiringCount = window.bellState?.expiringItems?.length || 0;
    const expEl = document.getElementById('dash-expiring');
    if (expEl) expEl.textContent = expiringCount;

    const mmExp = document.getElementById('mm-expiring');
    if (mmExp) mmExp.textContent = expiringCount;
    if (typeof switchProcurementTab === 'function') {
        switchProcurementTab('predictive');
    }
}

function renderRestockTable(lowStockItems) {
    const restockTable = document.getElementById('dash-restock-table');
    if (!restockTable) return;

    restockTable.innerHTML = '';
    const criticalItems = lowStockItems
        .sort((a, b) => ((a.quantity - a.reorder_level) - (b.quantity - b.reorder_level)))
        .slice(0, 5);

    if (criticalItems.length === 0) {
        restockTable.innerHTML = `<tr>
      <td colspan="3"
          class="px-6 py-8 text-center text-slate-400 text-xs font-medium">
        ✅ All stock levels healthy
      </td>
    </tr>`;
    } else {
        criticalItems.forEach(item => {
            const row = `
        <tr class="border-b border-slate-50 last:border-0 hover:bg-brand-50/50">
          <td class="px-4 md:px-6 py-3">
            <div class="font-bold text-slate-700 text-sm">${item.name}</div>
            <div class="md:hidden text-[10px] text-slate-400 font-medium">${item.branch}</div>
          </td>
          <td class="px-4 md:px-6 py-3 text-right font-bold text-rose-600">
            ${item.quantity}
          </td>
          <td class="px-4 md:px-6 py-3 text-center">
            <button onclick="openRestockModal('${item.name.replace(/'/g, "\\'")}', '${item.branch}', ${item.quantity})"
              class="bg-brand-50 text-brand-600 hover:bg-brand-600 hover:text-white
                     px-3 py-1.5 rounded-lg text-[10px] font-bold transition">
              Restock
            </button>
          </td>
        </tr>`;
            restockTable.innerHTML += row;
        });
    }
}

window.bellState = {
    lowStockItems: [],
    expiringItems: [],
    apiAlerts: []
};

window.toggleMenu = function (menuId) {
    const menu = document.getElementById(menuId);
    if (!menu) return;


    const isCurrentlyOpen = !menu.classList.contains('invisible');


    closeAllDropdowns();

    if (!isCurrentlyOpen) {
        menu.classList.remove('invisible', 'opacity-0');
    }
};


window.closeAllDropdowns = function () {
    document.querySelectorAll('.nav-dropdown').forEach(d => {
        d.classList.add('invisible', 'opacity-0');
    });
};

window.addEventListener('click', (e) => {
    const isInsideMenu = e.target.closest('[data-menu-root]');

    if (!isInsideMenu) {
        closeAllDropdowns();
    }
});

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
}

function showPage(page) {
    const sections = [
        'dashboard-section', 'inventory-section', 'branches-section',
        'orders-section', 'suppliers-section', 'compliance-section',
        'qr-section', 'admin-suppliers-section', 'admin-roles-section',
        'admin-logs-section', 'admin-accounts-section', 'analytics-section', 'admin-settings-section', 'finances-section'
    ];

    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    closeAllDropdowns();
    const target = document.getElementById(page + '-section');
    if (target) target.classList.remove('hidden');

    if (page === 'qr') {
        if (typeof stopQrScanner === 'function') stopQrScanner();
        const card = document.getElementById('qrResultCard');
        const empty = document.getElementById('qrEmptyState');
        if (card) card.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
    }

    if (page === 'dashboard') {
        initDashboard();
        fetchAlertsForBell();
        fetchBatchesForAlerts();
        fetchInventory();


        if (typeof fetchPriceInsights === 'function') {
            fetchPriceInsights();
        }
    }

    if (page === 'inventory') {
        fetchBranches(branches => {
            updateBranchSelect(branches);
        });
        fetchInventory();
    }

    if (page === 'branches') {
        fetchBranches();
    }

    if (page === 'suppliers') {
        fetchSuppliers();
    }

    if (page === 'orders') {
        fetchOrders();
    }

    if (page === 'analytics') {
        if (typeof initAnalyticsOverview === 'function') initAnalyticsOverview();
        if (typeof initAnalyticsSocket === 'function') initAnalyticsSocket();
        if (lastAnalyticsPayload && typeof drawAnalytics === 'function') {
            drawAnalytics(lastAnalyticsPayload);
        }
    }
    if (page === 'compliance') {
        fetchComplianceData();
    }
    if (page === 'admin-accounts') {
        fetchUsers();
    }
    if (page === 'admin-roles') {
        fetchRoleStats();
    }
    if (page === 'admin-settings') {
        initOwnerSettings();
    }

    if (page === 'analytics' || page === 'dashboard') {
        fetchPriceInsights();
    }

    if (page === 'finances') {
        fetchFinances();
    }
}

window.onload = function () {

    checkCurrentUser();
    const addBranchBtn = document.getElementById('addBranchBtn');
    if (addBranchBtn) addBranchBtn.addEventListener('click', saveBranch);

    showPage('dashboard');
    loadAiDashboard();
    setTimeout(() => {
        hideSplashScreen();
    }, 2500);
};

function renderGradientBranchChart(inventory) {
    const ctx = document.getElementById('dashBranchChart')?.getContext('2d');
    if (!ctx) return;

    const branchMap = {};
    inventory.forEach(item => {
        const val = (item.price || 0) * (item.quantity || 0);
        const branchName = item.branch || 'Unassigned';
        branchMap[branchName] = (branchMap[branchName] || 0) + val;
    });

    const labels = Object.keys(branchMap);
    const data = Object.values(branchMap);
    const wineColor = '#5E4074';
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, wineColor);
    gradient.addColorStop(0.8, 'rgba(94, 64, 116, 0.1)');

    if (dashBranchChart) dashBranchChart.destroy();

    dashBranchChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Stock Value',
                data: data,
                backgroundColor: gradient,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.5,
                categoryPercentage: 0.8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9', borderDash: [5, 5] }, ticks: { callback: (val) => '₱' + (val / 1000) + 'k' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderCategoryDoughnut(inventory) {
    const ctx = document.getElementById('dashCategoryChart')?.getContext('2d');
    if (!ctx) return;

    const catMap = {};
    inventory.forEach(item => {
        const cat = item.category || 'Uncategorized';
        catMap[cat] = (catMap[cat] || 0) + 1;
    });

    const labels = Object.keys(catMap);
    const data = Object.values(catMap);
    const totalItems = inventory.length;

    if (dashCategoryChart) dashCategoryChart.destroy();

    const textCenterPlugin = {
        id: 'textCenter',
        beforeDraw: function (chart) {
            const { ctx, chartArea: { top, bottom, left, right } } = chart;
            ctx.save();
            const centerX = (left + right) / 2;
            const centerY = (top + bottom) / 2;
            ctx.font = `900 2.5em sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = "#1e293b";
            ctx.fillText(totalItems, centerX, centerY - 10);
            ctx.font = "bold 0.7em sans-serif";
            ctx.fillStyle = "#94a3b8";
            ctx.fillText("TOTAL ITEMS", centerX, centerY + 15);
            ctx.restore();
        }
    };

    dashCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#5E4074',
                    '#8D6E9E',
                    '#C4B2D1',
                    '#B5A642',
                    '#64748b'
                ],
                borderWidth: 0,
                hoverOffset: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            layout: { padding: 10 },
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle', padding: 15 } }
            }
        },
        plugins: [textCenterPlugin]
    });
}


function fetchInventory() {

    const searchEl = document.getElementById('inventorySearch');
    const branchEl = document.getElementById('branchFilter');

    const search = searchEl ? searchEl.value : '';
    const branch = branchEl ? branchEl.value : 'All';

    let url = `${API_URL}?q=${encodeURIComponent(search)}`;
    if (branch !== 'All') url += `&branch=${encodeURIComponent(branch)}`;

    fetch(url)
        .then(res => res.json())
        .then(data => renderInventoryCards(data))
        .catch(err => console.error("Inventory Fetch Error:", err));
}

function renderInventoryCards(items) {
    const container = document.getElementById('inventoryCards');
    const emptyState = document.getElementById('inventoryEmptyState');
    if (!container) return;
    container.innerHTML = '';

    const currentBranch = document.getElementById('branchFilter')?.value || 'All';
    const searchInput = document.getElementById('inventorySearch');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    const visibleItems = items.filter(item => {
        if (currentBranch !== 'All' && currentBranch !== '' && item.branch !== currentBranch) return false;
        if (searchTerm && !item.name.toLowerCase().includes(searchTerm)) return false;
        return true;
    });

    if (visibleItems.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
    } else {
        if (emptyState) emptyState.classList.add('hidden');
    }

    visibleItems.forEach(item => {
        const card = document.createElement('div');
        const rawString = `${item.name}-${item.branch || 'general'}`;
        const uniqueId = rawString.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        card.id = `card-${uniqueId}`;
        card.className = "group relative flex flex-col justify-between rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer overflow-hidden h-full";
        card.onclick = () => openItemDetails(item);

        const isLow = (item.quantity || 0) <= (item.reorder_level || 0);
        const safeName = item.name.replace(/'/g, "\\'");
        const safeBranch = (item.branch || '').replace(/'/g, "\\'");

        card.innerHTML = `
          <div class="h-1 w-full ${isLow ? 'bg-rose-500' : 'bg-brand-600'}"></div>
          
          <div class="p-4 flex-1 flex flex-col">
              <div class="flex justify-between items-start mb-3">
                  <div class="max-w-[70%]">
                      <h3 class="font-bold text-slate-800 text-sm leading-tight group-hover:text-brand-600 transition-colors truncate">${item.name}</h3>
                      <span class="inline-flex px-1.5 py-0.5 rounded bg-brand-50 border border-brand-100 text-[9px] font-bold text-brand-600 uppercase tracking-wider mt-1">${item.branch || 'General'}</span>
                  </div>
                  <div class="text-right">
                      <span class="text-xl font-black ${isLow ? 'text-rose-600' : 'text-slate-700'} tracking-tight">${item.quantity || 0}</span>
                      <span class="block text-[8px] text-slate-400 font-bold uppercase">Stock</span>
                  </div>
              </div>

              <div class="grid grid-cols-2 gap-2 mb-4">
                  <div class="bg-slate-50/50 rounded-lg p-1.5 border border-slate-100">
                      <span class="block text-[8px] uppercase text-slate-400 font-bold">Category</span>
                      <span class="text-[10px] font-semibold text-slate-600 truncate block">${item.category || '-'}</span>
                  </div>
                   <div class="bg-slate-50/50 rounded-lg p-1.5 border border-slate-100">
                      <span class="block text-[8px] uppercase text-slate-400 font-bold">Reorder</span>
                      <span class="text-[10px] font-semibold text-slate-600">${item.reorder_level || 0}</span>
                  </div>
              </div>

              <div class="mt-auto grid grid-cols-[1fr_1fr_auto] gap-2 pt-3 border-t border-slate-50">
                <button onclick="event.stopPropagation(); openEditStockModal('${safeName}', '${safeBranch}', ${item.quantity || 0})" 
                    class="py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-bold hover:bg-brand-50 hover:text-brand-900 transition">
                    Edit
                </button>
                <button onclick="event.stopPropagation(); openRestockModal('${safeName}', '${safeBranch}', ${item.quantity || 0})" 
                    class="py-1.5 rounded-lg bg-brand-600 text-white text-[10px] font-bold shadow-sm hover:bg-brand-700 transition">
                    Order
                </button>
                <button onclick="event.stopPropagation(); confirmDelete('${safeName}')" 
                    class="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-400 hover:bg-rose-500 hover:text-white transition">
                    <i class="fas fa-trash-alt text-[9px]"></i>
                </button>
            </div>
          </div>`;

        container.appendChild(card);

        if (window.pendingHighlight && window.pendingHighlight.id === uniqueId) {
            setTimeout(() => {
                const target = document.getElementById(`card-${uniqueId}`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('highlight-pulse', 'ring-4', 'ring-amber-400', 'ring-offset-2');

                    setTimeout(() => {
                        target.classList.remove('highlight-pulse', 'ring-4', 'ring-amber-400', 'ring-offset-2');
                    }, 3000);
                }
            }, 600);
            window.pendingHighlight = null;
        }
    });
}


function confirmDelete(name) {
    openDeleteModal('inventory', name);
}

function deleteItem(name) {
    fetch(`${API_URL}/${encodeURIComponent(name)}`, { method: 'DELETE' })
        .then(() => { fetchInventory(); initDashboard(); });
}

function toggleBranchMenu() {
    const menu = document.getElementById('branchDropdownOptions');
    if (menu) menu.classList.toggle('hidden');
}

function selectBranch(value, label) {
    document.getElementById('branchFilter').value = value;
    const labelEl = document.getElementById('branchLabel');
    if (labelEl) labelEl.textContent = label;
    document.getElementById('branchDropdownOptions').classList.add('hidden');
    fetchInventory();
}

function updateBranchSelect(branches) {
    const container = document.getElementById('branchDropdownOptions');
    if (!container) return;
    container.innerHTML = '';
    container.innerHTML += `
        <button onclick="selectBranch('All', 'All branches')" 
            class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-bold text-slate-700 hover:bg-[#7D8C7D]/20 hover:text-brand-600 transition">
            All branches
        </button>`;
    branches.forEach(b => {
        container.innerHTML += `
            <button onclick="selectBranch('${b.name}', '${b.name}')" 
                class="w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-[#7D8C7D]/20 hover:text-brand-600 transition">
                ${b.name}
            </button>`;
    });
}

window.addEventListener('click', (e) => {

    const isInsideNav = e.target.closest('[data-menu-root]');
    if (!isInsideNav) closeAllDropdowns();

    const iBtn = document.getElementById('branchDropdownBtn');
    const iMenu = document.getElementById('branchDropdownOptions');
    if (iBtn && iMenu && !iBtn.contains(e.target) && !iMenu.contains(e.target)) iMenu.classList.add('hidden');

    const rBtn = document.getElementById('restockSupplierBtn');
    const rMenu = document.getElementById('restockSupplierOptions');
    if (rBtn && rMenu && !rBtn.contains(e.target) && !rMenu.contains(e.target)) rMenu.classList.add('hidden');

    const bBranchBtn = document.getElementById('batchBranchBtn');
    const bBranchMenu = document.getElementById('batchBranchOptions');
    if (bBranchBtn && bBranchMenu && !bBranchBtn.contains(e.target) && !bBranchMenu.contains(e.target)) bBranchMenu.classList.add('hidden');

    const bCatBtn = document.getElementById('batchCategoryBtn');
    const bCatMenu = document.getElementById('batchCategoryOptions');
    if (bCatBtn && bCatMenu && !bCatBtn.contains(e.target) && !bCatMenu.contains(e.target)) bCatMenu.classList.add('hidden');

    const eActBtn = document.getElementById('editActionBtn');
    const eActMenu = document.getElementById('editActionOptions');
    if (eActBtn && eActMenu && !eActBtn.contains(e.target) && !eActMenu.contains(e.target)) eActMenu.classList.add('hidden');

    const eReaBtn = document.getElementById('editReasonBtn');
    const eReaMenu = document.getElementById('editReasonOptions');
    if (eReaBtn && eReaMenu && !eReaBtn.contains(e.target) && !eReaMenu.contains(e.target)) eReaMenu.classList.add('hidden');

    const uRoleBtn = document.getElementById('roleDropdownBtn');
    const uRoleMenu = document.getElementById('roleDropdownOptions');
    if (uRoleBtn && uRoleMenu && !uRoleBtn.contains(e.target) && !uRoleMenu.contains(e.target)) uRoleMenu.classList.add('hidden');

    const uBranchBtn = document.getElementById('userBranchBtn');
    const uBranchMenu = document.getElementById('userBranchOptions');
    if (uBranchBtn && uBranchMenu && !uBranchBtn.contains(e.target) && !uBranchMenu.contains(e.target)) uBranchMenu.classList.add('hidden');
});

function handleNotificationClick(itemName, branchName) {
    console.log(`Navigating to: ${itemName} (${branchName})`);
    closeAllDropdowns();

    const rawString = `${itemName}-${branchName || 'general'}`;
    const cleanId = rawString.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    window.pendingHighlight = { id: cleanId };
    showPage('inventory');
    const branchSelect = document.getElementById('branchFilter');
    if (branchSelect) {
        branchSelect.value = 'All';
        document.getElementById('branchLabel').textContent = 'All branches';
    }

    fetchInventory();
}

async function fetchActivityLogs() {
    const tbody = document.getElementById('activityLogsTableBody');
    const tableHeader = document.querySelector('#admin-logs-section thead');

    if (!tbody) return;
    if (tableHeader) {
        tableHeader.className = "bg-purple-50 border-b border-purple-100";
        tableHeader.querySelectorAll('th').forEach(th => {
            th.className = "px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider";
        });
    }

    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10"><i class="fas fa-circle-notch fa-spin text-purple-500"></i> Syncing...</td></tr>';

    try {
        const res = await fetch(`${API_BASE}/api/admin/activity-logs`, { credentials: 'include' });
        const logs = await res.json();

        tbody.innerHTML = '';
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-slate-400">No recent activity.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const date = new Date(log.timestamp).toLocaleString();
            const badgeClass = "bg-purple-100 text-purple-800 border border-purple-200";

            tbody.innerHTML += `
            <tr class="hover:bg-purple-50/30 transition border-b border-gray-100 last:border-0">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-medium font-mono">
                    ${date}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-800">
                    ${log.user}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${badgeClass}">
                        ${log.action}
                    </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600">
                    ${log.details}
                </td>
            </tr>`;
        });
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-rose-500">Error loading logs.</td></tr>';
    }
}

function fetchAlertsForBell() {
    fetch(ALERTS_API_URL, { credentials: 'include' })
        .then(res => res.json())
        .then(alerts => {
            if (window.updateApiAlerts) window.updateApiAlerts(alerts);
            renderSharedBell();
        })
        .catch(err => console.error('Error fetching alerts:', err));
}

async function acknowledgeAlert(alertId, itemName, branchName) {
    try {
        const res = await fetch(`${API_BASE}/api/alerts/${alertId}/acknowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                log_detail: `User dismissed alert for ${itemName} - ${branchName}`
            }),
            credentials: 'include'
        });

        if (res.ok) {
            showToast("Alert Acknowledged & Logged");
            const dismissed = JSON.parse(localStorage.getItem('premierlux_dismissed') || '[]');
            if (!dismissed.includes(alertId)) {
                dismissed.push(alertId);
                localStorage.setItem('premierlux_dismissed', JSON.stringify(dismissed));
            }

            window.bellState.apiAlerts = window.bellState.apiAlerts.filter(a => a.id !== alertId);
            window.bellState.lowStockItems = window.bellState.lowStockItems.filter(i => i.name !== alertId);
            window.bellState.expiringItems = window.bellState.expiringItems.filter(i => {
                const iId = i.id || i._id || i.batch_number || 'unknown';
                return iId !== alertId;
            });

            renderSharedBell();
        }
    } catch (err) {
        console.error("Acknowledge Error:", err);
    }
}

function renderSharedBell() {
    const alertBadge = document.getElementById('alertsBadge');
    const desktopList = document.getElementById('alertsDropdownList');
    const mobileList = document.getElementById('mobileAlertsList');

    if (!desktopList && !mobileList) return;

    const lowCount = window.bellState.lowStockItems.length;
    const expCount = window.bellState.expiringItems.length;
    const apiCount = window.bellState.apiAlerts.length;
    const totalAlerts = lowCount + expCount + apiCount;

    if (alertBadge) {
        alertBadge.textContent = totalAlerts > 9 ? '9+' : totalAlerts;
        if (totalAlerts > 0) {
            alertBadge.classList.remove('hidden');
            alertBadge.classList.add('animate-pulse');
        } else {
            alertBadge.classList.add('hidden');
        }
    }

    const mmAlertCount = document.getElementById('mm-alert-count');
    if (mmAlertCount) mmAlertCount.textContent = totalAlerts;

    const appendContent = (html) => {
        if (desktopList) desktopList.innerHTML += html;
        if (mobileList) mobileList.innerHTML += html;
    };

    if (desktopList) desktopList.innerHTML = '';
    if (mobileList) mobileList.innerHTML = '';
    if (totalAlerts === 0) {
        const emptyHtml = `
            <div class="flex flex-col items-center justify-center py-8 text-slate-400 opacity-60">
                <span class="text-2xl mb-2">🎉</span>
                <span class="text-xs font-bold uppercase tracking-wide">All caught up!</span>
            </div>`;
        if (desktopList) desktopList.innerHTML = emptyHtml;
        if (mobileList) mobileList.innerHTML = emptyHtml;
        return;
    }

    window.bellState.expiringItems.forEach(item => {
        const daysLeft = item.daysLeft;
        const badgeColor = daysLeft < 0 ? "bg-red-100 text-red-600 border border-red-200" : "bg-orange-100 text-orange-600 border border-orange-200";
        const badgeText = daysLeft < 0 ? "Expired" : "Expiring";
        const detailText = daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft} days left`;

        const itemId = item.id || item._id || item.batch_number || 'unknown';
        const safeName = (item.item_name || 'Item').replace(/'/g, "\\'");
        const safeBranch = (item.branch || 'General').replace(/'/g, "\\'");

        appendContent(createNotificationRow(
            badgeText, item.branch, item.item_name, detailText, badgeColor,
            `acknowledgeAlert('${itemId}', '${safeName}', '${safeBranch}')`
        ));
    });

    window.bellState.lowStockItems.forEach(item => {

        const safeName = (item.name || 'Item').replace(/'/g, "\\'");
        const safeBranch = (item.branch || 'General').replace(/'/g, "\\'");

        appendContent(createNotificationRow(
            "Low Stock", item.branch, item.name, `${item.quantity} units remaining`,
            "bg-rose-100 text-rose-600 border border-rose-200",
            `acknowledgeAlert('${item.name}', '${safeName}', '${safeBranch}')`
        ));
    });

    window.bellState.apiAlerts.forEach(alert => {
        const safeTitle = (alert.title || 'System Alert').replace(/'/g, "\\'");

        appendContent(createNotificationRow(
            "System", "Admin", alert.title, "Action Required",
            "bg-[#7D8C7D]/20 text-[#5E4074] border border-[#7D8C7D]/30",
            `acknowledgeAlert('${alert.id}', '${safeTitle}', 'System')`
        ));
    });
}

function createNotificationRow(type, branch, item, detail, colorClass, btnCallback) {
    const safeItem = (item || 'Unknown Item').toString().replace(/'/g, "\\'");
    const safeBranch = (branch || 'General').toString().replace(/'/g, "\\'");

    return `
    <div class="group mb-2 bg-white border border-slate-100 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
        <div class="flex items-center justify-between px-3 py-2 bg-slate-50/50 border-b border-slate-100">
            <div class="flex items-center gap-2 overflow-hidden">
                <span class="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${colorClass}">
                    ${type}
                </span>
                <span class="text-[10px] text-slate-400 font-bold truncate max-w-[100px]" title="${branch}">
                    ${branch || 'General'}
                </span>
            </div>
            <button onclick="${btnCallback}; event.stopPropagation();" 
                class="text-slate-300 hover:text-[#5E4074] hover:bg-slate-100 p-1.5 rounded-full transition-colors" 
                title="Mark as Read">
                <i class="fas fa-check text-xs"></i>
            </button>
        </div>
        <div onclick="handleNotificationClick('${safeItem}', '${safeBranch}')"
       class="px-3 py-2.5 cursor-pointer hover:bg-#F5F0F9 transition-colors group-hover:border-l-4 group-hover;border-l-5E4074">
            <div class="flex flex-col">
                <span class="text-xs font-bold text-slate-700 leading-tight mb-0.5">${item || 'Unknown Item'}</span>
                <span class="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                    <i class="fas fa-info-circle text-[8px] opacity-70"></i> ${detail}
                </span>
            </div>
        </div>
    </div>`;
}

window.updateLowStock = function (data) {
    if (!data) return;
    const dismissed = JSON.parse(localStorage.getItem('premierlux_dismissed') || '[]');

    window.bellState.lowStockItems = data.filter(i => {
        const isLow = (i.quantity || 0) <= (i.reorder_level || 0);
        const isDismissed = dismissed.includes(i.name);
        return isLow && !isDismissed;
    });

    renderSharedBell();
};

window.updateApiAlerts = function (alerts) {
    if (!alerts) return;
    window.bellState.apiAlerts = alerts.filter(a => a.type !== 'low_stock' && a.type !== 'expiry_risk');
    renderSharedBell();
};

window.updateExpiryAndBell = function (batchData) {
    if (!batchData || !Array.isArray(batchData)) return;
    const today = new Date();
    const dismissed = JSON.parse(localStorage.getItem('premierlux_dismissed') || '[]');

    window.bellState.expiringItems = [];
    batchData.forEach(item => {
        const dateString = item.exp_date || item.expiration_date;
        if (dateString) {
            const expDate = new Date(dateString);
            if (!isNaN(expDate)) {
                const diffTime = expDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const itemId = item.id || item._id || item.batch_number || 'unknown';

                if (diffDays <= 30 && !dismissed.includes(itemId)) {
                    window.bellState.expiringItems.push({ ...item, daysLeft: diffDays });
                }
            }
        }
    });

    const dashExpiringEl = document.getElementById('dash-expiring');
    if (dashExpiringEl) {
        dashExpiringEl.textContent = window.bellState.expiringItems.length;
    }
    renderSharedBell();
};

function fetchBatchesForAlerts() {
    fetch(`${API_BASE}/api/batches`)
        .then(r => r.json())
        .then(data => {
            if (window.updateExpiryAndBell) {
                window.updateExpiryAndBell(data);
            }
        })
        .catch(err => console.error("Error fetching batches for alerts:", err));
}

function openBatchOverlay() {
    const overlay = document.getElementById('batchOverlay');
    if (overlay) overlay.classList.remove('hidden');

    const btn = document.getElementById('batchBranchBtn');
    const label = document.getElementById('batchBranchLabel');
    const input = document.getElementById('batch_branch');

    if (currentUser && currentUser.role === 'staff') {
        if (input) input.value = currentUser.branch;
        if (btn) {
            btn.onclick = null;
            btn.classList.add('bg-slate-50', 'text-slate-400', 'cursor-not-allowed');
            btn.classList.remove('bg-white', 'text-slate-700');
            btn.innerHTML = `<span id="batchBranchLabel" class="flex items-center gap-2"><i class="fas fa-lock text-[10px]"></i> ${currentUser.branch}</span>`;
        }

    } else {

        if (btn) {
            btn.onclick = toggleBatchBranchMenu;
            btn.classList.remove('bg-slate-50', 'text-slate-400', 'cursor-not-allowed');
            btn.classList.add('bg-white', 'text-slate-700');

            if (input && !input.value) {
                btn.innerHTML = `<span id="batchBranchLabel">Select...</span> ▼`;
            }
        }

        fetchBranches(branches => {
            if (typeof updateBranchSelect === 'function') updateBranchSelect(branches);
            updateBatchBranchSelect(branches);
        });
    }
}

function closeBatchOverlay() {
    document.getElementById('batchOverlay').classList.add('hidden');
}

function updateBatchBranchSelect(branches) {
    const container = document.getElementById('batchBranchOptions');
    if (!container) return;
    container.innerHTML = '';
    branches.forEach(b => {
        container.innerHTML += `
            <button type="button" onclick="selectBatchBranch('${b.name}')" 
                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-[#7D8C7D]/20 hover:text-brand-600 transition">
                ${b.name}
            </button>`;
    });
}

function toggleBatchBranchMenu() {
    const menu = document.getElementById('batchBranchOptions');
    if (menu) menu.classList.toggle('hidden');
}

function selectBatchBranch(branchName) {
    document.getElementById('batch_branch').value = branchName;
    const label = document.getElementById('batchBranchLabel');
    if (label) {
        label.textContent = branchName;
        label.classList.remove('text-slate-400');
        label.classList.add('text-slate-800');
    }
    document.getElementById('batchBranchOptions').classList.add('hidden');
}

async function submitBatchForm(e) {
    e.preventDefault();

    const branchValue = document.getElementById('batch_branch').value;
    const itemName = document.getElementById('batch_item_name').value;

    if (!branchValue) {
        alert("Please select a branch first.");
        return;
    }
    if (!itemName) {
        alert("Item name is required.");
        return;
    }


    const payload = {
        item_name: itemName,
        branch: branchValue,
        sku: document.getElementById('batch_sku').value,
        monthly_usage: Number(document.getElementById('batch_monthly_usage').value),
        current_stock: Number(document.getElementById('batch_current_stock').value),
        reorder_level: Number(document.getElementById('batch_reorder_level').value),
        price: Number(document.getElementById('batch_price').value),
        batch_number: document.getElementById('batch_batch_number').value,
        lot_number: document.getElementById('batch_lot_number').value,
        mfg_date: document.getElementById('batch_mfg_date').value,
        exp_date: document.getElementById('batch_exp_date').value,
        supplier_batch: document.getElementById('batch_supplier_batch').value,
        qr_code_id: document.getElementById('batch_qr_code_id').value,
        category: document.getElementById('itemCategory').value
    };

    try {
        const res = await fetch(`${API_BASE}/api/batches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "Failed to add batch");
        }

        showToast('Batch successfully added!');
        closeBatchOverlay();

        fetchInventory();
        fetchBatchesForAlerts();
        if (typeof initDashboard === 'function') initDashboard();

        document.getElementById('batchForm').reset();
        document.getElementById('batchBranchLabel').textContent = "Select branch...";
        document.getElementById('batch_branch').value = "";

    } catch (err) {
        console.error(err);
        alert(err.message);
    }
}

function toggleBatchCategoryMenu() {
    const menu = document.getElementById('batchCategoryOptions');
    document.getElementById('batchBranchOptions').classList.add('hidden');
    if (menu) menu.classList.toggle('hidden');
}

function selectBatchCategory(value) {
    document.getElementById('itemCategory').value = value;
    document.getElementById('batchCategoryLabel').textContent = value;
    document.getElementById('batchCategoryOptions').classList.add('hidden');
}

function toggleEditActionMenu() {
    const menu = document.getElementById('editActionOptions');
    document.getElementById('editReasonOptions').classList.add('hidden');
    if (menu) menu.classList.toggle('hidden');
}

function selectEditAction(value, label) {
    document.getElementById('edit_action').value = value;
    document.getElementById('editActionLabel').textContent = label;
    document.getElementById('editActionOptions').classList.add('hidden');
}

function toggleEditReasonMenu() {
    const menu = document.getElementById('editReasonOptions');
    document.getElementById('editActionOptions').classList.add('hidden');
    if (menu) menu.classList.toggle('hidden');
}

function selectEditReason(value, label) {
    document.getElementById('edit_reason_cat').value = value;
    document.getElementById('editReasonLabel').textContent = label;
    document.getElementById('editReasonOptions').classList.add('hidden');
}

async function openRestockModal(itemName, branchName, currentQty) {
    const modal = document.getElementById('restockOverlay');
    if (!modal) return;

    document.getElementById('restock_item_name').textContent = itemName;
    document.getElementById('restock_branch').textContent = branchName;
    document.getElementById('restock_current').value = currentQty;
    document.getElementById('restock_qty').value = '';
    document.getElementById('restock_supplier').value = '';
    document.getElementById('restockSupplierLabel').textContent = 'Select Supplier...';

    try {
        const res = await fetch(SUPPLIERS_API_URL);
        const suppliers = await res.json();
        updateRestockSupplierSelect(suppliers);
    } catch (err) {
        console.error(err);
    }
    modal.classList.remove('hidden');
}

function updateRestockSupplierSelect(suppliers) {
    const container = document.getElementById('restockSupplierOptions');
    if (!container) return;
    container.innerHTML = '';
    if (suppliers.length === 0) container.innerHTML = `<div class="p-2 text-xs text-slate-400">No suppliers found.</div>`;
    else suppliers.forEach(s => {
        container.innerHTML += `
            <button type="button" onclick="selectRestockSupplier('${s.name}')" 
                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-[#7D8C7D]/20 hover:text-brand-600 transition flex justify-between items-center">
                <span>${s.name}</span><span class="text-[10px] text-slate-400">${s.lead_time_days || '?'} days</span>
            </button>`;
    });
}

function toggleRestockSupplierMenu() {
    document.getElementById('restockSupplierOptions').classList.toggle('hidden');
}

function selectRestockSupplier(name) {
    document.getElementById('restock_supplier').value = name;
    document.getElementById('restockSupplierLabel').textContent = name;
    document.getElementById('restockSupplierOptions').classList.add('hidden');
}

function closeRestockModal() {
    document.getElementById('restockOverlay').classList.add('hidden');
}

function handleRestockOutsideClick(e) {
    if (e.target.id === 'restockOverlay') closeRestockModal();
}

async function submitRestockRequest(e) {
    e.preventDefault();
    const payload = {
        item: document.getElementById('restock_item_name').textContent,
        branch: document.getElementById('restock_branch').textContent,
        quantity: parseInt(document.getElementById('restock_qty').value),
        supplier: document.getElementById('restock_supplier').value,
        priority: document.querySelector('input[name="priority"]:checked').value,
        notes: document.getElementById('restock_notes').value,
        status: 'pending',
        created_at: new Date().toISOString()
    };

    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = "Sending...";
    btn.disabled = true;

    try {
        const res = await fetch(ORDERS_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error("Failed");
        closeRestockModal();
        showToast("Order sent!");
        if (!document.getElementById('orders-section').classList.contains('hidden')) fetchOrders();
    } catch (err) {
        alert(err.message);
    } finally {
        btn.textContent = "Submit Request";
        btn.disabled = false;
    }
}

async function fetchSuppliers() {
    try {
        const res = await fetch(SUPPLIERS_API_URL);
        const data = await res.json();
        renderSupplierCards(data);
    } catch (e) { console.error("Fetch Error:", e); }
}

function renderSupplierCards(suppliers) {
    const grid = document.getElementById('suppliersGrid');
    if (!grid) return;
    grid.innerHTML = '';

    suppliers.forEach(s => {
        const initial = s.name.charAt(0).toUpperCase();
        const safeName = s.name.replace(/'/g, "\\'");

        grid.innerHTML += `
        <div class="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all group flex flex-col h-full">
            <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                    <div class="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center text-white text-base font-bold shadow-sm shrink-0">
                        ${initial}
                    </div>
                    <div class="overflow-hidden">
                        <h3 class="font-bold text-brand-900 text-sm truncate" title="${s.name}">${s.name}</h3>
                        <p class="text-[10px] text-slate-500 truncate">${s.contact || 'No contact'}</p>
                    </div>
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="openEditSupplier('${safeName}')" class="p-1.5 text-slate-400 hover:text-brand-600 rounded-lg transition"><i class="fas fa-edit text-xs"></i></button>
                    <button onclick="deleteSupplier('${safeName}')" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition"><i class="fas fa-trash-alt text-xs"></i></button>
                </div>
            </div>

            <div class="bg-brand-50/50 p-2 rounded-xl border border-brand-50 mb-3">
                <span class="block text-[8px] text-slate-400 uppercase font-bold mb-0.5">Lead Time</span>
                <span class="text-xs font-semibold text-brand-700">${s.lead_time_days || '-'} Days</span>
            </div>
            
            <div class="mt-auto pt-2">
                <button onclick="openRestockFromSupplier('${safeName}')" 
                    class="w-full py-2 rounded-xl bg-white border border-slate-200 text-brand-600 text-[10px] font-bold hover:bg-brand-600 hover:text-white transition">
                    Create Order
                </button>
            </div>
        </div>`;
    });
}

function openEditSupplier(name, contact, phone, lead, website, notes) {
    currentEditSupplier = name;

    document.getElementById('supplierModalTitle').textContent = "Edit Supplier";
    document.getElementById('supplierSubmitBtn').textContent = "Save Changes";
    document.getElementById('new_supp_name').value = name;
    document.getElementById('new_supp_name').disabled = true;

    document.getElementById('new_supp_contact').value = (contact && contact !== 'undefined') ? contact : '';
    document.getElementById('new_supp_phone').value = (phone && phone !== 'undefined') ? phone : '';
    document.getElementById('new_supp_lead').value = lead || 0;
    document.getElementById('new_supp_website').value = (website && website !== 'undefined') ? website : '';
    document.getElementById('new_supp_notes').value = (notes && notes !== 'undefined') ? notes.replace(/\\n/g, "\n") : '';

    document.getElementById('supplierOverlay').classList.remove('hidden');
}

function openSupplierModal() {
    currentEditSupplier = null;

    document.getElementById('supplierModalTitle').textContent = "New Supplier";
    document.getElementById('supplierSubmitBtn').textContent = "Add Supplier";

    document.getElementById('new_supp_name').disabled = false;
    document.getElementById('new_supp_name').value = '';
    document.getElementById('new_supp_contact').value = '';
    document.getElementById('new_supp_phone').value = '';
    document.getElementById('new_supp_lead').value = '';
    document.getElementById('new_supp_website').value = '';
    document.getElementById('new_supp_notes').value = '';

    document.getElementById('supplierOverlay').classList.remove('hidden');
}

function closeSupplierModal() {
    const overlay = document.getElementById('supplierOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function handleSupplierOutsideClick(e) {
    if (e.target.id === 'supplierOverlay') closeSupplierModal();
}

async function submitSupplierForm(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('new_supp_name').value,
        contact: document.getElementById('new_supp_contact').value,
        phone: document.getElementById('new_supp_phone').value,
        lead_time_days: Number(document.getElementById('new_supp_lead').value),
        website: document.getElementById('new_supp_website').value,
        notes: document.getElementById('new_supp_notes').value
    };

    try {
        let url = SUPPLIERS_API_URL;
        let method = 'POST';

        if (currentEditSupplier) {
            url = `${SUPPLIERS_API_URL}/${encodeURIComponent(currentEditSupplier)}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Failed");

        closeSupplierModal();
        fetchSuppliers();
        showToast(currentEditSupplier ? "Supplier updated" : "Supplier saved");

    } catch (err) { alert(err.message); }
}

function deleteSupplier(name) {
    openDeleteModal('supplier', name);
}

let currentEditSupplier = null;

function openEditSupplier(name, contact, phone, lead) {
    currentEditSupplier = name;

    document.getElementById('supplierModalTitle').textContent = "Edit Supplier";
    document.getElementById('supplierSubmitBtn').textContent = "Save Changes";

    document.getElementById('new_supp_name').value = name;
    document.getElementById('new_supp_name').disabled = true;
    document.getElementById('new_supp_contact').value = contact !== 'undefined' ? contact : '';
    document.getElementById('new_supp_phone').value = phone !== 'undefined' ? phone : '';
    document.getElementById('new_supp_lead').value = lead || 0;

    document.getElementById('supplierOverlay').classList.remove('hidden');
}

function openSupplierModal() {

    currentEditSupplier = null;
    document.getElementById('supplierModalTitle').textContent = "New Supplier";
    document.getElementById('supplierSubmitBtn').textContent = "Add Supplier";
    document.getElementById('new_supp_name').disabled = false;
    document.getElementById('new_supp_name').value = '';
    document.getElementById('new_supp_contact').value = '';
    document.getElementById('new_supp_phone').value = '';
    document.getElementById('new_supp_lead').value = '';

    document.getElementById('supplierOverlay').classList.remove('hidden');
}

async function submitSupplierForm(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('new_supp_name').value,
        contact: document.getElementById('new_supp_contact').value,
        phone: document.getElementById('new_supp_phone').value,
        lead_time_days: Number(document.getElementById('new_supp_lead').value)
    };

    try {
        let url = SUPPLIERS_API_URL;
        let method = 'POST';
        if (currentEditSupplier) {
            url = `${SUPPLIERS_API_URL}/${encodeURIComponent(currentEditSupplier)}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Failed");

        closeSupplierModal();
        fetchSuppliers();
        showToast(currentEditSupplier ? "Supplier updated" : "Supplier saved");

    } catch (err) { alert(err.message); }
}

function handleSupplierOutsideClick(e) {
    if (e.target.id === 'supplierOverlay') {
        closeSupplierModal();
    }
}

function openRestockFromSupplier(supplierName) {
    openRestockModal('', '', 0);
    setTimeout(() => {
        const select = document.getElementById('restock_supplier');
        const label = document.getElementById('restockSupplierLabel');
        if (select) select.value = supplierName;
        if (label) label.textContent = supplierName;
    }, 100);
}

function filterOrders(status) {
    currentOrderFilter = status;

    document.querySelectorAll('.order-filter-btn').forEach(btn => {
        btn.classList.remove('bg-brand-50', 'text-brand-700', 'border-brand-200');
        btn.classList.add('bg-white', 'text-slate-600', 'border-slate-200');

        if (btn.textContent.toLowerCase().includes(status) || (status === 'all' && btn.textContent === 'All')) {
            btn.classList.remove('bg-white', 'text-slate-600', 'border-slate-200');
            btn.classList.add('bg-brand-50', 'text-brand-700', 'border-brand-200');
        }
    });

    fetchOrders();
}

async function fetchOrders() {
    try {
        const res = await fetch(`${ORDERS_API_URL}`);
        if (!res.ok) throw new Error("Failed to fetch orders");
        const orders = await res.json();

        const tbody = document.getElementById('ordersTableBody');
        const searchVal = document.getElementById('orderSearch')?.value.toLowerCase() || "";
        tbody.innerHTML = "";

        let hasOrders = false;

        orders.forEach(order => {

            if (currentOrderFilter !== 'all' && order.status !== currentOrderFilter) return;
            if (currentOrderFilter === 'received' && (order.status !== 'received' && order.status !== 'rejected')) return;

            const searchStr = `${order.item} ${order.branch} ${order.supplier}`.toLowerCase();
            if (searchVal && !searchStr.includes(searchVal)) return;

            hasOrders = true;
            let statusBadge = '';
            let actionButtons = '';

            switch (order.status) {
                case 'pending':
                    statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-100"><i class="fas fa-clock"></i> Pending</span>`;
                    if (currentUserRole === 'owner' || currentUserRole === 'admin') {
                        actionButtons = `
                            <button onclick="updateOrderStatus('${order._id}', 'approved')" class="text-xs text-brand-600 hover:bg-brand-50 p-2 rounded-lg transition" title="Approve"><i class="fas fa-check"></i></button>
                            <button onclick="updateOrderStatus('${order._id}', 'rejected')" class="text-xs text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition" title="Reject"><i class="fas fa-times"></i></button>
                        `;
                    } else {
                        actionButtons = `<span class="text-[10px] text-slate-400 italic">Waiting approval</span>`;
                    }
                    break;

                case 'approved':
                    statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100"><i class="fas fa-thumbs-up"></i> Approved</span>`;
                    actionButtons = `
                        <button onclick="updateOrderStatus('${order._id}', 'received')" class="text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg shadow-sm transition">
                           <i class="fas fa-box-open mr-1"></i> Receive Stock
                        </button>
                    `;
                    break;

                case 'received':
                    statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100"><i class="fas fa-check-circle"></i> Received</span>`;
                    actionButtons = `<span class="text-emerald-600 text-[10px] font-bold"><i class="fas fa-check"></i> Complete</span>`;
                    break;

                case 'rejected':
                    statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100"><i class="fas fa-ban"></i> Rejected</span>`;
                    actionButtons = `<span class="text-slate-300 text-xs">-</span>`;
                    break;
            }

            const row = `
                <tr class="hover:bg-slate-50/50 transition">
                    <td class="px-6 py-4">
                        <div class="font-bold text-brand-900">${order.item}</div>
                        <div class="text-[10px] text-slate-400">ID: ${order._id.slice(-6)}</div>
                    </td>
                    <td class="px-6 py-4 text-xs font-bold text-slate-600">${order.branch}</td>
                    <td class="px-6 py-4 font-black text-slate-800">${order.quantity}</td>
                    <td class="px-6 py-4 text-xs text-slate-500">${order.supplier || 'N/A'}</td>
                    <td class="px-6 py-4">${statusBadge}</td>
                    <td class="px-6 py-4 text-right flex justify-end gap-2 items-center h-full">
                        ${actionButtons}
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

        const emptyState = document.getElementById('ordersEmptyState');
        if (!hasOrders) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
        }

    } catch (err) {
        console.error("Error fetching orders:", err);
    }
}

async function confirmAiOrders() {
    showOverlay("Creating your orders...");
    closeAiRestockModal();

    let count = 0;

    for (let i = 0; i < aiSuggestedOrders.length; i++) {
        const rec = aiSuggestedOrders[i];
        if (!rec) continue;

        const inputEl = document.getElementById(`ai-qty-${i}`);
        const qtyToOrder = inputEl ? inputEl.value : rec.quantity;

        try {
            await fetch(`${API_BASE}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item: rec.item,
                    branch: rec.branch,
                    quantity: parseInt(qtyToOrder),
                    supplier: "LUX Auto-Restock",
                    status: "pending"
                })
            });
            count++;
        } catch (err) {
            console.error("Failed", rec.item);
        }
    }

    await fetchOrders();

    const overlayText = document.getElementById('globalLoadingText');
    const overlayIcon = document.querySelector('#globalLoadingOverlay i');

    if (overlayText) overlayText.innerText = `Success! ${count} orders created.`;
    if (overlayIcon) {
        overlayIcon.className = "fas fa-check-circle text-5xl text-emerald-500 mb-5 animate-bounce";
    }

    setTimeout(() => {
        hideOverlay();
        if (overlayIcon) overlayIcon.className = "fas fa-circle-notch fa-spin text-5xl text-brand-600 mb-5";
    }, 1500);
}

async function updateOrderStatus(orderId, newStatus) {

    showOverlay(`Marking as ${newStatus}...`);

    try {
        const res = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await res.json();

        if (!res.ok) {
            document.getElementById('globalLoadingText').innerText = "Error!";
            alert(data.error || "Action failed");
            hideOverlay();
            return;
        }

        await fetchOrders();

        if (newStatus === 'received') {
            fetchInventory();
            if (typeof fetchComplianceData === 'function') fetchComplianceData();
        }

    } catch (err) {
        console.error("Update Status Error:", err);
    } finally {
        setTimeout(() => {
            hideOverlay();
        }, 500);
    }
}

function fetchBranches(callback = null) {
    const grid = document.getElementById('branchesGrid');
    const search = document.getElementById('branchSearch')?.value.toLowerCase() || '';


    if (grid) grid.innerHTML = '<div class="col-span-full text-center py-10"><i class="fas fa-circle-notch fa-spin text-brand-600 text-2xl"></i></div>';

    fetch(BRANCHES_API_URL)
        .then(res => res.json())
        .then(data => {

            if (grid) {
                grid.innerHTML = '';
                const filtered = data.filter(b =>
                    b.name.toLowerCase().includes(search) ||
                    (b.manager && b.manager.toLowerCase().includes(search))
                );

                if (filtered.length === 0) {
                    grid.innerHTML = `<div class="col-span-full text-center text-slate-400 py-10">No branches found.</div>`;
                } else {
                    filtered.forEach(branch => {
                        const branchId = branch.id || branch._id || '';
                        const card = document.createElement('div');
                        card.className = "bg-white border border-slate-200 rounded-3xl p-6 shadow-md hover:shadow-lg transition-all duration-300 group relative flex flex-col";

                        const safeName = branch.name.replace(/'/g, "\\'");
                        const safeAddr = (branch.address || 'No Address').replace(/'/g, "\\'");
                        const safeMgr = (branch.manager || 'Unassigned').replace(/'/g, "\\'");
                        const safePhone = (branch.phone || 'No Contact').replace(/'/g, "\\'");

                        card.innerHTML = `
                            <div class="flex justify-between items-start mb-4">
                                <div class="h-12 w-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center text-xl shadow-sm">🏢</div>
                            </div>
                            <h3 class="text-xl font-extrabold text-brand-900 mb-1">${branch.name}</h3>
                            <div class="mt-auto grid grid-cols-2 gap-3">
                                <button onclick="filterInventoryByBranch('${safeName}')" class="col-span-2 py-2.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 shadow-md transition flex items-center justify-center gap-2">View Stock</button>
                                <button onclick="openBranchModal('${branchId}', '${safeName}', '${safeAddr}', '${safeMgr}', '${safePhone}')" class="py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition">Edit</button>
                                <button onclick="deleteBranch('${branchId}')" class="py-2 rounded-xl border border-rose-100 text-rose-500 text-xs font-bold hover:bg-rose-50 transition">Delete</button>
                            </div>`;
                        grid.appendChild(card);
                    });
                }
            }

            if (typeof callback === 'function') {
                callback(data);
            }
        })
        .catch(err => console.error(err));
}


function openBranchModal(id = null, name = '', address = '', manager = '', phone = '') {
    const modal = document.getElementById('branchOverlay');
    const title = document.getElementById('branchModalTitle');
    document.getElementById('branch_id').value = id || '';
    document.getElementById('new_branch_name').value = name;
    document.getElementById('new_branch_address').value = address;
    document.getElementById('new_branch_manager').value = manager;
    document.getElementById('new_branch_phone').value = phone;
    title.textContent = id ? "Edit Branch" : "Add Branch";

    modal.classList.remove('hidden');
}

function closeBranchModal() {
    document.getElementById('branchOverlay').classList.add('hidden');
}

function handleBranchOutsideClick(e) {
    if (e.target.id === 'branchOverlay') closeBranchModal();
}

function submitBranchForm(e) {
    e.preventDefault();

    let id = document.getElementById('branch_id').value;
    if (id === 'undefined' || id === 'null') id = '';

    const name = document.getElementById('new_branch_name').value;
    const address = document.getElementById('new_branch_address').value;
    const manager = document.getElementById('new_branch_manager').value;
    const phone = document.getElementById('new_branch_phone').value;
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${BRANCHES_API_URL}/${id}` : BRANCHES_API_URL;

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, manager, phone })
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                showToast(id ? 'Branch updated!' : 'Branch created!');
                closeBranchModal();
                fetchBranches();
                if (typeof fetchBranchDropdown === 'function') fetchBranchDropdown();
            }
        })
        .catch(err => console.error(err));
}


function deleteBranch(id) {
    if (!confirm("Are you sure? This will delete the branch and all associated stock data.")) return;

    fetch(`${BRANCHES_API_URL}/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.error) alert(data.error);
            else {
                showToast('Branch deleted');
                fetchBranches();
            }
        });
}

function filterInventoryByBranch(branchName) {

    showPage('inventory');
    const dropdown = document.getElementById('branchFilter');
    const label = document.getElementById('branchLabel');

    if (dropdown) {
        dropdown.value = branchName;
        label.textContent = branchName;
    }

    fetchInventory();
}

async function saveBranch() {
    const name = document.getElementById('branchName').value.trim();
    if (!name) return alert('Name required');
    await fetch(BRANCHES_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            name, address: document.getElementById('branchAddress').value, manager: document.getElementById('branchManager').value
        })
    });
    document.getElementById('branchName').value = '';
    fetchBranches();
    initDashboard();
}

let editContext = {};
function openEditStockModal(name, branch, currentQty) {
    editContext = { name, branch, current: currentQty };
    document.getElementById('edit_item_name').textContent = name;
    document.getElementById('edit_item_branch').textContent = branch;
    document.getElementById('edit_current_stock').textContent = currentQty;
    document.getElementById('editStockOverlay').classList.remove('hidden');
}
function closeEditStockModal() { document.getElementById('editStockOverlay').classList.add('hidden'); }

async function submitEditStock() {
    const qty = Number(document.getElementById('edit_quantity').value);
    const action = document.getElementById('edit_action').value;
    const reasonCat = document.getElementById('edit_reason_cat').value;
    const note = document.getElementById('edit_note').value;

    let delta = 0;
    if (action === 'out') delta = -qty;
    else if (action === 'in') delta = qty;
    else if (action === 'set') delta = qty - editContext.current;

    try {
        await fetch(`${API_URL}/${encodeURIComponent(editContext.name)}/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                branch: editContext.branch,
                delta: delta,
                reason_category: reasonCat,
                note: note
            })
        });

        closeEditStockModal();
        fetchInventory();
        initDashboard();
        showToast("Stock updated & logged");
    } catch (e) {
        console.error(e);
        alert("Failed to adjust stock");
    }
}

async function loadAiDashboard() {
    try {
        const res = await fetch(`${API_BASE}/api/ai/dashboard`);
        if (res.ok) applyAiDashboardToCards(await res.json());
    } catch (e) { }
}
function applyAiDashboardToCards(data) {
    if (document.getElementById("aiSummaryText")) document.getElementById("aiSummaryText").textContent = data.summary_text || "No AI data.";
    if (document.getElementById("aiRiskText")) document.getElementById("aiRiskText").textContent = data.risk_text || "No risk data.";
}

function openItemDetails(item) {
    const modal = document.getElementById('itemDetailsOverlay');
    if (!modal) return;
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val !== null && val !== undefined && val !== '') ? val : '-';
    };


    setText('detail_name', item.name);
    setText('detail_branch', item.branch);
    setText('detail_quantity', item.quantity);
    setText('detail_sku', item.sku);
    setText('detail_category', item.category);
    setText('detail_reorder', item.reorder_level);
    setText('detail_usage', item.monthly_usage);

    const priceEl = document.getElementById('detail_price');
    if (priceEl) {
        priceEl.textContent = item.price
            ? `₱${Number(item.price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
            : '-';
    }

    setText('detail_batch', item.batch_number || item.batch || 'N/A');
    setText('detail_lot', item.lot_number || 'N/A');
    setText('detail_supplier_batch', item.supplier_batch || 'N/A');

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    };
    setText('detail_mfg', formatDate(item.mfg_date));
    setText('detail_exp', formatDate(item.exp_date || item.expiry_date));

    const qrEl = document.getElementById('detail_qr');
    if (qrEl) qrEl.textContent = item.qr_code_id || item.id || '-';

    const qrId = item.qr_code_id || item.batch_number || item.id;
    generateDetailQR(qrId);
    modal.classList.remove('hidden');
}

function closeItemDetails() {
    const modal = document.getElementById('itemDetailsOverlay');
    if (modal) modal.classList.add('hidden');
}

function handleDetailsOutsideClick(e) {
    if (e.target.id === 'itemDetailsOverlay') {
        closeItemDetails();
    }
}

function hideSplashScreen() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => {
            splash.style.display = 'none';
        }, 700);
    }
}
async function fetchReplenishmentRecommendations(isDashboard = false) {
    const container = document.getElementById('procurement-content');
    if (!container) return;

    if (isDashboard && currentProcurementTab !== 'replenish') return;

    container.innerHTML = `<div class="flex flex-col items-center justify-center h-48"><i class="fas fa-circle-notch fa-spin text-2xl text-brand-600"></i></div>`;

    try {
        const res = await fetch(`${API_BASE}/api/replenishment/recommendations`, { credentials: 'include' });
        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) {
            container.innerHTML = `<div class="flex flex-col items-center justify-center h-40 text-slate-400 gap-2"><i class="fas fa-clipboard-check text-2xl text-brand-200"></i><span class="text-xs">All rules satisfied.</span></div>`;
            return;
        }

        let html = '';
        data.slice(0, 5).forEach(item => {
            html += `
            <div class="flex items-center justify-between p-3 rounded-2xl border border-slate-100 bg-white hover:border-brand-200 hover:shadow-sm transition-all">
                <div class="flex items-center gap-3">
                    <div class="h-10 w-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center text-lg font-bold border border-brand-100">
                        <i class="fas fa-box"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm">${item.name}</h4>
                        <div class="text-[10px] text-slate-500 mt-0.5">
                            Hit Reorder Point (<b>${item.reorder_point}</b>)
                        </div>
                    </div>
                </div>
                
                <button onclick="openRestockModal('${item.name.replace(/'/g, "\\'")}', '${item.branch}', ${item.current_quantity})" 
                    class="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-[10px] font-bold shadow-md hover:bg-brand-700 transition flex items-center gap-1">
                    <i class="fas fa-plus"></i> Restock ${item.suggested_order_qty}
                </button>
            </div>`;
        });
        container.innerHTML = html;

    } catch (err) {
        console.error(err);
    }
}

function openNewItemModal() {
    const modal = document.getElementById('newItemOverlay');
    if (modal) {
        modal.classList.remove('hidden');

        document.getElementById('req_new_name').value = '';
        document.getElementById('req_new_qty').value = '1';
        document.getElementById('req_new_link').value = '';
        document.getElementById('req_new_notes').value = '';

        selectPriority('normal', 'Normal');
    }
}

function closeNewItemModal() {
    const modal = document.getElementById('newItemOverlay');
    if (modal) modal.classList.add('hidden');
}

async function submitNewItemRequest(e) {
    e.preventDefault();

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Sending...`;
    btn.disabled = true;

    try {
        const name = document.getElementById('req_new_name').value;
        const qty = document.getElementById('req_new_qty').value;
        const priority = document.getElementById('req_new_priority').value;
        const link = document.getElementById('req_new_link').value;
        const notes = document.getElementById('req_new_notes').value;
        const finalNotes = `[NEW ITEM REQUEST] ${notes} ${link ? `(Link: ${link})` : ''}`;

        const payload = {
            item: name,
            branch: currentUser.branch,
            quantity: parseInt(qty),
            supplier: "To Be Determined",
            priority: priority,
            notes: finalNotes,
            status: 'pending',
            created_at: new Date().toISOString()
        };

        const res = await fetch(ORDERS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Failed to submit request");

        showToast("Request submitted successfully!");
        closeNewItemModal();

        if (!document.getElementById('orders-section').classList.contains('hidden')) {
            fetchOrders();
        }

    } catch (err) {
        console.error(err);
        alert("Error sending request: " + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function togglePriorityMenu() {
    const menu = document.getElementById('priorityDropdownOptions');
    const btn = document.getElementById('priorityDropdownBtn');

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        btn.classList.add('border-brand-600', 'ring-2', 'ring-brand-100');
    } else {

        menu.classList.add('hidden');
        btn.classList.remove('border-brand-600', 'ring-2', 'ring-brand-100');
    }
}

function selectPriority(value, label) {
    document.getElementById('req_new_priority').value = value;

    const labelEl = document.getElementById('priorityLabel');

    if (value === 'high') {
        labelEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500"></span> ${label}`;
        labelEl.className = "flex items-center gap-2 text-rose-600";
    } else {
        labelEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> ${label}`;
        labelEl.className = "flex items-center gap-2 text-brand-900";
    }

    togglePriorityMenu();
}

document.addEventListener('click', function (e) {
    const btn = document.getElementById('priorityDropdownBtn');
    const menu = document.getElementById('priorityDropdownOptions');

    if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.add('hidden');
        btn.classList.remove('border-brand-600', 'ring-2', 'ring-brand-100');
    }
});


function fetchAnalyticsOverview(branchName = 'All') {

    fetch(`${API_BASE}/analytics/overview?branch=${encodeURIComponent(branchName)}`)
        .then(res => res.json())
        .then(d => {
            if (document.getElementById("an-new-items")) document.getElementById("an-new-items").textContent = d.new_items;
            if (document.getElementById("an-batches-7d")) document.getElementById("an-batches-7d").textContent = d.batches_7d;
            if (document.getElementById("an-total-items")) document.getElementById("an-total-items").textContent = d.total_items;
            if (document.getElementById("an-branches")) document.getElementById("an-branches").textContent = d.branches;
        })
        .catch(err => console.error("Analytics overview error", err));
}

function initAnalyticsOverview() {

    let targetBranch = 'All';
    const tabContainer = document.getElementById('analyticsBranchTabs');

    if (currentUser && currentUser.role === 'staff') {
        targetBranch = currentUser.branch;
        currentAnalyticsBranch = currentUser.branch;

        if (tabContainer) tabContainer.classList.add('hidden');
    } else {

        if (tabContainer) tabContainer.classList.remove('hidden');
        currentAnalyticsBranch = 'All';
    }

    fetchAnalyticsOverview(targetBranch);
    fetchAnalyticsLists();
    if (!currentUser || currentUser.role !== 'staff') {
        renderAnalyticsTabs();
    }

    fetchAnalyticsCharts(targetBranch);
}


async function renderAnalyticsTabs() {
    const container = document.getElementById('analyticsBranchTabs');
    if (!container) return;

    try {
        const res = await fetch(BRANCHES_API_URL);
        const branches = await res.json();
        let html = `
            <button onclick="switchAnalyticsBranch('All')" 
                class="analytics-tab px-4 py-2 rounded-full text-xs font-bold transition-all border whitespace-nowrap ${currentAnalyticsBranch === 'All' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}">
                All Branches
            </button>`;

        branches.forEach(b => {
            const isActive = currentAnalyticsBranch === b.name;
            html += `
            <button onclick="switchAnalyticsBranch('${b.name}')" 
                class="analytics-tab px-4 py-2 rounded-full text-xs font-bold transition-all border whitespace-nowrap ${isActive ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}">
                ${b.name}
            </button>`;
        });

        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = `<span class="text-xs text-rose-400">Failed to load branches</span>`;
    }
}

function switchAnalyticsBranch(branchName) {
    currentAnalyticsBranch = branchName;
    renderAnalyticsTabs();
    fetchAnalyticsCharts(branchName);
}

function toggleAnalyticsView() {
    const range = document.getElementById('analytics-time-range').value;
    const yearSelect = document.getElementById('analytics-year-select');

    if (range === 'monthly') {
        yearSelect.classList.remove('hidden');
    } else {
        yearSelect.classList.add('hidden');
    }

    fetchAnalyticsCharts();
}

async function fetchAnalyticsCharts() {
    try {
        const timeRangeEl = document.getElementById('analytics-time-range');
        const yearSelectEl = document.getElementById('analytics-year-select');

        if (!timeRangeEl || !yearSelectEl) return;

        const timeRange = timeRangeEl.value;
        const selectedYear = yearSelectEl.value;

        let url = `${API_BASE}/analytics/movement`;
        if (timeRange === 'monthly') {
            url = `${API_BASE}/analytics/movement-monthly?year=${selectedYear}`;
        }

        if (currentAnalyticsBranch !== 'All') {
            const separator = url.includes('?') ? '&' : '?';
            url += `${separator}branch=${encodeURIComponent(currentAnalyticsBranch)}`;
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch analytics");

        const data = await res.json();
        let formattedPayload = {};
        if (timeRange === 'monthly') {
            formattedPayload = { movement_monthly: data };
        } else {
            formattedPayload = { movement: data };
        }

        drawAnalytics(formattedPayload);

    } catch (err) {
        console.error("Chart Fetch Error:", err);
    }
}

function fetchAnalyticsLists() {
    fetch(`${API_BASE}/analytics/low-stock`)
        .then(res => res.json())
        .then(data => {
            const table = document.getElementById('lowStockTable');
            if (table) {
                table.innerHTML = "";
                if (!data || data.length === 0) {
                    table.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-center text-slate-400 text-xs">All stock levels healthy.</td></tr>`;
                } else {
                    data.forEach(p => {
                        table.innerHTML += `
                        <tr class="hover:bg-slate-50 transition">
                            <td class="px-6 py-3 font-medium text-slate-700">${p.name}</td>
                            <td class="px-6 py-3 font-bold text-slate-800 text-right">${p.quantity}</td>
                            <td class="px-6 py-3 text-right">
                                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">Low</span>
                            </td>
                        </tr>`;
                    });
                }
            }
        });

    fetch(`${API_BASE}/analytics/top-products`)
        .then(res => {
            if (!res.ok) throw new Error("Server Error");
            return res.json();
        })
        .then(data => {
            const list = document.getElementById('topProductsList');
            if (list) {
                list.innerHTML = "";
                if (!data || data.length === 0) {
                    list.innerHTML = `<li class="text-center text-slate-400 text-xs py-4">No consumption data yet.</li>`;
                } else {
                    data.forEach((p, index) => {
                        let rankClass = "bg-slate-100 text-slate-500";
                        let rankIcon = `#${index + 1}`;
                        if (index === 0) { rankClass = "bg-amber-100 text-amber-600"; rankIcon = "🥇"; }
                        if (index === 1) { rankClass = "bg-slate-200 text-slate-600"; rankIcon = "🥈"; }
                        if (index === 2) { rankClass = "bg-orange-100 text-orange-600"; rankIcon = "🥉"; }
                        const costVal = parseFloat(p.total_cost || 0);
                        const formattedCost = costVal.toLocaleString('en-PH', {
                            style: 'currency', currency: 'PHP', minimumFractionDigits: 2
                        });

                        list.innerHTML += `
                        <li class="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100 group">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${rankClass}">
                                    ${rankIcon}
                                </div>
                                <div>
                                    <div class="text-sm font-bold text-slate-700 truncate max-w-[140px]" title="${p._id}">${p._id}</div>
                                    <div class="h-1.5 w-24 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                        <div class="h-full bg-indigo-500 rounded-full" style="width: ${Math.min(100, p.used * 2)}%"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="text-right">
                                <span class="block text-xs font-bold text-indigo-600">${p.used} used</span>
                                <span class="block text-[10px] font-medium text-slate-400 mt-0.5">${formattedCost}</span>
                            </div>
                        </li>`;
                    });
                }
            }
        })
        .catch(err => {
            console.error("Top Products Error:", err);
            const list = document.getElementById('topProductsList');
            if (list) list.innerHTML = `<li class="text-center text-rose-400 text-xs py-4">Error loading data.</li>`;
        });
}


function drawAnalytics(payload) {
    const section = document.getElementById('analytics-section');
    if (!section || section.classList.contains('hidden')) {
        lastAnalyticsPayload = payload;
        return;
    }

    const lineCanvas = document.getElementById('analyticsMainChart');
    const barCanvas = document.getElementById('stockInOutChart');

    if (!lineCanvas || !barCanvas) return;

    const weekly = payload.movement || { labels: [], stock_in: [], stock_out: [] };
    const monthly = payload.movement_monthly || weekly;
    const colorWine = '#5E4074';
    const colorRed = '#DC2626';
    const timeRangeEl = document.getElementById('analytics-time-range');
    const isMonthly = timeRangeEl && timeRangeEl.value === 'monthly';
    const dataToShow = isMonthly ? monthly : weekly;
    const lineCtx = lineCanvas.getContext('2d');
    if (analyticsMainChart) { analyticsMainChart.destroy(); analyticsMainChart = null; }

    analyticsMainChart = new Chart(lineCtx, {
        type: 'line',
        data: {
            labels: dataToShow.labels || [],
            datasets: [
                {
                    label: 'Stock In',
                    data: dataToShow.stock_in || [],
                    borderColor: colorWine,
                    borderWidth: 3,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: colorWine,
                    pointHoverRadius: 6,
                    fill: true,
                    backgroundColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                        gradient.addColorStop(0, 'rgba(94, 64, 116, 0.05)');
                        gradient.addColorStop(1, 'rgba(94, 64, 116, 0.5)');
                        return gradient;
                    },
                    tension: 0.4
                },
                {
                    label: 'Stock Out',
                    data: dataToShow.stock_out || [],
                    borderColor: colorRed,
                    borderWidth: 3,
                    backgroundColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) return null;
                        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                        gradient.addColorStop(0, 'rgba(220, 38, 38, 0.05)');
                        gradient.addColorStop(1, 'rgba(220, 38, 38, 0.5)');
                        return gradient;
                    },
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: colorRed,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, font: { weight: 'bold', size: 11 } } },
            },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9', borderDash: [5, 5] }, ticks: { font: { size: 10, weight: 'bold' } } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' } } }
            }
        }
    });

    const barCtx = barCanvas.getContext('2d');
    if (stockInOutChart) { stockInOutChart.destroy(); stockInOutChart = null; }

    stockInOutChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: weekly.labels || [],
            datasets: [
                {
                    label: 'In',
                    data: weekly.stock_in || [],
                    backgroundColor: colorWine,
                    borderRadius: 4,
                    barPercentage: 0.5
                },
                {
                    label: 'Out',
                    data: weekly.stock_out || [],
                    backgroundColor: colorRed,
                    borderRadius: 4,
                    barPercentage: 0.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { display: false, beginAtZero: true },
                x: { grid: { display: false }, ticks: { font: { size: 9, weight: 'bold' }, color: '#94a3b8' } }
            }
        }
    });
}

function toggleMainChartDataset(datasetIndex) {
    if (!analyticsMainChart) return;

    const isVisible = analyticsMainChart.isDatasetVisible(datasetIndex);
    if (isVisible) {
        analyticsMainChart.hide(datasetIndex);

        const btn = document.getElementById(`legend-btn-${datasetIndex}`);
        if (btn) {
            btn.classList.add('opacity-50', 'grayscale');
            btn.classList.remove('shadow-sm');
        }
    } else {
        analyticsMainChart.show(datasetIndex);
        const btn = document.getElementById(`legend-btn-${datasetIndex}`);
        if (btn) {
            btn.classList.remove('opacity-50', 'grayscale');
            btn.classList.add('shadow-sm');
        }
    }
}

async function doLogout() {
    try {

        await fetch(`${API_BASE}/api/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error("Logout error", e);
    } finally {

        window.location.href = "/login";
    }
}

let html5QrcodeScanner = null;
let currentQrItem = null;
let currentFacingMode = "environment";

function startQrScanner() {

    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrcodeScanner.start(
        { facingMode: currentFacingMode },
        config,
        onScanSuccess,
        onScanFailure
    ).then(() => {
        updateScannerUI(true);
        showToast(`Camera started (${currentFacingMode === 'environment' ? 'Back' : 'Front'})`);
    }).catch(err => {
        console.error("Camera error", err);
        alert("Could not access camera. Ensure permissions are granted.");
    });
}

async function stopQrScanner() {
    if (html5QrcodeScanner) {
        try {
            await html5QrcodeScanner.stop();
            updateScannerUI(false);
            html5QrcodeScanner.clear();
        } catch (err) {
            console.error("Stop error", err);
        }
    }
}

async function switchCamera() {
    if (!html5QrcodeScanner) return;

    try {
        await html5QrcodeScanner.stop();
    } catch (e) {

    }

    currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";

    startQrScanner();
}

function updateScannerUI(isScanning) {
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');
    const switchBtn = document.getElementById('switchCamBtn');

    if (isScanning) {
        startBtn.disabled = true;
        startBtn.classList.add('opacity-50');
        stopBtn.disabled = false;
        stopBtn.classList.remove('opacity-50');
        switchBtn.disabled = false;
        switchBtn.classList.remove('opacity-50');
    } else {
        startBtn.disabled = false;
        startBtn.classList.remove('opacity-50');
        stopBtn.disabled = true;
        stopBtn.classList.add('opacity-50');
        switchBtn.disabled = true;
        switchBtn.classList.add('opacity-50');
    }
}

function onScanSuccess(decodedText, decodedResult) {
    console.log(`Scan result: ${decodedText}`);
    stopQrScanner();
    lookupQrCode(decodedText);
}

function onScanFailure(error) {
}


function handleManualQrLookup() {
    const input = document.getElementById('qrManualInput');
    const id = input.value.trim();
    if (id) {
        lookupQrCode(id);
        input.value = '';
    }
}

async function lookupQrCode(qrId) {
    const card = document.getElementById('qrResultCard');
    const empty = document.getElementById('qrEmptyState');

    try {
        const res = await fetch(`${API_BASE}/api/batches`);
        const batches = await res.json();

        const match = batches.find(b =>
            (b.qr_code_id && b.qr_code_id.toUpperCase() === qrId.toUpperCase()) ||
            (b.batch_number && b.batch_number.toUpperCase() === qrId.toUpperCase())
        );

        if (match) {
            renderQrResult(match);
        } else {
            showToast("QR Code not found.");
            card.classList.add('hidden');
            empty.classList.remove('hidden');
        }
    } catch (err) {
        console.error("QR Lookup Error", err);
        alert("Error looking up QR code.");
    }
}

function renderQrResult(batch) {
    currentQrItem = batch;
    const card = document.getElementById('qrResultCard');
    const empty = document.getElementById('qrEmptyState');

    document.getElementById('qrResName').textContent = batch.item_name;
    document.getElementById('qrResBatch').textContent = `Batch: ${batch.batch_number}`;
    document.getElementById('qrResStock').textContent = batch.current_stock;
    document.getElementById('qrResBranch').textContent = batch.branch;
    const expDate = batch.exp_date ? new Date(batch.exp_date).toLocaleDateString() : 'N/A';
    document.getElementById('qrResExp').textContent = expDate;

    empty.classList.add('hidden');
    card.classList.remove('hidden');
    card.classList.add('animate-fade-in');
}

async function qrQuickAction(action) {
    if (!currentQrItem) return;

    if (action === 'view') {
        openItemDetails({
            name: currentQrItem.item_name,
            branch: currentQrItem.branch,
            quantity: currentQrItem.current_stock,
            batch_number: currentQrItem.batch_number,
            exp_date: currentQrItem.exp_date,

        });
    }
    else if (action === 'consume') {
        if (confirm(`Consume 1 unit of ${currentQrItem.item_name}?`)) {
            try {
                await fetch(`${API_URL}/${encodeURIComponent(currentQrItem.item_name)}/adjust`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ branch: currentQrItem.branch, delta: -1 })
                });

                showToast("Stock consumed!");
                const stockEl = document.getElementById('qrResStock');
                stockEl.textContent = parseInt(stockEl.textContent) - 1;
                fetchInventory();
            } catch (err) {
                alert("Failed to update stock.");
            }
        }
    }
}


function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    if (!menu) return;

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    } else {
        menu.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

let pendingDelete = {
    type: null,
    id: null
};

function openDeleteModal(type, id) {
    pendingDelete = { type, id };

    const modal = document.getElementById('deleteOverlay');
    const msgEl = document.getElementById('deleteMessage');

    if (type === 'inventory') {
        msgEl.innerHTML = `Are you sure you want to delete item <b>"${id}"</b>?<br>This will also remove all its batches.`;
    } else if (type === 'supplier') {
        msgEl.innerHTML = `Are you sure you want to remove supplier <b>"${id}"</b>?`;
    }

    modal.classList.remove('hidden');
}

function closeDeleteModal() {
    document.getElementById('deleteOverlay').classList.add('hidden');
    pendingDelete = { type: null, id: null };
}


function handleDeleteOutsideClick(e) {
    if (e.target.id === 'deleteOverlay') {
        closeDeleteModal();
    }
}

async function executeDelete() {
    const { type, id } = pendingDelete;
    if (!type || !id) return;

    try {
        let url = '';
        if (type === 'inventory') {
            url = `${API_URL}/${encodeURIComponent(id)}`;
        } else if (type === 'supplier') {
            url = `${SUPPLIERS_API_URL}/${encodeURIComponent(id)}`;
        }

        const res = await fetch(url, { method: 'DELETE' });

        if (res.ok) {
            showToast(`${type === 'inventory' ? 'Item' : 'Supplier'} deleted successfully`);
            if (type === 'inventory') {
                fetchInventory();
                initDashboard();
            } else {
                fetchSuppliers();
            }
        } else {
            alert("Failed to delete. Please try again.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error occurred.");
    } finally {
        closeDeleteModal();
    }
}


async function fetchPredictiveRestock(isDashboard = false) {
    const container = document.getElementById("procurement-content");
    if (!container) return;
    if (isDashboard) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                <i class="fas fa-circle-notch fa-spin text-2xl text-brand-600"></i>
                <span class="text-xs">LUX is scanning stock velocity...</span>
            </div>
        `;
    }

    try {
        const url = `${API_BASE}/api/ai/predict-restock?days=${encodeURIComponent(
            currentPredictionHorizon
        )}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load predictive data");
        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                    <i class="fas fa-clipboard-check text-2xl text-brand-200"></i>
                    <span class="text-xs">No forecasted stockouts within ${currentPredictionHorizon} days.</span>
                </div>
            `;
            return;
        }

        let html = "";
        data.slice(0, 10).forEach((item) => {
            const riskLevel = item.risk_level || "Low";
            const riskScore = item.risk_score ?? 0;
            const daysLeft = item.daysuntilout;
            const qty = item.currentstock ?? 0;
            const reorder = item.reorderlevel ?? 0;
            const suggested = item.recommendedorder ?? 0;

            let riskColor =
                "bg-emerald-50 text-emerald-700 border border-emerald-100";
            if (riskLevel === "Critical") {
                riskColor = "bg-rose-50 text-rose-700 border border-rose-200";
            } else if (riskLevel === "High") {
                riskColor = "bg-amber-50 text-amber-700 border border-amber-200";
            } else if (riskLevel === "Medium") {
                riskColor = "bg-sky-50 text-sky-700 border border-sky-200";
            }

            const daysText =
                daysLeft <= 0
                    ? "Out of stock"
                    : daysLeft === currentPredictionHorizon + 1
                        ? `> ${currentPredictionHorizon} days`
                        : `${daysLeft} days`;

            html += `
                <div class="flex items-center justify-between p-3 rounded-2xl border border-slate-100 bg-white hover:border-brand-200 hover:shadow-sm transition-all mb-2">
                    <div class="flex items-center gap-3">
                        <div class="h-10 w-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center text-lg font-bold border border-brand-100">
                            <i class="fas fa-box"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-slate-800 text-sm">${item.name}</h4>
                            <div class="flex items-center gap-2 mt-0.5">
                                <span class="text-[10px] font-bold text-slate-500 uppercase px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100">
                                    ${item.branch || "General"}
                                </span>
                                <span class="text-[10px] font-mono text-slate-400">
                                    Stock: <span class="font-bold text-slate-700">${qty}</span> • Reorder: <span class="font-bold">${reorder}</span>
                                </span>
                            </div>
                            <div class="mt-1 text-[10px] text-slate-500">
                                Forecast: <span class="font-bold text-slate-700">${daysText}</span> until depletion at current usage.
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        <div class="${riskColor} text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <span>${riskLevel}</span>
                            <span class="text-[9px] opacity-80">(${riskScore})</span>
                        </div>
                        <div class="text-[10px] text-slate-500">
                            Suggest order: <span class="font-extrabold text-brand-700">${suggested}</span> units
                        </div>
                        <button
                            onclick="openRestockModal('${(item.name || "").replace(
                /'/g,
                "\\'"
            )}', '${(item.branch || "General").replace(
                /'/g,
                "\\'"
            )}', ${qty})"
                            class="mt-1 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-[10px] font-bold shadow-sm hover:bg-brand-700 transition flex items-center gap-1">
                            <i class="fas fa-plus"></i> Order
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (err) {
        console.error(err);
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-40 text-rose-500 gap-2">
                <i class="fas fa-triangle-exclamation text-2xl"></i>
                <span class="text-xs font-bold">Failed to load predictive forecast.</span>
            </div>
        `;
    }
}

function fetchComplianceData() {

    fetch(`${API_BASE}/api/compliance/overview`)
        .then(res => res.json())
        .then(data => {
            document.getElementById('comp-score').textContent = `${data.score}%`;
            document.getElementById('comp-expired').textContent = data.expired_count;
            document.getElementById('comp-low').textContent = data.low_stock_count;

            const statusEl = document.getElementById('comp-status');
            statusEl.textContent = data.status;
            if (data.score >= 90) statusEl.className = "text-sm font-medium text-emerald-400 mt-1";
            else if (data.score >= 70) statusEl.className = "text-sm font-medium text-amber-400 mt-1";
            else statusEl.className = "text-sm font-medium text-rose-400 mt-1";
        })
        .catch(err => console.error("Compliance Overview Error:", err));


    fetch(`${API_BASE}/api/compliance/audit-logs`)
        .then(res => res.json())
        .then(logs => {
            const tbody = document.getElementById('auditLogTable');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-400">No recent activity recorded.</td></tr>`;
                return;
            }

            logs.forEach(log => {

                const isOut = log.direction === 'out';
                const badgeClass = isOut
                    ? "bg-rose-50 text-rose-600 border-rose-100"
                    : "bg-[#7D8C7D]/20 text-brand-600 border-emerald-100";

                const actionLabel = isOut ? "Stock Used / Adjusted" : "Stock Added / Restocked";
                const dateStr = new Date(log.date).toLocaleString();

                tbody.innerHTML += `
                <tr class="hover:bg-slate-50/50 transition">
                    <td class="px-6 py-4 font-mono text-xs text-slate-500">${dateStr}</td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold border ${badgeClass}">
                            ${log.direction.toUpperCase()}
                        </span>
                    </td>
                    <td class="px-6 py-4 font-medium text-slate-700">${log.name}</td>
                    <td class="px-6 py-4 text-xs text-slate-500">${log.branch || 'Main'}</td>
                    <td class="px-6 py-4 text-right font-bold ${isOut ? 'text-rose-600' : 'text-brand-600'}">
                        ${isOut ? '-' : '+'}${log.quantity_used}
                    </td>
                </tr>`;
            });
        })
        .catch(err => console.error("Audit Log Error:", err));
}

let allAuditLogs = [];

function fetchComplianceData() {

    fetch(`${API_BASE}/api/compliance/overview`)
        .then(res => res.json())
        .then(data => {
            document.getElementById('comp-score').textContent = `${data.score}%`;
            document.getElementById('comp-expired').textContent = data.expired_count;
            document.getElementById('comp-low').textContent = data.low_stock_count;

            const statusEl = document.getElementById('comp-status');
            statusEl.textContent = data.status;

            if (data.score >= 90) statusEl.className = "text-sm font-medium text-emerald-400 mt-1";
            else if (data.score >= 70) statusEl.className = "text-sm font-medium text-amber-400 mt-1";
            else statusEl.className = "text-sm font-medium text-rose-400 mt-1";
        })
        .catch(err => console.error("Compliance Error:", err));

    fetch(`${API_BASE}/api/compliance/audit-logs`)
        .then(res => res.json())
        .then(logs => {
            allAuditLogs = logs;
            renderAuditTable(logs);
        })
        .catch(err => console.error("Audit Log Error:", err));
}

function renderAuditTable(logs) {
    const tbody = document.getElementById('auditLogTable');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">No logs matching criteria.</td></tr>`;
        return;
    }


    logs.forEach(log => {
        const isOut = log.direction === 'out';
        const dateObj = new Date(log.date);
        const dateStr = dateObj.toLocaleDateString();
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        tbody.innerHTML += `
    <tr class="hover:bg-slate-50/80 transition">
        <td class="px-3 md:px-6 py-3">
            <div class="font-mono text-[10px] md:text-xs text-slate-500">${dateStr}</div>
            <div class="font-mono text-[9px] text-slate-400 md:hidden">${timeStr}</div>
        </td>
        <td class="px-3 md:px-6 py-3">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] md:text-[10px] font-bold uppercase tracking-wide border ${isOut ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-[#7D8C7D]/20 text-brand-600 border-emerald-100'}">
                ${log.direction}
            </span>
        </td>
        <td class="px-3 md:px-6 py-3 font-bold text-slate-700 text-xs md:text-sm">${log.name}</td>
        <td class="hidden sm:table-cell px-6 py-3 text-xs text-slate-500">${log.branch || 'Main'}</td>
        <td class="px-3 md:px-6 py-3 text-right font-mono font-bold text-xs md:text-sm ${isOut ? 'text-rose-600' : 'text-brand-600'}">
            ${isOut ? '-' : '+'}${log.quantity_used}
        </td>
    </tr>`;
    });
}

function filterAuditLogs() {
    const searchTerm = document.getElementById('auditSearch').value.toLowerCase();
    const dateVal = document.getElementById('auditDate').value;

    const filtered = allAuditLogs.filter(log => {
        const matchesName = log.name.toLowerCase().includes(searchTerm) ||
            (log.branch && log.branch.toLowerCase().includes(searchTerm));

        let matchesDate = true;
        if (dateVal) {
            const logDate = new Date(log.date).toISOString().split('T')[0];
            matchesDate = (logDate === dateVal);
        }

        return matchesName && matchesDate;
    });

    renderAuditTable(filtered);
}


function downloadComplianceReport() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();


    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text("PREMIERLUX INVENTORY", 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text("Compliance & Audit Report", 14, 26);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);


    const score = document.getElementById('comp-score').textContent;
    const expired = document.getElementById('comp-expired').textContent;

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 40, 180, 25, 3, 3, 'FD');

    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(`Compliance Score: ${score}`, 20, 56);
    doc.text(`Expired Items: ${expired}`, 100, 56);

    const searchTerm = document.getElementById('auditSearch').value.toLowerCase();
    const dateVal = document.getElementById('auditDate').value;


    const dataToPrint = allAuditLogs.filter(log => {
        const matchesName = log.name.toLowerCase().includes(searchTerm);
        let matchesDate = true;
        if (dateVal) matchesDate = (new Date(log.date).toISOString().split('T')[0] === dateVal);
        return matchesName && matchesDate;
    });

    const tableRows = dataToPrint.map(log => [
        new Date(log.date).toLocaleDateString(),
        log.direction.toUpperCase(),
        log.name,
        log.branch || 'Main',
        (log.direction === 'out' ? '-' : '+') + log.quantity_used
    ]);

    doc.autoTable({
        startY: 75,
        head: [['Date', 'Action', 'Item Name', 'Branch', 'Qty']],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: 255 },
        styles: { fontSize: 9, cellPadding: 3 },
        alternateRowStyles: { fillColor: [248, 250, 252] }
    });
    doc.save(`Premierlux_Audit_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function fetchUsers() {
    fetch(`${API_BASE}/api/users`)
        .then(res => res.json())
        .then(users => {
            const tbody = document.getElementById('usersTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (users.error) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-rose-500">Access Denied: Owner/Admin Only</td></tr>`;
                return;
            }

            users.forEach(u => {

                let roleColor = 'bg-slate-100 text-slate-500 border border-slate-200';
                if (u.role === 'admin') roleColor = 'bg-[#7D8C7D]/20 text-brand-600 border border-emerald-100';
                if (u.role === 'owner') roleColor = 'bg-purple-50 text-purple-600 border border-purple-100 ring-2 ring-purple-500/10';
                let branchBadge = `<span class="text-xs font-semibold text-slate-600">${u.branch || 'Main'}</span>`;
                if (u.branch === 'All') branchBadge = `<span class="text-[10px] font-black bg-slate-800 text-white px-2 py-0.5 rounded-full tracking-wider">HEADQUARTERS</span>`;

                const deleteBtn = u.role === 'owner' ? '' : `
                    <button onclick="deleteUser('${u._id}')" class="group p-2 rounded-lg hover:bg-rose-50 transition-colors" title="Delete User">
                        <svg class="w-4 h-4 text-slate-300 group-hover:text-rose-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>`;

                tbody.innerHTML += `
                <tr class="hover:bg-slate-50/80 transition border-b border-slate-50 last:border-0">
                    <td class="px-6 py-4">
                        <div class="font-bold text-slate-700">${u.name}</div>
                    </td>
                    <td class="px-6 py-4 text-xs text-slate-500 font-mono">${u.email}</td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${roleColor}">
                            ${u.role}
                        </span>
                    </td>
                    <td class="px-6 py-4">${branchBadge}</td>
                    <td class="px-6 py-4 text-right">
                        ${deleteBtn}
                    </td>
                </tr>`;
            });
        })
        .catch(err => console.error(err));
}

function openUserModal() {
    document.getElementById('userOverlay').classList.remove('hidden');
    const branchSelect = document.getElementById('new_user_branch');
    if (branchSelect) {
        branchSelect.innerHTML = '<option value="" disabled selected>Select a Branch...</option>';

        fetch(BRANCHES_API_URL)
            .then(res => res.json())
            .then(branches => {
                if (branches.length === 0) {
                    branchSelect.innerHTML = '<option disabled>No branches found</option>';
                } else {
                    branches.forEach(b => {
                        branchSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`;
                    });
                }
            });
    }
}

function submitUserForm(e) {
    e.preventDefault();

    const roleVal = document.getElementById('new_user_role').value;
    const branchVal = document.getElementById('new_user_branch').value;
    if (!roleVal) { alert("Please select a Role."); return; }
    if (!branchVal) { alert("Please select a Branch."); return; }

    const payload = {
        name: document.getElementById('new_user_name').value,
        email: document.getElementById('new_user_email').value,
        password: document.getElementById('new_user_pass').value,
        role: roleVal,
        branch: branchVal
    };

    fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(res => {
        if (res.ok) {
            showToast("User created successfully");
            closeUserModal();
            fetchUsers();
        } else {
            res.json().then(data => alert(data.error || "Failed to create user"));
        }
    });
}

function deleteUser(id) {
    if (!confirm("Delete this user?")) return;
    fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' })
        .then(res => {
            if (res.ok) {
                showToast("User deleted");
                fetchUsers();
            } else {
                alert("Action failed (Unauthorized)");
            }
        });
}

function closeUserModal() { document.getElementById('userOverlay').classList.add('hidden'); }
function handleUserOutsideClick(e) { if (e.target.id === 'userOverlay') closeUserModal(); }
function toggleUserRoleMenu() {
    const menu = document.getElementById('roleDropdownOptions');
    document.getElementById('userBranchOptions').classList.add('hidden');
    if (menu) menu.classList.toggle('hidden');
}

function selectUserRole(value, label) {
    document.getElementById('new_user_role').value = value;
    const btnLabel = document.getElementById('roleLabel');
    btnLabel.textContent = label;
    btnLabel.classList.add('text-slate-800');
    document.getElementById('roleDropdownOptions').classList.add('hidden');
}

function toggleUserBranchMenu() {
    const menu = document.getElementById('userBranchOptions');
    document.getElementById('roleDropdownOptions').classList.add('hidden');
    if (menu) menu.classList.toggle('hidden');
}

function selectUserBranch(name) {
    document.getElementById('new_user_branch').value = name;
    const btnLabel = document.getElementById('userBranchLabel');
    btnLabel.textContent = name;
    btnLabel.classList.add('text-slate-800');
    document.getElementById('userBranchOptions').classList.add('hidden');
}


function openUserModal() {
    document.getElementById('userOverlay').classList.remove('hidden');
    document.getElementById('new_user_role').value = '';
    document.getElementById('roleLabel').textContent = 'Select Role...';
    document.getElementById('new_user_branch').value = '';
    document.getElementById('userBranchLabel').textContent = 'Select Branch...';

    const container = document.getElementById('userBranchOptions');
    if (container) {
        container.innerHTML = '<div class="p-2 text-xs text-slate-400 text-center">Loading...</div>';

        fetch(BRANCHES_API_URL)
            .then(res => res.json())
            .then(branches => {
                container.innerHTML = '';
                if (branches.length === 0) {
                    container.innerHTML = '<div class="p-2 text-xs text-slate-400 text-center">No branches found</div>';
                } else {
                    branches.forEach(b => {
                        container.innerHTML += `
                            <button type="button" onclick="selectUserBranch('${b.name}')" 
                                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-[#7D8C7D]/20 hover:text-brand-600 transition">
                                ${b.name}
                            </button>`;
                    });
                }
            });
    }
}

function fetchRoleStats() {
    fetch(`${API_BASE}/api/users`)
        .then(res => res.json())
        .then(users => {
            if (users.error) return;

            let counts = { owner: 0, admin: 0, staff: 0 };

            users.forEach(u => {
                const r = (u.role || 'staff').toLowerCase();
                if (counts[r] !== undefined) {
                    counts[r]++;
                }
            });

            document.getElementById("count-owner").textContent = counts.owner;
            document.getElementById("count-admin").textContent = counts.admin;
            document.getElementById("count-staff").textContent = counts.staff;
        })
        .catch(err => console.error("Role stats error:", err));
}


function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}



function initOwnerSettings() {
    fetch(`${API_BASE}/api/admin/settings`)
        .then(res => res.json())
        .then(data => {
            const toggle = document.getElementById('lockdownToggle');
            const status = document.getElementById('lockdownStatus');

            if (toggle) {
                toggle.checked = data.lockdown;
                status.textContent = data.lockdown ? "Active" : "Off";
                status.className = data.lockdown
                    ? "ml-3 text-sm font-bold text-rose-600 animate-pulse"
                    : "ml-3 text-sm font-medium text-slate-700";
            }
        })
        .catch(err => console.error(err));
}

function toggleSystemLockdown() {
    const toggle = document.getElementById('lockdownToggle');
    const isLocked = toggle.checked;

    fetch(`${API_BASE}/api/admin/lockdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: isLocked })
    })
        .then(res => res.json())
        .then(data => {
            showToast(data.message);
            initOwnerSettings();
        });
}

function wipeAuditLogs() {
    if (confirm("⚠️ CRITICAL WARNING ⚠️\n\nAre you sure you want to delete ALL system logs?\nThis action cannot be undone.")) {
        fetch(`${API_BASE}/api/admin/clear-logs`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.error) alert(data.error);
                else showToast("Audit logs cleared");
            });
    }
}



function generateCustomQR() {
    const text = document.getElementById('qrGenInput').value.trim();
    const container = document.getElementById('qrGenCanvas');
    const printBtn = document.getElementById('printQrBtn');

    if (!text) return alert("Please enter text or Batch ID");

    container.innerHTML = "";

    new QRCode(container, {
        text: text,
        width: 128,
        height: 128,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
    printBtn.classList.remove('hidden');
}


function printCustomQR() {
    const container = document.getElementById('qrGenCanvas');
    const img = container.querySelector('img');
    if (!img) return;

    const win = window.open('', '', 'height=500,width=500');
    win.document.write('<html><head><title>Print QR</title></head><body style="text-align:center; padding-top: 50px;">');
    win.document.write(`<img src="${img.src}" style="width:200px; height:200px; border: 1px solid #ccc; padding: 10px;">`);
    win.document.write(`<p style="font-family: monospace; margin-top: 10px; font-size: 20px;">${document.getElementById('qrGenInput').value}</p>`);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
}


function generateDetailQR(qrText) {
    const container = document.getElementById('detail_qr_image');
    if (!container) return;
    container.innerHTML = "";

    if (qrText && qrText !== '-' && qrText !== 'N/A') {
        new QRCode(container, {
            text: qrText,
            width: 64,
            height: 64
        });
    } else {
        container.innerHTML = "<span class='text-[8px] text-slate-300 flex items-center justify-center h-full'>No ID</span>";
    }
}

function printDetailQR() {
    const text = document.getElementById('detail_qr').textContent;
    const container = document.getElementById('detail_qr_image');
    const img = container.querySelector('img');

    if (!img) return alert("No QR code to print.");

    const win = window.open('', '', 'height=500,width=500');
    win.document.write('<html><head><title>Print Label</title></head><body style="text-align:center; padding-top: 50px;">');
    win.document.write(`<img src="${img.src}" style="width:200px; height:200px;">`);
    win.document.write(`<p style="font-family: monospace; font-weight:bold;">${document.getElementById('detail_name').textContent}</p>`);
    win.document.write(`<p style="font-family: monospace;">${text}</p>`);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
}


function sendSystemBroadcast() {
    const input = document.getElementById('broadcastMsg');
    const msg = input.value.trim();
    if (!msg) return;

    fetch(`${API_BASE}/api/admin/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
    })
        .then(res => res.json())
        .then(data => {
            showToast("📢 Broadcast Sent!");
            input.value = "";
        });
}

function forceLogoutAll() {
    if (!confirm("⚡ EMERGENCY: Are you sure you want to force logout ALL users?\nThey will be disconnected immediately.")) return;

    fetch(`${API_BASE}/api/admin/kill-sessions`, { method: 'POST' })
        .then(res => res.json())
        .then(data => showToast("⚡ Kill command executed."));
}

function downloadSystemBackup() {
    window.open(`${API_BASE}/api/admin/backup`, '_blank');
}

const governanceSocket = io(API_BASE === "" ? window.location.origin : API_BASE);

governanceSocket.on('system_broadcast', (data) => {
    const msg = data.message;
    const div = document.createElement('div');

    div.className = "fixed top-10 left-1/2 -translate-x-1/2 bg-brand-900 text-white px-6 py-4 rounded-xl shadow-2xl z-[300] flex items-center gap-4 animate-bounce-slight border border-white/10";
    div.innerHTML = `
        <span class="text-2xl">📢</span>
        <div>
            <p class="text-xs font-bold uppercase text-brand-100 opacity-60">System Announcement</p>
            <p class="font-bold text-sm">${msg}</p>
        </div>
        <button onclick="this.parentElement.remove()" class="bg-white/20 hover:bg-white/30 rounded-full w-6 h-6 flex items-center justify-center text-[10px]">✕</button>
    `;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 10000);
});

async function initAIModule() {
    const aiTextEl = document.getElementById('dash-ai-text');
    const aiStatsEl = document.getElementById('dash-ai-stats');

    if (!aiTextEl) return;

    aiTextEl.innerHTML = `<span class="animate-pulse opacity-50">Consulting AI model...</span>`;
    aiStatsEl.innerHTML = `<span>⏳</span> Syncing`;
    aiStatsEl.className = "w-fit px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-bold text-brand-100 flex items-center gap-2";

    try {
        const res = await fetch(`${API_BASE}/api/ai/analyze`);
        const data = await res.json();
        aiTextEl.style.opacity = 0;
        setTimeout(() => {
            aiTextEl.innerHTML = data.insight_text || "No insights available.";
            aiTextEl.style.opacity = 1;
            aiTextEl.classList.add('transition-opacity', 'duration-500');
        }, 200);

        let badgeClass = "bg-brand-500/20 text-brand-100 border-brand-500/30";
        let icon = "🤖";
        const status = data.status_badge || "Ready";

        if (status.includes('Critical') || status.includes('Warning')) {
            badgeClass = "bg-rose-500/20 text-rose-300 border-rose-500/30";
            icon = "🚨";
        } else if (status.includes('Healthy')) {
            badgeClass = "bg-[#7D8C7D]/20 text-white border-[#7D8C7D]/30";
            icon = "✅";
        }

        aiStatsEl.className = `w-fit px-2 py-1 rounded-lg text-[9px] font-bold border shadow-sm flex items-center gap-2 ${badgeClass}`;
        aiStatsEl.innerHTML = `<span>${icon}</span> ${status}`;

        if (data.recommended_order && data.recommended_order.length > 0) {
            renderAiSuggestions(data.recommended_order);
        }

    } catch (error) {
        console.error("AI Fetch Error:", error);
        aiTextEl.innerHTML = "Connection to LUX AI failed. Check your API key.";
        aiStatsEl.innerHTML = "Offline";
    }
}


function renderAiSuggestions(suggestions) {
    const container = document.getElementById('dash-ai-text').parentNode;
    const oldBtn = document.getElementById('ai-restock-btn');
    if (oldBtn) oldBtn.remove();

    const btn = document.createElement('button');
    btn.id = "ai-restock-btn";
    btn.className = "mt-4 w-full py-3 bg-[#7D8C7D] hover:bg-[#6B786B] rounded-xl text-xs font-bold text-white shadow-lg shadow-black/10 transition flex items-center justify-center gap-2 transform active:scale-95";
    btn.innerHTML = `<span>⚡</span> Review ${suggestions.length} AI Recommendations`;


    btn.onclick = () => openAiOverlay(suggestions);

    container.appendChild(btn);
}


function openAiOverlay(suggestions) {
    const overlay = document.getElementById('aiOverlay');
    const list = document.getElementById('aiRecommendationsList');

    if (!overlay || !list) return;

    list.innerHTML = '';

    if (!suggestions || suggestions.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-[#8D6E9E] opacity-70">
                <i class="fas fa-check-circle text-4xl mb-3"></i>
                <span class="text-sm font-bold">LUX detects no urgent issues.</span>
            </div>`;
    } else {
        suggestions.forEach(item => {

            const safeName = (item.item || 'Unknown').replace(/'/g, "\\'");
            const reason = item.reason || 'Recommended by LUX';
            const qty = item.qty || 10;
            const branch = item.branch || 'Main';


            list.innerHTML += `
            <div class="flex items-center justify-between p-4 mb-3 rounded-2xl bg-white border border-[#5E4074]/10 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-[#382546] to-[#5E4074]"></div>
                
                <div class="flex items-center gap-4 pl-3">
                    <div class="bg-[#5E4074]/10 text-[#5E4074] w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 shadow-sm border border-[#5E4074]/5">
                        📦
                    </div>
                    <div>
                        <h4 class="font-extrabold text-[#382546] text-sm leading-tight">${item.item}</h4>
                        <p class="text-[10px] text-white font-bold uppercase tracking-wide mt-1.5 bg-[#8D6E9E] w-fit px-2 py-0.5 rounded-md shadow-sm">
                            ${reason}
                        </p>
                    </div>
                </div>

                <div class="flex flex-col items-end gap-2">
                    <span class="text-xs font-bold text-[#8D6E9E]">Qty: <span class="text-[#382546] text-lg font-extrabold">${qty}</span></span>
                    
                    <button onclick="openRestockModal('${safeName}', '${branch}', 0); setTimeout(() => { document.getElementById('restock_qty').value = ${qty}; }, 100); closeAiOverlay();" 
                        class="px-4 py-2 rounded-xl bg-[#5E4074] hover:bg-[#382546] text-white text-xs font-bold transition shadow-md hover:shadow-lg active:scale-95 flex items-center gap-2">
                        <span>Order Now</span>
                        <i class="fas fa-arrow-right"></i>
                    </button>
                </div>
            </div>
            `;
        });
    }

    overlay.classList.remove('hidden');
}

function closeAiOverlay() {
    const overlay = document.getElementById('aiOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function runHeuristicAnalysis(items) {
    if (!items || items.length === 0) {
        return { message: "Inventory is empty. Add stock to generate predictive insights.", stat: "0 Items" };
    }

    let criticalItem = null;
    let lowestDaysLeft = 999;
    let totalValue = 0;
    let deadStockCount = 0;

    items.forEach(item => {

        const price = parseFloat(item.price) || 0;
        const qty = parseInt(item.quantity) || 0;
        const usage = parseInt(item.monthly_usage) || 1;
        totalValue += price * qty;


        if (usage > 0 && qty > 0) {
            const daysLeft = (qty / usage) * 30;
            if (daysLeft < lowestDaysLeft) {
                lowestDaysLeft = daysLeft;
                criticalItem = item;
            }
        }

        if (qty > (usage * 6)) {
            deadStockCount++;
        }
    });


    if (criticalItem && lowestDaysLeft <= 7) {
        const days = Math.round(lowestDaysLeft);
        return {
            message: `⚠️ <b>Critical Alert:</b> Based on current consumption velocity, <span class="text-rose-300 font-bold">${criticalItem.name}</span> will be fully depleted in approximately <b>${days} days</b>. Immediate procurement is recommended to avoid operational disruption.`,
            stat: `📉 High Velocity: ${criticalItem.name}`
        };
    }

    if (deadStockCount > 3) {
        return {
            message: `📊 <b>Efficiency Insight:</b> I've detected <b>${deadStockCount} items</b> that are overstocked (exceeding 6 months of supply). This ties up roughly <b>₱${(totalValue * 0.15).toLocaleString()}</b> in stagnant capital. Consider running a promotion or reducing order frequency.`,
            stat: `🐢 ${deadStockCount} Slow Movers`
        };
    }


    return {
        message: `✅ <b>System Optimal:</b> Inventory health is stable. Your total holding value is <b>₱${totalValue.toLocaleString()}</b>. No critical stockouts predicted for the next 14 days. Great job maintaining balance!`,
        stat: `💰 Value: ₱${(totalValue / 1000).toFixed(1)}k`
    };
}


function typeWriterEffect(element, html) {
    element.innerHTML = "";
    element.classList.remove('animate-pulse');

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    element.innerHTML = html;
    element.classList.add('animate-fade-in');
}


function toggleLuxChat() {
    const windowEl = document.getElementById('luxChatWindow');
    const btn = document.getElementById('luxChatBtn');
    if (!windowEl || !btn) return;

    if (windowEl.classList.contains('hidden')) {
        windowEl.classList.remove('hidden');
        setTimeout(() => {
            windowEl.classList.remove('scale-95', 'opacity-0');
            windowEl.classList.add('scale-100', 'opacity-100');
        }, 10);
        btn.classList.add('hidden');
    } else {
        windowEl.classList.add('hidden');
        btn.classList.remove('hidden');
    }
}

function handleLuxImageSelect() {
    const input = document.getElementById('luxImageInput');
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = function () {
        currentLuxImageBase64 = reader.result;
        const preview = document.getElementById('luxImagePreview');
        const img = document.getElementById('luxPreviewImg');
        img.src = currentLuxImageBase64;
        preview.classList.remove('hidden');
    }
    reader.readAsDataURL(file);
}

function clearLuxImage() {
    currentLuxImageBase64 = null;
    document.getElementById('luxImageInput').value = "";
    document.getElementById('luxImagePreview').classList.add('hidden');
}

async function sendLuxMessage(e) {
    if (e) e.preventDefault();

    const input = document.getElementById('luxChatInput');
    const msg = input.value.trim();

    if (!msg && !currentLuxImageBase64) return;

    let displayMsg = msg;
    if (currentLuxImageBase64) {
        displayMsg += `<br><img src="${currentLuxImageBase64}" class="mt-2 rounded-lg w-32 h-32 object-cover border border-white/20">`;
    }

    addChatBubble(displayMsg, 'user');
    input.value = '';

    const imageToSend = currentLuxImageBase64;
    clearLuxImage();

    const thinkingId = addChatBubble('<i class="fas fa-circle-notch fa-spin"></i> Analyzing...', 'lux', true);

    try {
        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ message: msg, image: imageToSend })
        });

        const responseData = await res.json();

        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.remove();

        if (responseData.type === 'error') {
            addChatBubble("⚠️ " + responseData.text, 'lux');
        } else {
            let formattedText = responseData.text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
            addChatBubble(formattedText, 'lux');
        }
    } catch (err) {
        console.error(err);
        document.getElementById(thinkingId)?.remove();
        addChatBubble("Sorry, LUX is currently offline.", 'lux');
    }
}

function addChatBubble(text, sender, isThinking = false) {
    const container = document.getElementById('luxChatMessages');
    const id = 'msg-' + Date.now();
    const isUser = sender === 'user';

    const userStyle = "bg-[#5E4074] text-white rounded-br-none shadow-md";
    const luxStyle = "bg-white border border-slate-100 text-slate-600 rounded-tl-none shadow-sm";
    const align = isUser ? "self-end flex-row-reverse" : "self-start";
    const avatar = isUser
        ? `<div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs shrink-0 text-slate-500"><i class="fas fa-user"></i></div>`
        : `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-[#382546] to-[#5E4074] flex items-center justify-center text-xs text-white shrink-0 shadow-sm"><i class="fas fa-tooth"></i></div>`;

    const html = `
    <div id="${id}" class="flex gap-3 max-w-[85%] ${align} ${isThinking ? 'animate-pulse' : 'animate-fade-in-up'}">
        ${avatar}
        <div class="p-3 rounded-2xl text-sm leading-relaxed ${isUser ? userStyle : luxStyle}">
            ${text}
        </div>
    </div>`;

    container.insertAdjacentHTML('beforeend', html);
    container.scrollTop = container.scrollHeight;

    return id;
}

async function fetchPriceInsights() {
    const list = document.getElementById('lux-price-prediction-list');
    const summaryEl = document.getElementById('lux-market-summary');
    const statusEl = document.getElementById('lux-market-status');

    try {
        const res = await fetch(`${API_BASE}/api/ai/market-intelligence`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        let summaryText = "Market analysis unavailable.";
        if (typeof data.market_summary === 'string') {
            summaryText = data.market_summary;
        } else if (typeof data.market_summary === 'object') {
            summaryText = data.market_summary.text || JSON.stringify(data.market_summary);
        }

        if (summaryEl) summaryEl.textContent = `"${summaryText}"`;
        if (statusEl) statusEl.innerHTML = `<span class="animate-pulse">●</span> Live Feed`;
        if (list) {
            list.innerHTML = "";
            if (!data.predictions || data.predictions.length === 0) {
                list.innerHTML = `<div class="text-center text-slate-400 text-xs py-4">No enough data for predictions.</div>`;
                return;
            }

            data.predictions.forEach(pred => {
                const trendColor = pred.trend === 'Rising' ? 'text-rose-500' : 'text-emerald-500';
                const trendIcon = pred.trend === 'Rising' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
                const priceVal = parseFloat(pred.forecast);
                const displayPrice = isNaN(priceVal)
                    ? "Check Price"
                    : `₱${priceVal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

                list.innerHTML += `
                <div class="p-4 rounded-2xl bg-white border border-slate-100 hover:border-brand-500/30 transition group shadow-sm">
                    <div class="flex justify-between items-start mb-1">
                        <span class="font-bold text-slate-800 text-sm">${pred.item}</span>
                        <span class="text-[9px] font-black uppercase ${trendColor} flex items-center gap-1">
                            <i class="fas ${trendIcon}"></i> ${pred.trend}
                        </span>
                    </div>
                    <div class="text-[10px] text-brand-600 font-bold mb-3 flex items-center gap-1">
                        <i class="fas fa-truck-field"></i> ${pred.supplier || 'General'}
                    </div>
                    <div class="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
                        <span class="text-[9px] text-slate-400 font-bold uppercase">LUX Prediction</span>
                        <span class="text-xs font-extrabold text-[#382546]">${displayPrice}</span>
                    </div>
                    <p class="mt-2 text-[10px] text-slate-500 italic leading-relaxed">Advice: ${pred.advice}</p>
                </div>`;
            });
        }
    } catch (err) {
        console.error("Market Insight Error:", err);
        if (summaryEl) summaryEl.textContent = "LUX is currently calculating trends...";
    }
}


function toggleUserPassword() {
    const passInput = document.getElementById('userPassword');
    const passIcon = document.getElementById('userPassIcon');

    if (!passInput || !passIcon) return;

    if (passInput.type === 'password') {
        passInput.type = 'text';
        passIcon.classList.remove('fa-eye');
        passIcon.classList.add('fa-eye-slash');
        passIcon.classList.add('text-brand-600');
    } else {
        passInput.type = 'password';
        passIcon.classList.remove('fa-eye-slash');
        passIcon.classList.add('fa-eye');
        passIcon.classList.remove('text-brand-600');
    }
}

async function openAiRestockModal() {
    const modal = document.getElementById('aiRestockModal');
    const tbody = document.getElementById('aiRestockTableBody');
    const btn = document.getElementById('confirmAiBtn');

    modal.classList.remove('hidden');
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10"><i class="fas fa-circle-notch fa-spin text-brand-600 text-2xl"></i><p class="mt-2 text-brand-800 font-bold">LUX is analyzing stock levels...</p></td></tr>`;
    btn.disabled = true;
    btn.classList.add('opacity-50');

    try {
        const res = await fetch(`${API_BASE}/api/ai/generate-restock-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);
        if (!data.recommendations || data.recommendations.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-500 font-bold">✅ Inventory is healthy. LUX found no issues.</td></tr>`;
            return;
        }

        aiSuggestedOrders = data.recommendations;
        tbody.innerHTML = '';

        aiSuggestedOrders.forEach((rec, index) => {

            const row = `
                <tr id="ai-row-${index}" class="hover:bg-brand-50/50 transition">
                    <td class="p-3 font-bold text-slate-800">${rec.item}</td>
                    <td class="p-3 text-slate-600">${rec.branch}</td>
                    <td class="p-3">
                        <input type="number" id="ai-qty-${index}" value="${rec.quantity}" class="w-16 p-1 border border-brand-100 rounded text-center font-bold focus:border-brand-600 outline-none text-brand-900">
                    </td>
                    <td class="p-3 text-brand-600 font-bold text-[10px] uppercase">${rec.reason}</td>
                    <td class="p-3 text-center">
                        <button onclick="removeAiRow(${index})" class="text-rose-400 hover:text-rose-600"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

        btn.disabled = false;
        btn.classList.remove('opacity-50');

    } catch (err) {
        console.error("LUX Error:", err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose-500 font-bold">❌ ${err.message || "LUX Analysis Failed"}</td></tr>`;
    }
}

function closeAiRestockModal() {
    document.getElementById('aiRestockModal').classList.add('hidden');
}

function removeAiRow(index) {
    document.getElementById(`ai-row-${index}`).remove();
    aiSuggestedOrders[index] = null;
}


async function confirmAiOrders() {

    showOverlay("Creating your orders...");

    closeAiRestockModal();

    let count = 0;

    for (let i = 0; i < aiSuggestedOrders.length; i++) {
        const rec = aiSuggestedOrders[i];
        if (!rec) continue;

        const inputEl = document.getElementById(`ai-qty-${i}`);
        const qtyToOrder = inputEl ? inputEl.value : rec.quantity;

        try {
            await fetch(`${API_BASE}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item: rec.item,
                    branch: rec.branch,
                    quantity: parseInt(qtyToOrder),
                    supplier: "LUX Auto-Restock",
                    status: "pending"
                })
            });
            count++;
        } catch (err) {
            console.error("Order failed for", rec.item);
        }
    }

    await fetchOrders();
    hideOverlay();
    alert(`🎉 Success! ${count} orders created.`);
}


function showOverlay(message = "Processing...") {
    const overlay = document.getElementById('globalLoadingOverlay');
    const text = document.getElementById('globalLoadingText');
    if (overlay && text) {
        text.innerText = message;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('opacity-100'), 10);
    }
}

function hideOverlay() {
    const overlay = document.getElementById('globalLoadingOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}
function setPredictionHorizon(days) {
    currentPredictionHorizon = days;

    const options = [
        { id: "pred-horizon-7", value: 7 },
        { id: "pred-horizon-30", value: 30 },
        { id: "pred-horizon-60", value: 60 },
    ];

    options.forEach(opt => {
        const btn = document.getElementById(opt.id);
        if (!btn) return;
        if (opt.value === days) {
            btn.className =
                "px-2 py-1 rounded-full border border-brand-500 bg-brand-50 text-brand-700 text-[10px]";
        } else {
            btn.className =
                "px-2 py-1 rounded-full border border-slate-200 text-slate-600 hover:border-brand-500 hover:text-brand-700 text-[10px]";
        }
    });

    if (currentProcurementTab === "predictive") {
        fetchPredictiveRestock(true);
    }
}

function switchProcurementTab(tab) {
    currentProcurementTab = tab;

    const btnPred = document.getElementById('tab-predictive');
    const btnRepl = document.getElementById('tab-replenish');

    if (tab === 'predictive') {

        btnPred.className = "px-4 py-2 rounded-lg text-xs font-bold text-brand-900 bg-white shadow-sm transition flex items-center gap-2";
        btnPred.innerHTML = `<i class="fas fa-crystal-ball text-brand-600"></i> LUX Prediction`;
        btnRepl.className = "px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-700 transition flex items-center gap-2";
        btnRepl.innerHTML = `<i class="fas fa-calculator"></i> LUX Auto-Replenish`;

        fetchPredictiveRestock(true);

    } else {

        btnPred.className = "px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-700 transition flex items-center gap-2";
        btnPred.innerHTML = `<i class="fas fa-crystal-ball"></i> LUX Prediction`;
        btnRepl.className = "px-4 py-2 rounded-lg text-xs font-bold text-brand-900 bg-white shadow-sm transition flex items-center gap-2";
        btnRepl.innerHTML = `<i class="fas fa-calculator text-brand-600"></i> LUX Auto-Replenish`;
        fetchReplenishmentRecommendations(true);
    }
}

async function fetchFinances() {
    document.getElementById('fin-asset-val').innerHTML = '<i class="fas fa-circle-notch fa-spin text-sm"></i>';

    try {
        const res = await fetch(`${API_BASE}/api/finances/summary`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        animateValue('fin-asset-val', data.asset_value);
        animateValue('fin-spend-val', data.monthly_spend);
        animateValue('fin-usage-val', data.monthly_usage);

        if (data.chart_data) {
            renderFinanceChart(data.chart_data);
        } else {
            renderFinanceChart({
                labels: ['Current'],
                spend: [data.monthly_spend],
                usage: [data.monthly_usage]
            });
        }

    } catch (err) {
        console.error("Finance Error:", err);
        document.getElementById('fin-asset-val').textContent = "Err";
    }
}



function animateValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const safeValue = Number(value) || 0;
    el.textContent = `₱${safeValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

let financeChartInstance = null;

function renderFinanceChart(chartData) {
    const ctx = document.getElementById('financeMainChart').getContext('2d');

    if (financeChartInstance) financeChartInstance.destroy();

    const colorWine = '#5E4074';
    const colorRed = '#f43f5e';

    const gradientWine = ctx.createLinearGradient(0, 0, 0, 400);
    gradientWine.addColorStop(0, colorWine);
    gradientWine.addColorStop(1, '#382546');
    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Consumption Value (Usage)',
                    data: chartData.usage,
                    backgroundColor: gradientWine,
                    borderRadius: 6,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7,
                    order: 1
                },
                {
                    label: 'Restock Spend (Cost)',
                    data: chartData.spend,
                    backgroundColor: colorRed,
                    borderRadius: 6,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7,
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: { usePointStyle: true }
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.9)',
                    padding: 12,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9', borderDash: [5, 5] },
                    ticks: {
                        callback: function (value) {
                            return new Intl.NumberFormat('en-PH', {
                                style: 'currency',
                                currency: 'PHP',
                                notation: "compact",
                                compactDisplay: "short"
                            }).format(value);
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { weight: 'bold' } }
                }
            }
        }
    });
}


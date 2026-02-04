// ===== РАБОЧИЕ ДНИ =====
const RUSSIAN_HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-07', '2026-02-23', '2026-03-08',
  '2026-05-01', '2026-05-09', '2026-06-12', '2026-11-04'
];

function addCalendarDays(startDate, days) {
  let date = new Date(startDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function addWorkingDays(startDate, workdays) {
  let date = new Date(startDate);
  let daysAdded = 0;
  while (daysAdded < workdays) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const dateStr = date.toISOString().split('T')[0];
    if (RUSSIAN_HOLIDAYS_2026.includes(dateStr)) continue;
    daysAdded++;
  }
  return date.toISOString().split('T')[0];
}

function clearForm() {
  ['orderNumber','orderDate','deliveryDate14','deliveryDate45',
   'client1','client2','orderComment']
  .forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('itemsList').innerHTML = '';
}

function showAlert(message, focusElementId = null) {
  const existingAlert = document.getElementById('customAlert');
  if (existingAlert) existingAlert.remove();
  
  const alertDiv = document.createElement('div');
  alertDiv.id = 'customAlert';
  alertDiv.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 2000;">
      <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; min-width: 300px;">
        <p style="margin: 0 0 15px 0;">${message}</p>
        <button id="alertOkBtn" style="padding: 8px 16px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(alertDiv);
  
  document.getElementById('alertOkBtn').onclick = () => {
    document.body.removeChild(alertDiv);
    if (focusElementId) {
      setTimeout(() => document.getElementById(focusElementId).focus(), 100);
    }
  };
}

function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 🔥 НАДЁЖНАЯ СИНХРОНИЗАЦИЯ
async function syncWithSheets() {
  try {
    showAlert('🔄 Синхронизация...');
    const orders = await orderManager.loadOrders();
    
    if (orders.length === 0) {
      showAlert('📭 Нет заказов');
      return;
    }

    const syncData = {
      orders: orders.map(order => ({
        number: order.number,
        createdAt: order.createdAt,
        products: order.items.map(i => i.name).join(', '),
        clients: order.clients?.map(c => c.full || '').join('; ') || '',
        comment: order.comment || '',
        delivery14: order.delivery14,
        statuses: order.items.map(i => Object.keys(i.statuses || {}).filter(k => i.statuses[k]).join(',')).join('; ')
      })),
      timestamp: new Date().toISOString(),
      count: orders.length,
      device: navigator.userAgent.includes('Electron') ? 'Windows' : 'Android'
    };

    const jsonStr = JSON.stringify(syncData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `umishka_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await navigator.clipboard.writeText(jsonStr);
    showAlert(`✅ ${orders.length} заказов\n📱 Android: ☁️ (двойной клик)`);
    
  } catch(error) {
    showAlert(`❌ Ошибка: ${error.message}`);
  }
}

// 🔥 ИМПОРТ
async function importFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text);
    
    if (!data.orders) {
      showAlert('❌ Неверный формат');
      return;
    }
    
    const currentOrders = await orderManager.loadOrders();
    const existingNumbers = currentOrders.map(o => o.number);
    const newOrders = data.orders.filter(order => !existingNumbers.includes(order.number));
    
    if (newOrders.length === 0) {
      showAlert('✅ Все заказы уже есть');
      return;
    }
    
    const convertedOrders = newOrders.map(order => ({
      number: order.number,
      createdAt: order.createdAt,
      clients: order.clients ? [{ full: order.clients }] : [],
      items: [{ name: order.products, price: 0, statuses: {} }],
      comment: order.comment,
      delivery14: order.delivery14,
      delivery45: addCalendarDays(order.createdAt, 45),
      id: `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }));
    
    const allOrders = [...currentOrders, ...convertedOrders];
    await orderManager.saveOrders(allOrders);
    orderManager.reRenderAll();
    applySearchFilters();
    showAlert(`✅ +${newOrders.length} заказов!`);
  } catch(e) {
    showAlert('❌ Скопируй данные с Windows!');
  }
}

// ===== OrderManager =====
class OrderMgr {
  constructor() {
    this.dbKey = 'umishka_orders_v2';
    this.autoCompleteItems = new Set();
    this.init();
  }

  init() {
    this.loadOrders().then(orders => {
      orders.forEach(order => this.renderOrder(order));
      this.updateNoOrdersMessage();
    });
  }

  async loadOrders() {
    try {
      const data = localStorage.getItem(this.dbKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async saveOrders(orders) {
    try {
      localStorage.setItem(this.dbKey, JSON.stringify(orders));
      return true;
    } catch {
      throw new Error('Ошибка сохранения');
    }
  }

  async addOrder(order) {
    const orders = await this.loadOrders();
    order.id = Date.now().toString();
    order.createdAt = new Date().toISOString().split('T')[0];
    order.delivery14 = addWorkingDays(order.createdAt, 14);
    order.delivery45 = addCalendarDays(order.createdAt, 45);
    orders.unshift(order);
    await this.saveOrders(orders);
    this.renderOrder(order);
    this.updateNoOrdersMessage();
    this.updateAutoComplete(order.items.map(i => i.name));
    setTimeout(syncWithSheets, 1500);
  }

  async updateOrder(id, updatedOrder) {
    const orders = await this.loadOrders();
    const index = orders.findIndex(o => o.id === id);
    if (index !== -1) {
      const baseOrder = orders[index];
      const createdAt = updatedOrder.createdAt || baseOrder.createdAt;
      orders[index] = { 
        ...baseOrder, ...updatedOrder, createdAt,
        delivery14: addWorkingDays(createdAt, 14),
        delivery45: addCalendarDays(createdAt, 45)
      };
      await this.saveOrders(orders);
      this.reRenderAll();
      setTimeout(syncWithSheets, 1500);
    }
  }

  async deleteOrder(id) {
    const orders = await this.loadOrders();
    const newOrders = orders.filter(o => o.id !== id);
    await this.saveOrders(newOrders);
    this.reRenderAll();
    setTimeout(syncWithSheets, 1500);
  }

  updateAutoComplete(items) {
    items.forEach(item => this.autoCompleteItems.add(item));
    this.updateDatalist();
  }

  updateDatalist() {
    const datalist = document.getElementById('autocomplete-items');
    if (!datalist) return;
    datalist.innerHTML = '';
    Array.from(this.autoCompleteItems).forEach(item => {
      const option = document.createElement('option');
      option.value = item;
      datalist.appendChild(option);
    });
  }

  reRenderAll() {
    document.getElementById('ordersList').innerHTML = '';
    this.loadOrders().then(orders => {
      orders.sort((a, b) => {
        const sortType = document.getElementById('sortSelect')?.value || 'date-desc';
        if (sortType.startsWith('date')) {
          const dateA = new Date(a.createdAt);
          const dateB = new Date(b.createdAt);
          const dateDiff = dateA - dateB;
          if (dateDiff !== 0) return sortType === 'date-desc' ? dateDiff * -1 : dateDiff;
        }
        const numA = parseInt(a.number.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.number.replace(/\D/g, ''), 10) || 0;
        return sortType.includes('desc') ? (numA - numB) * -1 : numA - numB;
      });
      orders.forEach(order => this.renderOrder(order));
      this.updateNoOrdersMessage();
      applySearchFilters();
    });
  }

  renderOrder(order) {
    const row = document.createElement('tr');
    const today = new Date();
    const daysLeft14 = (new Date(order.delivery14) - today) / (1000 * 60 * 60 * 24);
    const daysLeft45 = (new Date(order.delivery45) - today) / (1000 * 60 * 60 * 24);

    let rowClass = 'normal';
    if (order.items.some(i => i.statuses?.returned)) {
      rowClass = 'returned';
    } else if (daysLeft45 < 0) {
      rowClass = 'overdue-45';
    } else if (daysLeft45 <= 5) {
      rowClass = 'warning-45';
    } else if (daysLeft14 < 0) {
      rowClass = 'overdue-14';
    } else if (daysLeft14 <= 5) {
      rowClass = 'warning-14';
    }
    row.className = rowClass;

    const statusIcons = order.items.map(item => 
      Object.entries(item.statuses || {})
        .filter(([key, val]) => val)
        .map(([key]) => ({received:'✅', notified:'📣', issued:'📦', returned:'🔁'}[key]))
        .join('')
    ).filter(s => s).join(' ');

    const safeClients = (order.clients || []).map(c => {
      if (c.full) return escapeHtml(c.full);
      return escapeHtml((c.name || '') + ' ' + (c.phone || ''));
    }).filter(Boolean).join('<br>');

    row.innerHTML = `
      <td style="display:none;">${order.id.slice(-6)}</td>
      <td>${escapeHtml(order.number)}<br><small>${order.createdAt}</small></td>
      <td>${order.items.map(i => escapeHtml(i.name)).join(', ')}</td>
      <td>${safeClients || '—'}</td>
      <td>${statusIcons || '—'}</td>
      <td>${order.delivery14}</td>
      <td>
        <button class="btn-edit" data-id="${order.id}">✏️</button>
        <button class="btn-delete" data-id="${order.id}">🗑️</button>
      </td>
    `;
    document.getElementById('ordersList').appendChild(row);
  }

  updateNoOrdersMessage() {
    const tableBody = document.getElementById('ordersList');
    const hasOrders = tableBody.children.length > 0;
    document.getElementById('noOrders').style.display = hasOrders ? 'none' : 'block';
  }
}

const orderManager = new OrderMgr();
let currentEditId = null;
let isSubmitting = false;
let syncClickCount = 0;

function addItemRow(item = null) {
  const container = document.getElementById('itemsList');
  const itemDiv = document.createElement('div');
  itemDiv.className = 'item';
  itemDiv.innerHTML = `
    <div class="item-row">
      <input type="text" class="itemName" placeholder="Название товара" list="autocomplete-items" value="${item?.name || ''}">
      <input type="number" class="itemPrice" placeholder="Цена" min="0" value="${item?.price || ''}">
      <button type="button" class="removeItemBtn">×</button>
    </div>
    <div class="statuses">
      <label><input type="checkbox" class="status" data-status="received" ${item?.statuses?.received ? 'checked' : ''}> ✅ Получен <span class="status-date">${item?.statusesDate?.received || ''}</span></label>
      <label><input type="checkbox" class="status" data-status="notified" ${item?.statuses?.notified ? 'checked' : ''}> 📣 Уведомлен <span class="status-date">${item?.statusesDate?.notified || ''}</span></label>
      <label><input type="checkbox" class="status" data-status="issued" ${item?.statuses?.issued ? 'checked' : ''}> 📦 Выдан <span class="status-date">${item?.statusesDate?.issued || ''}</span></label>
      <label><input type="checkbox" class="status" data-status="returned" ${item?.statuses?.returned ? 'checked' : ''}> 🔁 Возврат <span class="status-date">${item?.statusesDate?.returned || ''}</span></label>
    </div>
  `;
  
  itemDiv.querySelector('.removeItemBtn').onclick = () => itemDiv.remove();
  itemDiv.querySelectorAll('.status').forEach(cb => {
    cb.onchange = function() {
      if (this.checked) {
        const dateSpan = this.parentNode.querySelector('.status-date');
        dateSpan.textContent = new Date().toLocaleDateString('ru-RU');
      }
    };
  });
  
  container.appendChild(itemDiv);
}

async function openModal(editId) {
  currentEditId = editId;
  document.getElementById('modal').style.display = 'block';
  document.getElementById('modalTitle').textContent = editId ? 'Редактировать заказ' : 'Новый заказ';
  document.getElementById('deleteBtn').style.display = editId ? 'inline-block' : 'none';
  
  clearForm();

  if (!editId) {
    const number = await generateSequentialNumber();
    document.getElementById('orderNumber').value = number;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('orderDate').value = today;
    document.getElementById('deliveryDate14').value = addWorkingDays(today, 14);
    document.getElementById('deliveryDate45').value = addCalendarDays(today, 45);
    addItemRow();
  } else {
    loadOrderForEdit(editId);
  }
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  currentEditId = null;
  clearForm();
  const alert = document.getElementById('customAlert');
  if (alert) alert.remove();
}

async function loadOrderForEdit(id) {
  const orders = await orderManager.loadOrders();
  const order = orders.find(o => o.id === id);
  if (order) {
    document.getElementById('orderNumber').value = order.number || '';
    document.getElementById('orderDate').value = order.createdAt || '';
    document.getElementById('deliveryDate14').value = order.delivery14 || '';
    document.getElementById('deliveryDate45').value = order.delivery45 || '';
    document.getElementById('orderComment').value = order.comment || '';

    const client1 = order.clients?.[0] || {};
    const client2 = order.clients?.[1] || {};
    
    document.getElementById('client1').value = client1.full || (client1.name ? client1.name + ' ' + (client1.phone || '') : client1.phone || '');
    document.getElementById('client2').value = client2.full || (client2.name ? client2.name + ' ' + (client2.phone || '') : client2.phone || '');

    document.getElementById('itemsList').innerHTML = '';
    order.items.forEach(item => addItemRow(item));
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  try {
    const client1 = document.getElementById('client1').value.trim();
    const client2 = document.getElementById('client2').value.trim();

    const formData = {
      number: document.getElementById('orderNumber').value.trim(),
      clients: [],
      items: [],
      comment: document.getElementById('orderComment').value.trim(),
      createdAt: document.getElementById('orderDate').value
    };

    if (client1) formData.clients.push({ full: client1 });
    if (client2) formData.clients.push({ full: client2 });

    document.querySelectorAll('.item').forEach(itemEl => {
      const name = itemEl.querySelector('.itemName').value.trim();
      if (!name) return;
      const statuses = {};
      const statusesDate = {};
      itemEl.querySelectorAll('.status').forEach(cb => {
        statuses[cb.dataset.status] = cb.checked;
        if (cb.checked) {
          const dateSpan = cb.parentNode.querySelector('.status-date');
          statusesDate[cb.dataset.status] = dateSpan.textContent;
        }
      });
      formData.items.push({
        name,
        price: parseFloat(itemEl.querySelector('.itemPrice').value) || 0,
        statuses,
        statusesDate
      });
    });

    if (formData.items.length === 0) {
      showAlert('Добавьте товар', 'addItemBtn');
      return;
    }

    if (!formData.number.match(/^№\d{4}$/)) {
      showAlert('Номер: №0001', 'orderNumber');
      return;
    }

    if (currentEditId) {
      await orderManager.updateOrder(currentEditId, formData);
    } else {
      await orderManager.addOrder(formData);
    }
    closeModal();
  } catch (error) {
    showAlert('Ошибка: ' + error.message);
  } finally {
    isSubmitting = false;
  }
}

function deleteOrderFromModal() {
  if (currentEditId && confirm('Удалить заказ?')) {
    orderManager.deleteOrder(currentEditId);
    closeModal();
  }
}

async function deleteOrderConfirm(id) {
  const orders = await orderManager.loadOrders();
  const order = orders.find(o => o.id === id);
  const number = order?.number || `заказ ${id.slice(-6)}`;
  if (confirm(`Удалить ${number}?`)) {
    await orderManager.deleteOrder(id);
  }
}

async function generateSequentialNumber() {
  const orders = await orderManager.loadOrders();
  const nums = orders
    .map(o => o.number)
    .filter(n => n && n.startsWith('№'))
    .map(n => parseInt(n.replace('№', ''), 10))
    .filter(n => !isNaN(n));
  const lastNumber = nums.length > 0 ? Math.max(...nums) : 0;
  return `№${(lastNumber + 1).toString().padStart(4, '0')}`;
}

function setupSearchFilter() {
  document.getElementById('searchInput').oninput = debounce(() => {
    applySearchFilters();
  }, 300);
  
  document.getElementById('filterSelect').onchange = () => {
    applySearchFilters();
  };
  
  document.getElementById('sortSelect').onchange = () => {
    orderManager.reRenderAll();
  };
}

function applySearchFilters() {
  const mainQuery = document.getElementById('searchInput').value.trim().toLowerCase();
  const filter = document.getElementById('filterSelect').value;
  const rows = document.querySelectorAll('#ordersList tr');
  const today = new Date();

  rows.forEach(row => {
    let mainMatches = true;
    if (mainQuery) {
      const orderCell = row.cells[1]?.textContent?.toLowerCase() || '';
      const itemsCell = row.cells[2]?.textContent?.toLowerCase() || '';
      const clientsCell = row.cells[3]?.textContent?.toLowerCase() || '';
      mainMatches = orderCell.includes(mainQuery) || itemsCell.includes(mainQuery) || clientsCell.includes(mainQuery);
    }

    let filterMatches = true;
    if (filter !== 'all') {
      const dateCell = row.cells[1]?.querySelector('small');
      const orderDateStr = dateCell?.textContent || '';
      const orderDate = orderDateStr ? new Date(orderDateStr) : null;
      const rowClass = row.className;

      switch (filter) {
        case 'new':
          if (orderDate) {
            const diffDays = Math.ceil(Math.abs(today - orderDate) / (1000 * 60 * 60 * 24));
            filterMatches = diffDays <= 2;
          }
          break;
        case 'ok':
          filterMatches = !rowClass.includes('overdue') && !rowClass.includes('returned');
          break;
        case 'overdue14': filterMatches = rowClass.includes('overdue-14'); break;
        case 'overdue45': filterMatches = rowClass.includes('overdue-45'); break;
        case 'overdue': filterMatches = rowClass.includes('overdue'); break;
        case 'returned': filterMatches = rowClass.includes('returned'); break;
        case 'received': filterMatches = row.textContent.includes('✅'); break;
      }
    }

    row.style.display = mainMatches && filterMatches ? '' : 'none';
  });

  const visibleRows = Array.from(rows).filter(row => row.style.display !== 'none');
  document.getElementById('noOrders').style.display = visibleRows.length > 0 ? 'none' : 'block';
}

function debounce(func, wait) {
  let timeout;
  let lastCall = 0;
  return function executedFunction(...args) {
    const now = Date.now();
    clearTimeout(timeout);
    if (now - lastCall > 100) {
      func(...args);
      lastCall = now;
    } else {
      timeout = setTimeout(() => func(...args), wait);
    }
  };
}

function setupEventListeners() {
  document.getElementById('newOrderBtn').onclick = () => openModal(null);
  document.querySelectorAll('.close, .close-modal').forEach(el => el.onclick = closeModal);
  document.getElementById('orderForm').onsubmit = handleFormSubmit;
  document.getElementById('addItemBtn').onclick = addItemRow;
  document.getElementById('deleteBtn').onclick = deleteOrderFromModal;
  document.getElementById('refreshBtn').onclick = () => orderManager.reRenderAll();
  
  document.getElementById('syncBtn').onclick = () => {
    syncClickCount++;
    setTimeout(() => {
      if (syncClickCount === 1) syncWithSheets();
      else if (syncClickCount === 2) importFromClipboard();
      syncClickCount = 0;
    }, 300);
  };

  document.getElementById('totalBtn').onclick = async () => {
    const orders = await orderManager.loadOrders();
    const total = orders.reduce((sum, order) => 
      sum + order.items.reduce((itemSum, item) => itemSum + (item.price || 0), 0), 0
    );
    alert(`💰 ${total.toLocaleString()} ₽ (${orders.length} заказов)`);
  };

  document.getElementById('exportBtn').onclick = async () => {
    const orders = await orderManager.loadOrders();
    if (orders.length === 0) {
      showAlert('Нет данных');
      return;
    }

    let csv = 'ID;Номер;Дата;Товары;Клиенты;Статусы\n';
    orders.forEach(order => {
      const items = order.items.map(i => `${i.name} (${i.price}₽)`).join(', ');
      const clients = (order.clients || []).map(c => c.full || c.phone || c.name || '').join(', ');
      const statuses = order.items.map(i => 
        Object.entries(i.statuses || {})
         .filter(([k, v]) => v)
         .map(([k]) => ({received:'Получен', notified:'Уведомлен', issued:'Выдан', returned:'Возврат'}[k]))
         .join(',')
      ).filter(s => s).join('; ');

      csv += `"${order.id.slice(-6)}";"${order.number}";"${order.createdAt}";"${items}";"${clients}";"${statuses}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `заказы_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  setupSearchFilter();
  document.addEventListener('click', e => {
    if (e.target.classList.contains('btn-edit')) openModal(e.target.dataset.id);
    if (e.target.classList.contains('btn-delete')) deleteOrderConfirm(e.target.dataset.id);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const datalist = document.createElement('datalist');
  datalist.id = 'autocomplete-items';
  document.body.appendChild(datalist);
  setupEventListeners();
});

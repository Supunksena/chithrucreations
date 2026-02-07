// Initialize Dexie Database
const db = new Dexie('CommCentreDB');
db.version(1).stores({
    products: '++id, name, barcode, category, costPrice, sellingPrice, stockQuantity, dateAdded',
    sales: '++id, date, subTotal, discount, totalAmount, paymentMethod, items',
    jobs: '++id, customerName, contact, jobType, totalAmount, advance, status, deadline, dateCreated'
});

// App State
const state = {
    cart: [],
    currentView: 'dashboard',
    products: [],
    jobs: []
};

// Router
const router = {
    navigate: (targetId) => {
        // Hide all views
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('border-primary', 'text-gray-900'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.add('border-transparent', 'text-gray-500'));

        // Show target view
        const targetView = document.getElementById(`view-${targetId}`);
        if (targetView) {
            targetView.classList.remove('hidden');
            if (targetId === 'pos') targetView.classList.add('flex'); // POS uses flex layout
        }

        // Update Nav State
        const navBtn = document.querySelector(`.nav-item[data-target="${targetId}"]`);
        if (navBtn) {
            navBtn.classList.remove('border-transparent', 'text-gray-500');
            navBtn.classList.add('border-primary', 'text-gray-900');
        }

        state.currentView = targetId;

        // Refresh data based on view
        if (targetId === 'dashboard') dashboard.init();
        if (targetId === 'pos') pos.init();
        if (targetId === 'jobs') jobs.init();
        if (targetId === 'inventory') inventory.init();
        if (targetId === 'reports') reports.init();
    }
};

// Utils
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(amount);
};

const formatDate = (date) => {
    return new Date(date).toLocaleDateString();
};

// Dashboard Module
const dashboard = {
    init: async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Stats
        const todaySales = await db.sales.where('date').aboveOrEqual(today.getTime()).toArray();
        const totalSalesToday = todaySales.reduce((sum, sale) => sum + (parseFloat(sale.totalAmount) || 0), 0);

        const pendingJobs = await db.jobs.where('status').equals('Pending').count();
        const completedJobs = await db.jobs.where('status').equals('Completed').count();
        const lowStock = await db.products.where('stockQuantity').below(5).count(); // Assume 5 is low stock

        document.getElementById('dash-today-sales').textContent = formatCurrency(totalSalesToday);
        document.getElementById('dash-pending-jobs').textContent = pendingJobs;
        document.getElementById('dash-completed-jobs').textContent = completedJobs;
        document.getElementById('dash-low-stock').textContent = lowStock;

        // Recent Sales
        const recentSales = await db.sales.reverse().limit(5).toArray();
        const salesList = document.getElementById('dash-recent-sales-list');
        salesList.innerHTML = recentSales.map(sale => `
            <tr class="bg-white border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium text-gray-900">#${sale.id}</td>
                <td class="px-4 py-3">${new Date(sale.date).toLocaleTimeString()}</td>
                <td class="px-4 py-3 font-bold text-green-600">${formatCurrency(sale.totalAmount)}</td>
                <td class="px-4 py-3"><span class="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded">Cash</span></td>
            </tr>
        `).join('');

        // Active Jobs (Pending or Designing or Printing)
        const activeJobs = await db.jobs
            .where('status').anyOf('Pending', 'Designing', 'Printing')
            .limit(5).toArray();

        const jobList = document.getElementById('dash-active-jobs-list');
        jobList.innerHTML = activeJobs.length ? activeJobs.map(job => `
             <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                    <p class="font-bold text-gray-800">${job.customerName}</p>
                    <p class="text-sm text-gray-500">${job.jobType}</p>
                </div>
                <div class="text-right">
                    <span class="inline-block px-2 py-1 text-xs font-semibold rounded-full 
                        ${job.status === 'Pending' ? 'bg-gray-200 text-gray-800' :
                job.status === 'Designing' ? 'bg-blue-200 text-blue-800' : 'bg-orange-200 text-orange-800'}">
                        ${job.status}
                    </span>
                    <p class="text-xs text-gray-400 mt-1">Due: ${job.deadline || 'No Date'}</p>
                </div>
            </div>
        `).join('') : '<p class="text-gray-400 text-center">No active jobs</p>';
        lucide.createIcons();
    }
};

// POS Module
const pos = {
    init: async () => {
        await pos.renderProducts();
        pos.renderCart();
    },

    productsCache: [],

    renderProducts: async (category = 'all', searchTerm = '') => {
        if (pos.productsCache.length === 0) {
            pos.productsCache = await db.products.toArray();
        }

        let filtered = pos.productsCache;

        if (category !== 'all') {
            filtered = filtered.filter(p => p.category === category);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(p => p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.includes(term)));
        }

        const grid = document.getElementById('pos-products-grid');
        grid.innerHTML = filtered.map(p => `
            <div onclick="pos.addToCart(${p.id})" class="bg-white p-3 rounded-lg shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-shadow flex flex-col justify-between h-32">
                <div>
                    <h4 class="font-bold text-gray-800 text-sm line-clamp-2">${p.name}</h4>
                    <p class="text-xs text-gray-500 mt-1">${p.category}</p>
                </div>
                <div class="flex justify-between items-end mt-2">
                    <span class="font-bold text-primary">${formatCurrency(p.sellingPrice)}</span>
                    <span class="text-xs text-gray-400">Stock: ${p.stockQuantity}</span>
                </div>
            </div>
        `).join('');
        lucide.createIcons();
    },

    addToCart: async (productId) => {
        const product = pos.productsCache.find(p => p.id === productId);
        if (!product) return;

        // Check stock if not a service
        // Assuming infinite stock for services or things marked as 0/-1
        // We will just let it go negative for services or ignore check

        const existingItem = state.cart.find(item => item.productId === productId);
        if (existingItem) {
            existingItem.quantity++;
            existingItem.total = existingItem.quantity * existingItem.price;
        } else {
            state.cart.push({
                productId: product.id,
                name: product.name,
                price: parseFloat(product.sellingPrice),
                quantity: 1,
                total: parseFloat(product.sellingPrice)
            });
        }
        pos.renderCart();
    },

    removeFromCart: (index) => {
        state.cart.splice(index, 1);
        pos.renderCart();
    },

    updateQuantity: (index, change) => {
        const item = state.cart[index];
        item.quantity += change;
        if (item.quantity <= 0) {
            state.cart.splice(index, 1);
        } else {
            item.total = item.quantity * item.price;
        }
        pos.renderCart();
    },

    renderCart: () => {
        const cartContainer = document.getElementById('pos-cart-items');
        if (state.cart.length === 0) {
            cartContainer.innerHTML = '<div class="text-center text-gray-400 py-10">Cart is empty</div>';
            pos.updateTotals();
            return;
        }

        cartContainer.innerHTML = state.cart.map((item, index) => `
            <div class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-200">
                <div class="flex-1">
                    <p class="font-medium text-sm text-gray-800">${item.name}</p>
                    <p class="text-xs text-gray-500">${formatCurrency(item.price)} x ${item.quantity}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="pos.updateQuantity(${index}, -1)" class="p-1 text-gray-500 hover:text-red-500 rounded"><i data-lucide="minus" class="w-4 h-4"></i></button>
                    <span class="font-bold text-sm w-4 text-center">${item.quantity}</span>
                    <button onclick="pos.updateQuantity(${index}, 1)" class="p-1 text-gray-500 hover:text-green-500 rounded"><i data-lucide="plus" class="w-4 h-4"></i></button>
                </div>
                <div class="ml-3 font-bold text-sm min-w-[60px] text-right">
                    ${formatCurrency(item.total)}
                </div>
            </div>
        `).join('');

        lucide.createIcons();
        pos.updateTotals();
    },

    updateTotals: () => {
        const subtotal = state.cart.reduce((sum, item) => sum + item.total, 0);
        const discountInput = document.getElementById('cart-discount');
        const discount = parseFloat(discountInput.value) || 0;
        const total = subtotal - discount;

        document.getElementById('cart-subtotal').textContent = formatCurrency(subtotal);
        document.getElementById('cart-total').textContent = formatCurrency(total > 0 ? total : 0);

        return { subtotal, discount, total };
    },

    clearCart: () => {
        state.cart = [];
        document.getElementById('cart-discount').value = '';
        pos.renderCart();
    },

    filterCategory: (cat) => {
        // Highlight active button
        document.querySelectorAll('.cat-btn').forEach(btn => {
            btn.classList.remove('bg-gray-800', 'text-white');
            btn.classList.add('bg-white', 'text-gray-700');
        });
        const activeBtn = event.target;
        activeBtn.classList.remove('bg-white', 'text-gray-700');
        activeBtn.classList.add('bg-gray-800', 'text-white');

        pos.renderProducts(cat, document.getElementById('pos-search').value);
    },

    checkout: async () => {
        if (state.cart.length === 0) {
            alert('Cart is empty!');
            return;
        }

        const { subtotal, discount, total } = pos.updateTotals();

        const sale = {
            date: Date.now(),
            items: [...state.cart],
            subTotal: subtotal,
            discount: discount,
            totalAmount: total,
            paymentMethod: 'cash' // Default for now
        };

        try {
            // Save sale
            const saleId = await db.sales.add(sale);

            // Update stock
            for (const item of state.cart) {
                const product = await db.products.get(item.productId);
                if (product) {
                    const newStock = (parseInt(product.stockQuantity) || 0) - item.quantity;
                    await db.products.update(item.productId, { stockQuantity: newStock });
                }
            }

            // Show Receipt Link/Modal
            pos.showReceipt(saleId, sale);

            // Clear cart
            pos.clearCart();
            // Refresh product cache to update stock
            pos.productsCache = [];
            pos.renderProducts();

        } catch (e) {
            console.error('Checkout failed', e);
            alert('Checkout failed: ' + e.message);
        }
    },

    showReceipt: (id, sale) => {
        document.getElementById('rec-id').textContent = id;
        document.getElementById('rec-date').textContent = new Date(sale.date).toLocaleString();

        const tbody = document.getElementById('rec-items');
        tbody.innerHTML = sale.items.map(item => `
            <tr>
                <td class="pr-2">${item.name} <span class="text-xs">(${item.quantity})</span></td>
                <td class="text-right">${item.total.toFixed(2)}</td>
            </tr>
        `).join('');

        document.getElementById('rec-total').textContent = sale.totalAmount.toFixed(2);
        document.getElementById('rec-discount').textContent = sale.discount.toFixed(2);

        const modal = document.getElementById('receipt-modal');
        modal.classList.remove('hidden');
    }
};

// Search Listener
document.getElementById('pos-search').addEventListener('input', (e) => {
    pos.renderProducts('all', e.target.value);
});


// Inventory Module
const inventory = {
    init: async () => {
        inventory.renderList();
    },

    renderList: async () => {
        const products = await db.products.toArray();
        const tbody = document.getElementById('inventory-list');
        tbody.innerHTML = products.map(p => `
            <tr class="bg-white border-b hover:bg-gray-50">
                <td class="px-6 py-4 font-medium text-gray-900">${p.name}</td>
                <td class="px-6 py-4">${p.category}</td>
                <td class="px-6 py-4">${p.costPrice || '-'}</td>
                <td class="px-6 py-4">${p.sellingPrice}</td>
                <td class="px-6 py-4 ${p.stockQuantity < 5 ? 'text-red-600 font-bold' : ''}">${p.stockQuantity}</td>
                <td class="px-6 py-4 text-right flex justify-end gap-2">
                    <button onclick="inventory.editProduct(${p.id})" class="text-blue-500 hover:text-blue-700">Edit</button>
                    <button onclick="inventory.deleteProduct(${p.id})" class="text-red-500 hover:text-red-700">Delete</button>
                </td>
            </tr>
        `).join('');
        lucide.createIcons();
    },

    editProduct: async (id) => {
        const p = await db.products.get(id);
        if (!p) return;
        document.getElementById('prod-id').value = p.id;
        document.getElementById('prod-name').value = p.name;
        document.getElementById('prod-barcode').value = p.barcode || '';
        document.getElementById('prod-category').value = p.category;
        document.getElementById('prod-cost').value = p.costPrice;
        document.getElementById('prod-price').value = p.sellingPrice;
        document.getElementById('prod-stock').value = p.stockQuantity;

        document.getElementById('modal-product-title').textContent = 'Edit Product';
        document.getElementById('modal-product').classList.remove('hidden');
    },

    openAddModal: () => {
        document.getElementById('product-form').reset();
        document.getElementById('prod-id').value = '';
        document.getElementById('modal-product-title').textContent = 'Add Product';
        document.getElementById('modal-product').classList.remove('hidden');
    },

    closeModal: () => {
        document.getElementById('modal-product').classList.add('hidden');
    },

    saveProduct: async (e) => {
        e.preventDefault();
        const id = document.getElementById('prod-id').value;
        const product = {
            name: document.getElementById('prod-name').value,
            barcode: document.getElementById('prod-barcode').value || '',
            category: document.getElementById('prod-category').value,
            costPrice: parseFloat(document.getElementById('prod-cost').value) || 0,
            sellingPrice: parseFloat(document.getElementById('prod-price').value) || 0,
            stockQuantity: parseInt(document.getElementById('prod-stock').value) || 0,
            dateAdded: Date.now()
        };

        if (id) {
            await db.products.update(parseInt(id), product);
        } else {
            await db.products.add(product);
        }

        inventory.closeModal();
        inventory.renderList();
        pos.productsCache = []; // Clear pos cache
    },

    deleteProduct: async (id) => {
        if (confirm('Are you sure you want to delete this product?')) {
            await db.products.delete(id);
            inventory.renderList();
            pos.productsCache = [];
        }
    },

    importDummyData: async () => {
        const dummyData = [
            { name: "A4 Paper", category: "Stationery", costPrice: 2, sellingPrice: 5, stockQuantity: 500, dateAdded: Date.now() },
            { name: "CR Books (80pg)", category: "Stationery", costPrice: 120, sellingPrice: 160, stockQuantity: 50, dateAdded: Date.now() },
            { name: "Blue Pen", category: "Stationery", costPrice: 20, sellingPrice: 30, stockQuantity: 100, dateAdded: Date.now() },
            { name: "Pencil", category: "Stationery", costPrice: 10, sellingPrice: 15, stockQuantity: 100, dateAdded: Date.now() },
            { name: "Photocopy (B&W A4)", category: "Services", costPrice: 2, sellingPrice: 10, stockQuantity: 9999, dateAdded: Date.now() },
            { name: "Printout (Color A4)", category: "Services", costPrice: 10, sellingPrice: 40, stockQuantity: 9999, dateAdded: Date.now() },
            { name: "Binding (Spiral)", category: "Services", costPrice: 50, sellingPrice: 150, stockQuantity: 9999, dateAdded: Date.now() },
            { name: "Wedding Card Design", category: "Custom Job", costPrice: 0, sellingPrice: 5000, stockQuantity: 9999, dateAdded: Date.now() },
        ];

        await db.products.bulkAdd(dummyData);
        inventory.renderList();
        alert('Dummy Data Loaded!');
    }
};

// Jobs Module
const jobs = {
    init: async () => {
        jobs.renderKanban();
    },

    renderKanban: async () => {
        const allJobs = await db.jobs.toArray();
        state.jobs = allJobs;

        const columns = {
            'Pending': document.getElementById('kanban-pending'),
            'Designing': document.getElementById('kanban-designing'),
            'Printing': document.getElementById('kanban-printing'),
            'Completed': document.getElementById('kanban-completed'),
        };

        const counts = {
            'Pending': 0, 'Designing': 0, 'Printing': 0, 'Completed': 0
        };

        // Clear columns
        Object.values(columns).forEach(col => col.innerHTML = '');

        allJobs.forEach(job => {
            // Map simple status to column Key if needed, but we use direct mapping
            let colKey = job.status;
            if (colKey === 'Printing/Cutting') colKey = 'Printing'; // Normalize
            if (!columns[colKey]) colKey = 'Pending'; // Fallback

            counts[colKey]++;

            const card = document.createElement('div');
            card.className = 'bg-white p-3 rounded shadow-sm border-l-4 cursor-pointer hover:shadow-md transition-all';

            // Color code border
            if (colKey === 'Pending') card.classList.add('border-gray-400');
            if (colKey === 'Designing') card.classList.add('border-blue-400');
            if (colKey === 'Printing') card.classList.add('border-orange-400');
            if (colKey === 'Completed') card.classList.add('border-green-400');

            card.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <span class="font-bold text-sm text-gray-800">#${job.id}</span>
                    <span class="text-xs text-gray-500">${job.deadline}</span>
                </div>
                <h4 class="font-bold text-gray-900 mb-1">${job.customerName}</h4>
                <p class="text-xs text-gray-600 mb-2">${job.jobType}</p>
                <div class="flex justify-between items-center text-xs">
                    <span class="bg-gray-100 px-2 py-1 rounded">Bal: ${job.totalAmount - (job.advance || 0)}</span>
                    <button onclick="jobs.editJob(${job.id})" class="text-blue-500 hover:text-blue-700">Edit</button>
                </div>
            `;
            columns[colKey].appendChild(card);
        });

        // Update counts
        document.getElementById('count-pending').textContent = counts['Pending'];
        document.getElementById('count-designing').textContent = counts['Designing'];
        document.getElementById('count-printing').textContent = counts['Printing'];
        document.getElementById('count-completed').textContent = counts['Completed'];
    },

    openNewJobModal: () => {
        document.getElementById('job-form').reset();
        document.getElementById('job-id').value = '';
        document.getElementById('job-balance').value = '';
        document.getElementById('modal-job-title').textContent = 'New Job';
        document.getElementById('modal-job').classList.remove('hidden');
    },

    editJob: async (id) => {
        const job = await db.jobs.get(id);
        if (!job) return;

        document.getElementById('job-id').value = job.id;
        document.getElementById('job-customer').value = job.customerName;
        document.getElementById('job-contact').value = job.contact;
        document.getElementById('job-type').value = job.jobType;
        document.getElementById('job-total').value = job.totalAmount;
        document.getElementById('job-advance').value = job.advance;
        document.getElementById('job-status').value = job.status === 'Printing/Cutting' ? 'Printing' : job.status;
        document.getElementById('job-deadline').value = job.deadline;

        jobs.calcBalance();

        document.getElementById('modal-job-title').textContent = 'Edit Job #' + id;
        document.getElementById('modal-job').classList.remove('hidden');
    },

    saveJob: async (e) => {
        e.preventDefault();
        const id = document.getElementById('job-id').value;
        const job = {
            customerName: document.getElementById('job-customer').value,
            contact: document.getElementById('job-contact').value,
            jobType: document.getElementById('job-type').value,
            totalAmount: parseFloat(document.getElementById('job-total').value) || 0,
            advance: parseFloat(document.getElementById('job-advance').value) || 0,
            status: document.getElementById('job-status').value, // Printing mapped back?
            deadline: document.getElementById('job-deadline').value,
            dateCreated: Date.now()
        };

        // Normalize status back if needed, but keeping simple

        if (id) {
            await db.jobs.update(parseInt(id), job);
        } else {
            await db.jobs.add(job);
        }

        jobs.closeModal();
        jobs.renderKanban();
    },

    closeModal: () => {
        document.getElementById('modal-job').classList.add('hidden');
    },

    calcBalance: () => {
        const total = parseFloat(document.getElementById('job-total').value) || 0;
        const adv = parseFloat(document.getElementById('job-advance').value) || 0;
        document.getElementById('job-balance').value = (total - adv).toFixed(2);
    }
};

// Report Module
const reports = {
    init: () => {
        document.getElementById('report-date').valueAsDate = new Date();
        reports.generate();
    },

    generate: async () => {
        const dateInput = document.getElementById('report-date').valueAsDate;
        if (!dateInput) return;

        const startOfDay = new Date(dateInput).setHours(0, 0, 0, 0);
        const endOfDay = new Date(dateInput).setHours(23, 59, 59, 999);

        const sales = await db.sales.where('date').between(startOfDay, endOfDay).toArray();
        const itemsPromises = sales.flatMap(s => s.items.map(async i => {
            const prod = await db.products.get(i.productId);
            return { ...i, cost: prod ? prod.costPrice : 0 };
        }));

        // This is complex because we didn't store cost snapshot in sale item. 
        // For accurate profit, we should have stored cost at time of sale.
        // For now, we will just sum up sales.

        const revenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);

        document.getElementById('report-revenue').textContent = formatCurrency(revenue);
        document.getElementById('report-count').textContent = sales.length;

        // Basic Profit Est (Assuming current cost)
        // Ideally we fetch actual cost, but that requires async lookups on all items
        // Simplified: 
        document.getElementById('report-profit').textContent = "Calcuating...";

        let totalCost = 0;
        for (const sale of sales) {
            for (const item of sale.items) {
                // Try to get product cost, if product deleted, assume 0
                const p = await db.products.get(item.productId);
                if (p) {
                    totalCost += (p.costPrice * item.quantity);
                }
            }
        }

        document.getElementById('report-profit').textContent = formatCurrency(revenue - totalCost);


        const txList = document.getElementById('report-transactions');
        txList.innerHTML = sales.map(s => `
            <tr class="border-b">
                <td class="px-4 py-3">${new Date(s.date).toLocaleTimeString()}</td>
                <td class="px-4 py-3">Sale</td>
                <td class="px-4 py-3">${formatCurrency(s.totalAmount)}</td>
                <td class="px-4 py-3 text-xs text-gray-500">${s.items.length} items</td>
            </tr>
        `).join('');
        lucide.createIcons();
    }
};

// App Main
const app = {
    backupData: async () => {
        const allData = {
            products: await db.products.toArray(),
            sales: await db.sales.toArray(),
            jobs: await db.jobs.toArray()
        };
        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CommCentre_Backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },
    startClock: () => {
        setInterval(() => {
            const now = new Date();
            document.getElementById('current-time').textContent = now.toLocaleTimeString();
            document.getElementById('current-date').textContent = now.toDateString(); // Better date format
        }, 1000);
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    router.navigate('dashboard');
    app.startClock();
});

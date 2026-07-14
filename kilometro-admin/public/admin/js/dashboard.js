// public/admin/js/dashboard.js

const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const fmtDate = (iso) => new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
const fmtDateTime = (iso) => new Date(iso.replace(" ", "T") + "Z").toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

let currentAdmin = null;
let idleTimeoutMinutes = 20;
let trendChartInstance = null;

// ---------------- Session bootstrap ----------------
async function initSession() {
    const me = await api.get("/api/auth/me");
    if (!me) return; // api.js already redirected to /admin/login
    currentAdmin = me.admin;
    idleTimeoutMinutes = me.idleTimeoutMinutes;
    document.getElementById("adminName").textContent = currentAdmin.name;
    document.getElementById("adminAvatar").textContent = currentAdmin.name.charAt(0).toUpperCase();
    startIdleWatch();
}

// ---------------- Idle / auto-logout watch ----------------
// The server enforces the real timeout (sliding JWT expiry). This client
// timer just warns the admin and gives a friendly heads-up before it
// happens, purely for UX.
let idleWarnTimer = null;
function startIdleWatch() {
    resetIdleWarn();
    ["click", "keydown", "mousemove", "scroll"].forEach((evt) =>
        document.addEventListener(evt, throttleResetIdle)
    );
}
let lastReset = 0;
function throttleResetIdle() {
    const now = Date.now();
    if (now - lastReset > 5000) {
        lastReset = now;
        resetIdleWarn();
    }
}
function resetIdleWarn() {
    document.getElementById("idleToast").classList.remove("show");
    if (idleWarnTimer) clearTimeout(idleWarnTimer);
    const warnAfterMs = Math.max(0, (idleTimeoutMinutes - 1)) * 60 * 1000;
    idleWarnTimer = setTimeout(() => {
        document.getElementById("idleToast").classList.add("show");
    }, warnAfterMs);
}

// ---------------- Navigation ----------------
document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
    item.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        const section = item.dataset.section;
        document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
        document.getElementById("section-" + section).classList.add("active");
        document.getElementById("pageTitle").textContent = item.textContent.trim();
        document.getElementById("sidebar").classList.remove("open");
        loadSection(section);
    });
});
document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
});

function loadSection(section) {
    if (section === "overview") loadOverview();
    if (section === "campaigns") loadCampaigns();
    if (section === "donations") loadDonations();
    if (section === "users") loadUsers();
    if (section === "payments") loadPayments();
}

// ---------------- Theme toggle ----------------
const themeToggle = document.getElementById("themeToggle");
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
}
applyTheme("light");
themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(current);
});

// ---------------- Logout ----------------
document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api.post("/api/auth/logout");
    window.location.href = "/admin/login";
});

// ---------------- Notifications ----------------
const notifBtn = document.getElementById("notifBtn");
const notifPanel = document.getElementById("notifPanel");
notifBtn.addEventListener("click", () => notifPanel.classList.toggle("show"));
document.addEventListener("click", (e) => {
    if (!notifPanel.contains(e.target) && e.target !== notifBtn) notifPanel.classList.remove("show");
});
document.getElementById("markAllRead").addEventListener("click", async () => {
    await api.post("/api/admin/notifications/read-all");
    loadNotifications();
});

async function loadNotifications() {
    const data = await api.get("/api/admin/notifications");
    if (!data) return;
    document.getElementById("notifDot").style.display = data.unreadCount > 0 ? "block" : "none";
    const list = document.getElementById("notifList");
    if (data.notifications.length === 0) {
        list.innerHTML = '<li class="empty-state">No notifications yet.</li>';
        return;
    }
    list.innerHTML = data.notifications.map(n => `
        <li class="${n.is_read ? "" : "unread"}">
            <div>${escapeHtml(n.message)}</div>
            <div style="color:var(--muted); font-size:0.72rem; margin-top:3px;">${fmtDateTime(n.created_at)}</div>
        </li>
    `).join("");
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ---------------- Overview ----------------
async function loadOverview() {
    const data = await api.get("/api/admin/dashboard/overview");
    if (!data) return;

    const cards = [
        { label: "Total Campaigns", value: data.campaigns.total, icon: "📢", color: "var(--info)" },
        { label: "Active Campaigns", value: data.campaigns.active, icon: "🟢", color: "var(--success)" },
        { label: "Completed Campaigns", value: data.campaigns.completed, icon: "✅", color: "var(--gold)" },
        { label: "Pending Review", value: data.campaigns.pending, icon: "⏳", color: "var(--warning)" },
        { label: "Registered Users", value: data.users.totalUsers, icon: "👥", color: "var(--info)" },
        { label: "Total Donors", value: data.users.totalDonors, icon: "❤️", color: "var(--red)" },
        { label: "Total Donated", value: peso(data.payments.totalDonated), icon: "💰", color: "var(--success)" },
        { label: "Withdrawn Funds", value: peso(data.payments.withdrawnFunds), icon: "🏦", color: "var(--muted)" },
    ];
    document.getElementById("overviewCards").innerHTML = cards.map(c => `
        <div class="stat-card">
            <div class="top-row">
                <span class="label">${c.label}</span>
                <div class="icon-wrap" style="background:${c.color}22; color:${c.color};">${c.icon}</div>
            </div>
            <div class="value">${c.value}</div>
        </div>
    `).join("");

    const activityList = document.getElementById("activityList");
    activityList.innerHTML = data.recentActivity.length ? data.recentActivity.map(a => `
        <li>
            <div class="activity-dot"></div>
            <div>
                <div class="a-text">${escapeHtml(a.details || a.action)}</div>
                <div class="a-time">${fmtDateTime(a.created_at)}</div>
            </div>
        </li>
    `).join("") : '<li class="empty-state">No recent activity.</li>';

    renderTrendChart(data.monthlyTrend);
    loadNotifications();
}

function renderTrendChart(monthlyTrend) {
    const ctx = document.getElementById("trendChart");
    if (!ctx || typeof Chart === "undefined") return;
    if (trendChartInstance) trendChartInstance.destroy();
    trendChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: monthlyTrend.map(m => m.month),
            datasets: [{
                label: "Donations (₱)",
                data: monthlyTrend.map(m => m.total),
                borderColor: "#a00021",
                backgroundColor: "rgba(160,0,33,0.08)",
                tension: 0.35,
                fill: true,
            }],
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
        },
    });
}

// ---------------- Campaigns ----------------
let campaignPage = 1;
async function loadCampaigns() {
    const search = document.getElementById("campaignSearch").value;
    const status = document.getElementById("campaignStatusFilter").value;
    const data = await api.get(`/api/admin/campaigns?search=${encodeURIComponent(search)}&status=${status}&page=${campaignPage}&pageSize=10`);
    if (!data) return;

    const tbody = document.getElementById("campaignsTableBody");
    tbody.innerHTML = data.data.length ? data.data.map(c => `
        <tr>
            <td><strong>${escapeHtml(c.title)}</strong></td>
            <td>${escapeHtml(c.category || "—")}</td>
            <td>${peso(c.goal_amount)}</td>
            <td>${peso(c.raised_amount)}</td>
            <td><span class="status-pill status-${c.status}">${c.status}</span></td>
            <td>${fmtDate(c.created_at)}</td>
            <td class="actions-cell">
                ${c.status === "pending" ? `
                    <button class="btn-sm btn-success" data-approve="${c.id}">Approve</button>
                    <button class="btn-sm btn-danger" data-reject="${c.id}">Reject</button>` : ""}
                <button class="btn-sm" data-edit="${c.id}">Edit</button>
                ${c.status !== "archived" ? `<button class="btn-sm" data-archive="${c.id}">Archive</button>` : ""}
                <button class="btn-sm btn-danger" data-delete="${c.id}">Delete</button>
            </td>
        </tr>
    `).join("") : `<tr><td colspan="7" class="empty-state">No campaigns found.</td></tr>`;

    renderPagination("campaignsPagination", data, campaignPage, (p) => { campaignPage = p; loadCampaigns(); });

    tbody.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", () => campaignAction(b.dataset.approve, "approve")));
    tbody.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", () => campaignAction(b.dataset.reject, "reject")));
    tbody.querySelectorAll("[data-archive]").forEach(b => b.addEventListener("click", () => campaignAction(b.dataset.archive, "archive")));
    tbody.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => deleteCampaign(b.dataset.delete)));
    tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openCampaignEdit(b.dataset.edit)));
}
document.getElementById("campaignSearch").addEventListener("input", debounce(() => { campaignPage = 1; loadCampaigns(); }, 350));
document.getElementById("campaignStatusFilter").addEventListener("change", () => { campaignPage = 1; loadCampaigns(); });

async function campaignAction(id, action) {
    await api.post(`/api/admin/campaigns/${id}/${action}`);
    loadCampaigns();
}
async function deleteCampaign(id) {
    if (!confirm("Delete this campaign permanently? This cannot be undone.")) return;
    await api.del(`/api/admin/campaigns/${id}`);
    loadCampaigns();
}

let editingCampaignId = null;
async function openCampaignEdit(id) {
    const data = await api.get(`/api/admin/campaigns/${id}`);
    if (!data) return;
    editingCampaignId = id;
    document.getElementById("editTitle").value = data.campaign.title;
    document.getElementById("editCategory").value = data.campaign.category || "";
    document.getElementById("editGoal").value = data.campaign.goal_amount;
    document.getElementById("editDescription").value = data.campaign.description || "";
    document.getElementById("campaignModal").classList.add("show");
}
document.getElementById("closeCampaignModal").addEventListener("click", () => {
    document.getElementById("campaignModal").classList.remove("show");
});
document.getElementById("saveCampaignBtn").addEventListener("click", async () => {
    await api.patch(`/api/admin/campaigns/${editingCampaignId}`, {
        title: document.getElementById("editTitle").value,
        category: document.getElementById("editCategory").value,
        goal_amount: parseFloat(document.getElementById("editGoal").value) || 0,
        description: document.getElementById("editDescription").value,
    });
    document.getElementById("campaignModal").classList.remove("show");
    loadCampaigns();
});

// ---------------- Donations ----------------
let donationPage = 1;
async function loadDonations() {
    const status = document.getElementById("donationStatusFilter").value;
    const dateFrom = document.getElementById("donationDateFrom").value;
    const dateTo = document.getElementById("donationDateTo").value;
    const qs = `status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}&page=${donationPage}&pageSize=15`;
    const data = await api.get(`/api/admin/donations?${qs}`);
    if (!data) return;

    const tbody = document.getElementById("donationsTableBody");
    tbody.innerHTML = data.data.length ? data.data.map(d => `
        <tr>
            <td>${d.is_public ? escapeHtml(d.donor_name) : "Anonymous"}</td>
            <td>${escapeHtml(d.campaign_title || "—")}</td>
            <td>${peso(d.amount)}</td>
            <td><span class="status-pill status-${d.payment_status}">${d.payment_status}</span></td>
            <td>${escapeHtml(d.payment_method)}</td>
            <td>${fmtDate(d.created_at)}</td>
        </tr>
    `).join("") : `<tr><td colspan="6" class="empty-state">No donations found.</td></tr>`;

    renderPagination("donationsPagination", data, donationPage, (p) => { donationPage = p; loadDonations(); });
}
["donationStatusFilter", "donationDateFrom", "donationDateTo"].forEach(id =>
    document.getElementById(id).addEventListener("change", () => { donationPage = 1; loadDonations(); })
);
document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const status = document.getElementById("donationStatusFilter").value;
    const dateFrom = document.getElementById("donationDateFrom").value;
    const dateTo = document.getElementById("donationDateTo").value;
    window.location.href = `/api/admin/donations/export.csv?status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
});

// ---------------- Users ----------------
let userPage = 1;
async function loadUsers() {
    const search = document.getElementById("userSearch").value;
    const status = document.getElementById("userStatusFilter").value;
    const data = await api.get(`/api/admin/users?search=${encodeURIComponent(search)}&status=${status}&page=${userPage}&pageSize=10`);
    if (!data) return;

    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = data.data.length ? data.data.map(u => `
        <tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${u.is_donor ? "Yes" : "No"}</td>
            <td><span class="status-pill status-${u.status}">${u.status}</span></td>
            <td>${fmtDate(u.created_at)}</td>
            <td class="actions-cell">
                <button class="btn-sm" data-view="${u.id}">View</button>
                ${u.status === "active"
                    ? `<button class="btn-sm" data-suspend="${u.id}">Suspend</button>`
                    : `<button class="btn-sm btn-success" data-reactivate="${u.id}">Reactivate</button>`}
                <button class="btn-sm btn-danger" data-delete-user="${u.id}">Delete</button>
            </td>
        </tr>
    `).join("") : `<tr><td colspan="6" class="empty-state">No users found.</td></tr>`;

    renderPagination("usersPagination", data, userPage, (p) => { userPage = p; loadUsers(); });

    tbody.querySelectorAll("[data-suspend]").forEach(b => b.addEventListener("click", () => userAction(b.dataset.suspend, "suspend")));
    tbody.querySelectorAll("[data-reactivate]").forEach(b => b.addEventListener("click", () => userAction(b.dataset.reactivate, "reactivate")));
    tbody.querySelectorAll("[data-delete-user]").forEach(b => b.addEventListener("click", () => deleteUser(b.dataset.deleteUser)));
    tbody.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => viewUser(b.dataset.view)));
}
document.getElementById("userSearch").addEventListener("input", debounce(() => { userPage = 1; loadUsers(); }, 350));
document.getElementById("userStatusFilter").addEventListener("change", () => { userPage = 1; loadUsers(); });

async function userAction(id, action) {
    await api.post(`/api/admin/users/${id}/${action}`);
    loadUsers();
}
async function deleteUser(id) {
    if (!confirm("Delete this user permanently? This cannot be undone.")) return;
    await api.del(`/api/admin/users/${id}`);
    loadUsers();
}
async function viewUser(id) {
    const data = await api.get(`/api/admin/users/${id}`);
    if (!data) return;
    document.getElementById("userModalContent").innerHTML = `
        <h3>${escapeHtml(data.user.name)}</h3>
        <p style="color:var(--muted); font-size:0.85rem;">${escapeHtml(data.user.email)}</p>
        <p><span class="status-pill status-${data.user.status}">${data.user.status}</span> · Joined ${fmtDate(data.user.created_at)}</p>
        <h4 style="margin-top:20px;">Donation History</h4>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                    ${data.donations.length ? data.donations.map(d => `
                        <tr><td>${peso(d.amount)}</td><td><span class="status-pill status-${d.payment_status}">${d.payment_status}</span></td><td>${fmtDate(d.created_at)}</td></tr>
                    `).join("") : `<tr><td colspan="3" class="empty-state">No donations yet.</td></tr>`}
                </tbody>
            </table>
        </div>
        <div class="modal-actions">
            <button class="btn-sm btn-primary" id="closeUserModal">Close</button>
        </div>
    `;
    document.getElementById("userModal").classList.add("show");
    document.getElementById("closeUserModal").addEventListener("click", () => {
        document.getElementById("userModal").classList.remove("show");
    });
}

// ---------------- Payments (mock gateway) ----------------
async function loadPayments() {
    const overview = await api.get("/api/admin/dashboard/overview");
    if (!overview) return;
    const p = overview.payments;
    const cards = [
        { label: "Total Donated", value: peso(p.totalDonated), icon: "💰" },
        { label: "Successful Payments", value: p.successfulPayments, icon: "✅" },
        { label: "Pending Payments", value: p.pendingPayments, icon: "⏳" },
        { label: "Failed Payments", value: p.failedPayments, icon: "❌" },
        { label: "Withdrawn Funds", value: peso(p.withdrawnFunds), icon: "🏦" },
    ];
    document.getElementById("paymentCards").innerHTML = cards.map(c => `
        <div class="stat-card">
            <div class="top-row"><span class="label">${c.label}</span><div class="icon-wrap" style="background:#c8a45d22; color:var(--gold);">${c.icon}</div></div>
            <div class="value">${c.value}</div>
        </div>
    `).join("");

    const donations = await api.get("/api/admin/donations?pageSize=20");
    if (!donations) return;
    document.getElementById("paymentsTableBody").innerHTML = donations.data.length ? donations.data.map(d => `
        <tr>
            <td>${d.is_public ? escapeHtml(d.donor_name) : "Anonymous"}</td>
            <td>${peso(d.amount)}</td>
            <td><span class="status-pill status-${d.payment_status}">${d.payment_status}</span></td>
            <td>${escapeHtml(d.payment_method)}</td>
            <td>${fmtDate(d.created_at)}</td>
        </tr>
    `).join("") : `<tr><td colspan="5" class="empty-state">No transactions yet.</td></tr>`;
}

// ---------------- Helpers ----------------
function renderPagination(elId, data, currentPage, onPage) {
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const el = document.getElementById(elId);
    el.innerHTML = `Page ${currentPage} of ${totalPages} (${data.total} total)`;
    if (totalPages <= 1) return;
    if (currentPage > 1) {
        const prev = document.createElement("button");
        prev.className = "btn-sm"; prev.textContent = "Previous";
        prev.addEventListener("click", () => onPage(currentPage - 1));
        el.appendChild(prev);
    }
    if (currentPage < totalPages) {
        const next = document.createElement("button");
        next.className = "btn-sm"; next.textContent = "Next";
        next.addEventListener("click", () => onPage(currentPage + 1));
        el.appendChild(next);
    }
}

function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ---------------- Boot ----------------
initSession().then(() => loadOverview());

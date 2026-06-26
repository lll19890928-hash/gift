// ===== 配置 =====
const ADMIN_PWD = "8888";
const STORAGE_KEY = "gift_wishlist_data";

// ===== 数据 =====
let gifts = [];
let isAdmin = false;
let currentFilter = "全部";

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
    loadGifts();
    renderTags();
    renderGrid();
    updateStats();
    bindEvents();
});

function bindEvents() {
    document.getElementById("btn-admin").onclick = () => openModal("modal-admin");
    document.getElementById("edit-form").onsubmit = (e) => {
        e.preventDefault();
        saveGift();
    };
}

// ===== 本地存储 =====
function loadGifts() {
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        if (d) gifts = JSON.parse(d);
    } catch(e) {}
    if (!gifts.length) gifts = getDefaultGifts();
}

function saveGifts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
}

function getDefaultGifts() {
    return [
        {id:1, name:"示例礼物（可删除）", price:199, cat:"其他", link:"", received:false}
    ];
}

// ===== 渲染 =====
function renderTags() {
    const cats = ["全部", "想要", "已收到", "电子产品", "书籍", "配饰", "家居", "美妆", "运动", "其他"];
    document.getElementById("tags").innerHTML = cats.map(c =>
        `<button class="tag ${c===currentFilter?'active':''}" onclick="setFilter('${c}')">${c}</button>`
    ).join("");
}

function setFilter(f) {
    currentFilter = f;
    renderTags();
    renderGrid();
}

function renderGrid() {
    let list = [...gifts];
    if (currentFilter === "想要") list = list.filter(g => !g.received);
    else if (currentFilter === "已收到") list = list.filter(g => g.received);
    else if (currentFilter !== "全部") list = list.filter(g => g.cat === currentFilter);

    const grid = document.getElementById("grid");
    const empty = document.getElementById("empty");

    if (!list.length) {
        grid.style.display = "none";
        empty.style.display = "block";
        return;
    }

    grid.style.display = "grid";
    empty.style.display = "none";

    grid.innerHTML = list.map(g => `
        <div class="card ${g.received?'received':''}" onclick="viewDetail(${g.id})">
            ${g.received?'<div class="badge">✅ 已收到</div>':''}
            <div class="card-emoji">${getEmoji(g.cat)}</div>
            <div class="card-info">
                <div class="card-name">${esc(g.name)}</div>
                <div class="card-price">¥${g.price.toLocaleString()}</div>
            </div>
        </div>
    `).join("");
}

function updateStats() {
    document.getElementById("stat-total").textContent = gifts.length;
    document.getElementById("stat-want").textContent = gifts.filter(g => !g.received).length;
    const total = gifts.filter(g => !g.received).reduce((s,g) => s+g.price, 0);
    document.getElementById("stat-price").textContent = total.toLocaleString();
}

// ===== 管理登录 =====
function doLogin() {
    const pwd = document.getElementById("pwd-input").value;
    if (pwd === ADMIN_PWD) {
        isAdmin = true;
        document.getElementById("login-box").style.display = "none";
        document.getElementById("admin-panel").style.display = "block";
        renderAdminList();
        showToast("管理后台已解锁");
    } else {
        showToast("密码错误");
    }
}

// ===== 管理列表 =====
function renderAdminList() {
    document.getElementById("admin-list").innerHTML = gifts.map(g => `
        <div class="item">
            <div class="item-name">${esc(g.name)} · <span style="color:#ff6b8a;font-weight:700;">¥${g.price.toLocaleString()}</span></div>
            <div class="item-btns">
                <button onclick="toggleRecv(${g.id})">${g.received?'撤销':'收到'}</button>
                <button onclick="openEdit(${g.id})">编辑</button>
                <button onclick="deleteGift(${g.id})">删除</button>
            </div>
        </div>
    `).join("");
}

// ===== 添加/编辑弹窗 =====
function openEdit(id = null) {
    document.getElementById("edit-form").reset();
    document.getElementById("edit-id").value = "";
    document.getElementById("fetch-result").style.display = "none";
    document.getElementById("fetch-url").value = "";
    document.getElementById("quick-paste").value = "";

    if (id) {
        const g = gifts.find(x => x.id === id);
        if (!g) return;
        document.getElementById("edit-title").textContent = "编辑礼物";
        document.getElementById("edit-id").value = g.id;
        document.getElementById("edit-name").value = g.name;
        document.getElementById("edit-price").value = g.price;
        document.getElementById("edit-link").value = g.link || "";
        document.getElementById("edit-cat").value = g.cat || "其他";
    } else {
        document.getElementById("edit-title").textContent = "添加礼物";
    }
    openModal("modal-edit");
}

// ===== 快速粘贴解析 =====
function quickParse() {
    const text = document.getElementById("quick-paste").value.trim();
    if (!text) {
        showToast("请先粘贴商品信息");
        return;
    }

    // 提取价格（支持 ¥ ￥ $ 多种格式）
    const priceMatch = text.match(/[¥￥$]?\s*([\d,]+\.?\d*)/);
    let price = null;
    if (priceMatch) {
        price = parseInt(priceMatch[1].replace(/,/g, ""));
    }

    // 提取商品名称（取第一行或前50个字符）
    let name = text.split("\n")[0].trim();
    // 去除价格信息
    name = name.replace(/[¥￥$]\s*[\d,]+\.?\d*/g, "").trim();
    // 如果名称太长，取前50个字符
    if (name.length > 50) {
        name = name.substring(0, 50);
    }

    // 自动填表
    if (name) document.getElementById("edit-name").value = name;
    if (price) document.getElementById("edit-price").value = price;

    // 检查是否包含淘宝/京东链接
    const linkMatch = text.match(/(https?:\/\/[^\s]+)/);
    if (linkMatch) {
        document.getElementById("edit-link").value = linkMatch[1];
    }

    showToast("✅ 已自动填入，请确认后保存");
}

// ===== 链接识别（调用后端API）=====
async function fetchFromLink() {
    const url = document.getElementById("fetch-url").value.trim();
    if (!url) {
        showToast("请先粘贴商品链接");
        return;
    }

    const btn = document.getElementById("btn-fetch");
    const resultDiv = document.getElementById("fetch-result");
    btn.disabled = true;
    btn.textContent = "识别中...";
    resultDiv.style.display = "none";

    try {
        showToast("正在识别...");
        
        // 调用后端API（Vercel部署后是 /api/fetch）
        const apiUrl = window.location.hostname.includes("vercel.app") 
            ? "/api/fetch" 
            : "https://gift-wishlist-rose.vercel.app/api/fetch";
        
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(15000)
        });
        
        const data = await res.json();
        btn.disabled = false;
        btn.textContent = "识别";

        if (data.success) {
            // 识别成功，自动填表
            document.getElementById("edit-name").value = data.name || "";
            if (data.price) document.getElementById("edit-price").value = data.price;
            if (data.image) document.getElementById("edit-image").value = data.image;
            document.getElementById("edit-link").value = url;
            
            resultDiv.className = "fetch-result success";
            resultDiv.innerHTML = `✅ ${data.platform || "商品"}识别成功！已自动填表，请确认后保存。`;
            resultDiv.style.display = "block";
            showToast("识别成功！");
        } else {
            // 识别失败，引导手动填写
            resultDiv.className = "fetch-result error";
            resultDiv.innerHTML = `
                ❌ 自动识别失败<br>
                <small>淘宝/京东有反爬虫保护，自动识别成功率较低。</small><br><br>
                <strong>📝 手动填写（只需10秒）：</strong><br>
                1. 复制商品标题 → 粘贴到「礼物名称」<br>
                2. 复制商品价格 → 粘贴到「价格」<br>
                3. 商品链接已自动保留在下方<br><br>
                <button onclick="keepLinkOnly()" style="padding:8px 16px;background:#ff6b8a;color:#fff;border:none;border-radius:8px;cursor:pointer;">保留链接并手动填写</button>
            `;
            resultDiv.style.display = "block";
            showToast("请手动填写");
        }
    } catch(err) {
        btn.disabled = false;
        btn.textContent = "识别";
        resultDiv.className = "fetch-result error";
        resultDiv.innerHTML = `❌ 识别失败：${esc(err.message)}<br><br>请手动填写商品信息。`;
        resultDiv.style.display = "block";
        showToast("识别失败");
    }
}

function keepLinkOnly() {
    const url = document.getElementById("fetch-url").value.trim();
    document.getElementById("edit-link").value = url;
    document.getElementById("edit-name").focus();
    showToast("链接已保留，请补充名称和价格");
}

// ===== 保存礼物 =====
function saveGift() {
    const id = document.getElementById("edit-id").value;
    const name = document.getElementById("edit-name").value.trim();
    const price = parseInt(document.getElementById("edit-price").value) || 0;
    const link = document.getElementById("edit-link").value.trim();
    const cat = document.getElementById("edit-cat").value;

    if (!name || !price) {
        showToast("请填写名称和价格");
        return;
    }

    if (id) {
        const idx = gifts.findIndex(g => g.id == id);
        if (idx >= 0) {
            gifts[idx].name = name;
            gifts[idx].price = price;
            gifts[idx].link = link;
            gifts[idx].cat = cat;
        }
    } else {
        gifts.push({
            id: Date.now(),
            name,
            price,
            link,
            cat,
            received: false
        });
    }

    saveGifts();
    renderGrid();
    updateStats();
    renderAdminList();
    closeModal("modal-edit");
    showToast(id ? "修改成功！" : "添加成功！");
}

function deleteGift(id) {
    if (!confirm("确定删除？")) return;
    gifts = gifts.filter(g => g.id !== id);
    saveGifts();
    renderGrid();
    updateStats();
    renderAdminList();
    showToast("已删除");
}

function toggleRecv(id) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;
    g.received = !g.received;
    saveGifts();
    renderGrid();
    updateStats();
    renderAdminList();
    showToast(g.received ? "已标记收到 ✓" : "已标记想要");
}

// ===== 查看详情 =====
function viewDetail(id) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;

    let html = `
        <div style="text-align:center;padding:20px;">
            <div style="font-size:60px;margin-bottom:12px;">${getEmoji(g.cat)}</div>
            <h3 style="margin:10px 0;font-size:20px;">${esc(g.name)}</h3>
            <div style="font-size:32px;font-weight:800;color:#ff3b30;margin:12px 0;">¥${g.price.toLocaleString()}</div>
            <div style="margin:12px 0;">
                <span style="padding:4px 12px;background:${g.received?'#e8f5e9':'#fce4ec'};color:${g.received?'#2e7d32':'#c62828'};border-radius:12px;font-size:13px;font-weight:600;">
                    ${g.received?'✅ 已收到':'🎁 还想要'}
                </span>
                <span style="margin-left:8px;color:#888;">${g.cat}</span>
            </div>
    `;

    if (g.link) {
        html += `<a href="${esc(g.link)}" target="_blank" style="display:block;margin:20px auto 0;padding:14px 32px;background:linear-gradient(135deg,#ff6b8a,#ff8eb4);color:#fff;text-decoration:none;border-radius:14px;font-size:16px;font-weight:600;width:fit-content;">🛒 去购买</a>`;
    } else {
        html += `<div style="color:#999;font-size:13px;margin-top:16px;">暂无购买链接</div>`;
    }

    html += `</div>`;
    document.getElementById("detail-body").innerHTML = html;
    openModal("modal-detail");
}

// ===== 工具函数 =====
function getEmoji(cat) {
    return {"电子产品":"📱","书籍":"📚","配饰":"👜","家居":"🏠","美妆":"💄","运动":"⚽","其他":"🎁"}[cat] || "🎁";
}

function esc(s) {
    if (!s) return "";
    return s.toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function openModal(id) {
    document.getElementById(id).classList.add("open");
    document.body.style.overflow = "hidden";
}

function closeModal(id) {
    document.getElementById(id).classList.remove("open");
    const any = document.querySelectorAll(".modal.open").length;
    if (!any) document.body.style.overflow = "";
}
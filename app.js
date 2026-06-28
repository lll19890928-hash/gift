// ===== 配置 =====
const ADMIN_PWD = "8888";
const STORAGE_KEY = "gift_wishlist_data";
const IMAGE_QUALITY = 0.6; // 图片压缩质量（0.6 = 60%品质）
const IMAGE_MAX_WIDTH = 400; // 图片最大宽度（像素）
const SUPABASE_URL = "https://yzbjfmuzqhybhgzxooek.supabase.co";
const SUPABASE_KEY = "sb_publishable_rEW8nZvYGj89wGisKc9Pjw_dyNq4ZdD";

// ===== 数据 =====
let gifts = [];
let isAdmin = false;
let currentFilter = "全部";
let currentSort = "default"; // default | price-asc | price-desc
let currentPriceRange = "all";
let searchKeyword = "";
let syncStatus = "loading"; // loading | synced | offline | error
let localDirty = false; // 有未同步到云端的本地修改
let cloudSyncInProgress = false; // 云端同步是否正在进行
let cloudPullInProgress = false; // 云端拉取是否正在进行（防止覆盖正在编辑的数据）

// 价格区间定义
const PRICE_RANGES = [
    {key:"all",      label:"全部价格"},
    {key:"0-100",     label:"0-100"},
    {key:"100-500",   label:"100-500"},
    {key:"500-1000",  label:"500-1000"},
    {key:"1000-2000", label:"1000-2000"},
    {key:"2000-3000", label:"2000-3000"},
    {key:"3000-5000", label:"3000-5000"},
    {key:"5000-10000",label:"5000-10000"},
    {key:"10000+",    label:"10000以上"},
];

// ===== 调试日志（仅控制台，不显示在页面） =====
function debugLog(step, detail, isError) {
    try {
        const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        const msg = `[${time}] ${step}${detail ? ": " + detail : ""}`;
        if (isError) {
            console.error("[调试]", msg);
        } else {
            console.log("[调试]", msg);
        }
    } catch (e) { /* 调试代码本身不能影响主流程 */ }
}

window.onerror = function(msg, url, line, col, err) {
    console.error("[全局错误]", msg, "@" + (line || "?") + ":" + (col || "?"));
};
window.addEventListener("unhandledrejection", function(e) {
    console.error("[未处理Promise拒绝]", (e.reason && e.reason.message) || e.reason);
});

// ===== Supabase REST API（不依赖 SDK，直接用 fetch） =====
const SB_REST = SUPABASE_URL + "/rest/v1/wishlist";
const SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json"
};

// 带超时的 fetch
function fetchWithTimeout(url, options, timeoutMs) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
            reject(new Error("连接云端超时"));
        }, timeoutMs || 8000);
        fetch(url, { ...options, signal: controller.signal })
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
    });
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", async () => {
    // 1. 先立即从本地加载并渲染，避免页面白屏/卡死
    loadLocalGifts();
    renderCatGrid();
    renderTags();
    renderPriceTags();
    renderGrid();
    updateStats();

    // 2. 直接用 fetch 连接云端（不需要加载任何外部 SDK）
    syncFromCloud();
});

// ===== 云端同步（直接用 fetch REST API，不依赖 SDK） =====
function setSyncStatus(status, msg) {
    syncStatus = status;
    const bar = document.getElementById("sync-bar");
    const icon = document.getElementById("sync-icon");
    const text = document.getElementById("sync-text");
    if (!bar || !icon || !text) return;

    const map = {
        loading: { icon: "⏳", text: msg || "正在连接云端...", cls: "sync-loading" },
        synced: { icon: "✅", text: msg || "已同步到云端", cls: "sync-synced" },
        offline: { icon: "📴", text: msg || "离线模式（使用本地缓存）", cls: "sync-offline" },
        error: { icon: "⚠️", text: msg || "同步失败，请检查网络", cls: "sync-error" }
    };
    const s = map[status] || map.loading;
    icon.textContent = s.icon;
    text.textContent = s.text;
    bar.className = "sync-bar " + s.cls;
    bar.style.display = "flex";
}

function loadLocalGifts() {
    let loaded = false;
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        if (d) {
            const parsed = JSON.parse(d);
            if (Array.isArray(parsed) && parsed.length > 0) {
                gifts = parsed;
                loaded = true;
            }
        }
        // 恢复 localDirty 状态（跨页面刷新保持）
        localDirty = localStorage.getItem("gift_wishlist_dirty") === "true";
    } catch (e) {
        console.error("[loadLocalGifts] parse error:", e);
    }
    if (!loaded || !gifts.length) {
        gifts = getDefaultGifts();
    }
    normalizeGifts();
}

async function syncFromCloud() {
    // 如果有未同步的本地修改，不要用云端数据覆盖
    if (localDirty) {
        console.log("[syncFromCloud] 本地有未同步修改，跳过云端拉取，先推送本地数据");
        setSyncStatus("synced", "本地修改同步中...");
        saveGifts(); // 后台推送本地数据到云端
        return;
    }
    setSyncStatus("loading", "正在连接云端...");
    cloudPullInProgress = true;
    try {
        // 从云端读取数据（GET /rest/v1/wishlist?id=eq.1&select=data）
        const resp = await fetchWithTimeout(
            SB_REST + "?id=eq.1&select=data",
            { method: "GET", headers: SB_HEADERS },
            8000
        );

        if (!resp.ok) {
            throw new Error("云端返回错误: " + resp.status);
        }

        const rows = await resp.json();

        // ★ 关键：fetch 期间用户可能添加了礼物，再次检查 localDirty
        if (localDirty) {
            console.log("[syncFromCloud] fetch 期间本地有修改，跳过覆盖，改为推送本地数据");
            cloudPullInProgress = false;
            saveGifts();
            return;
        }

        if (!rows || rows.length === 0) {
            // 云端无记录，上传默认数据
            const defaults = getDefaultGifts();
            gifts = defaults;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
            normalizeGifts();
            renderCatGrid();
            renderTags();
            renderPriceTags();
            renderGrid();
            updateStats();
            setSyncStatus("synced", "已同步到云端");
            // 上传到云端
            saveGifts();
        } else if (rows[0].data && Array.isArray(rows[0].data)) {
            const cloudData = rows[0].data;
            // ★ 合并策略：保留本地有但云端没有的礼物（按 ID 去重）
            const cloudIds = new Set(cloudData.map(g => g.id));
            const localOnly = gifts.filter(g => !cloudIds.has(g.id));
            if (localOnly.length > 0) {
                console.log(`[syncFromCloud] 本地有 ${localOnly.length} 个云端没有的礼物，合并`);
                gifts = [...cloudData, ...localOnly];
                localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
                localDirty = true;
                localStorage.setItem("gift_wishlist_dirty", "true");
                // 推送合并后的数据到云端
                saveGifts();
            } else {
                gifts = cloudData;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
            }
            normalizeGifts();
            renderCatGrid();
            renderTags();
            renderPriceTags();
            renderGrid();
            updateStats();
            setSyncStatus("synced", "已同步到云端");
        } else {
            throw new Error("云端数据格式异常");
        }
    } catch (e) {
        console.error("云端同步失败", e);
        setSyncStatus("offline", "离线模式（使用本地缓存）");
    }
    cloudPullInProgress = false;
}

// 写入云端（UPSERT）—— 超时设为 20 秒，因为数据含 base64 图片可能较大
async function saveToCloud(data) {
    const resp = await fetchWithTimeout(
        SB_REST,
        {
            method: "POST",
            headers: {
                ...SB_HEADERS,
                "Prefer": "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify({
                id: 1,
                data: data,
                updated_at: new Date().toISOString()
            })
        },
        20000
    );
    if (!resp.ok && resp.status !== 201) {
        throw new Error("云端保存失败: " + resp.status);
    }
}

function normalizeGifts() {
    gifts.forEach(g => {
        if (!g.image) g.image = "";
        if (!g.cat) g.cat = "其他";
        if (g.received === undefined) g.received = false;
    });
}

async function saveGifts() {
    // 1. 先保存到本地（即时反馈，同步操作）
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
    localDirty = true;
    localStorage.setItem("gift_wishlist_dirty", "true"); // 持久化 dirty 状态

    // 2. 后台同步到云端（不阻塞调用方）
    //    如果已有同步在进行中，标记需要再次同步
    if (cloudSyncInProgress) {
        console.log("[saveGifts] 云端同步进行中，稍后自动重试");
        return;
    }
    cloudSyncInProgress = true;
    setSyncStatus("loading", "正在保存到云端...");

    // 异步推送，不 await —— 调用方立即返回
    (async () => {
        let retries = 0;
        while (retries < 3) {
            try {
                await saveToCloud(gifts);
                localDirty = false;
                localStorage.setItem("gift_wishlist_dirty", "false"); // 清除 dirty
                setSyncStatus("synced", "已同步到云端");
                console.log("[saveGifts] 云端保存成功");
                break;
            } catch (e) {
                retries++;
                console.error(`[saveGifts] 云端保存失败(第${retries}次)`, e.message);
                if (retries < 3) {
                    setSyncStatus("loading", `正在重试云端同步(${retries}/3)...`);
                    await new Promise(r => setTimeout(r, 2000 * retries));
                } else {
                    setSyncStatus("error", "云端保存失败，已存到本地（下次打开自动重试）");
                }
            }
        }
        cloudSyncInProgress = false;
        // 同步完成后，如果期间又有新的本地修改，自动再同步一次
        if (localDirty) {
            console.log("[saveGifts] 检测到新的本地修改，自动再次同步");
            saveGifts();
        }
    })();
}

function getDefaultGifts() {
    return [
        {id:1, name:"DR JeVetal 医药黄芪面膜 补水美白保湿去黄抗老", price:52, cat:"护肤", link:"", image:"images/huangqi-mianmo.png", received:false},
        {id:2, name:"Allwish 30倍+超导亮白身体乳 洗出伪体香", price:179, cat:"护肤", link:"", image:"images/allwish-bodylotion.png", received:false},
        {id:3, name:"迪士尼米老鼠美式半自动咖啡机 办公室单人", price:230, cat:"家电", link:"", image:"images/disney-coffee.png", received:false},
        {id:4, name:"2026新款卧室轻奢垃圾桶 大容量带轮翻盖纸篓", price:53, cat:"日用", link:"", image:"images/trash-can.png", received:false},
        {id:5, name:"高级感黑色短靴女真皮尖头粗跟裤管靴中筒骑士", price:189, cat:"鞋包", link:"", image:"images/black-boots.png", received:false},
        {id:6, name:"千问AI眼镜S1 智能眼镜 3D显示大模型翻译提词运动相机", price:4998, cat:"数码", link:"", image:"images/qianwen-ai-glass.png", received:false},
        {id:7, name:"血糖血压智能手环 高清蓝牙通话 一键测呼救", price:379, cat:"数码", link:"", image:"images/blood-sugar-bracelet.png", received:false},
        {id:8, name:"韩国VT固态PDRN水光补水保湿棒 润9.5g可上飞机", price:139, cat:"护肤", link:"", image:"images/pdrn-stick.png", received:false},
        {id:9, name:"韩国anua PDRN透明质酸水光面膜 鱼腥草面膜补水保湿", price:40, cat:"护肤", link:"", image:"images/anua-mask.png", received:false},
    ];
}

// ===== 管理模式 =====
function toggleAdmin() {
    if (isAdmin) {
        exitAdmin();
        return;
    }
    const bar = document.getElementById("admin-login-bar");
    if (bar.style.display === "none") {
        bar.style.display = "flex";
        document.getElementById("pwd-input").focus();
    } else {
        bar.style.display = "none";
    }
}

function doLogin() {
    const pwd = document.getElementById("pwd-input").value;
    if (pwd === ADMIN_PWD) {
        isAdmin = true;
        document.getElementById("admin-login-bar").style.display = "none";
        document.getElementById("admin-toolbar").style.display = "flex";
        document.getElementById("btn-admin").textContent = "退出管理";
        document.getElementById("btn-admin").classList.add("active");
        renderGrid();
        showToast("管理模式已开启，可直接编辑");
    } else {
        showToast("密码错误");
        document.getElementById("pwd-input").value = "";
    }
}

function exitAdmin() {
    isAdmin = false;
    document.getElementById("admin-toolbar").style.display = "none";
    document.getElementById("add-form-wrap").style.display = "none";
    document.getElementById("btn-admin").textContent = "管理";
    document.getElementById("btn-admin").classList.remove("active");
    document.getElementById("pwd-input").value = "";
    renderGrid();
    showToast("已退出管理模式");
}

// ===== 添加新礼物表单 =====
function toggleAddForm() {
    const wrap = document.getElementById("add-form-wrap");
    if (wrap.style.display === "none") {
        // 重置表单
        document.getElementById("edit-name").value = "";
        document.getElementById("edit-price").value = "";
        document.getElementById("edit-link").value = "";
        document.getElementById("edit-cat").value = "护肤";
        document.getElementById("edit-image").value = "";
        document.getElementById("edit-image-url").value = "";
        document.getElementById("quick-paste").value = "";
        document.getElementById("ocr-progress").style.display = "none";
        document.getElementById("ocr-result").style.display = "none";
        document.getElementById("image-preview").innerHTML = '<div class="image-placeholder">📷 点击上传图片</div>';
        wrap.style.display = "block";
        wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
        wrap.style.display = "none";
    }
}

async function saveNewGift() {
    const name = document.getElementById("edit-name").value.trim();
    const price = parseInt(document.getElementById("edit-price").value) || 0;
    const link = normalizeLink(document.getElementById("edit-link").value);
    const cat = document.getElementById("edit-cat").value;
    const image = document.getElementById("edit-image").value.trim();

    if (!name || !price) { showToast("请填写名称和价格"); return; }

    gifts.push({ id: Date.now(), name, price, link, image, cat, received: false });
    await saveGifts();
    renderCatGrid();
    renderGrid();
    updateStats();
    document.getElementById("add-form-wrap").style.display = "none";
    showToast("添加成功！");
}

// ===== 分类图标区 =====
function renderCatGrid() {
    const cats = [
        {key:"护肤", icon:"✨", label:"护肤美妆", color:"#fce4ec"},
        {key:"数码", icon:"💻", label:"数码科技", color:"#e3f2fd"},
        {key:"家电", icon:"🏠", label:"家居家电", color:"#e8f5e9"},
        {key:"日用", icon:"🧴", label:"日用好物", color:"#fff3e0"},
        {key:"鞋包", icon:"👢", label:"鞋包配饰", color:"#f3e5f5"},
        {key:"衣服", icon:"👗", label:"衣服穿搭", color:"#fce4ec"},
        {key:"鲜花水果", icon:"💐", label:"鲜花水果", color:"#e8f5e9"},
        {key:"零食", icon:"🍰", label:"零食好吃", color:"#fff3e0"},
        {key:"虚拟服务", icon:"🎮", label:"虚拟服务", color:"#e0f7fa"},
        {key:"书籍", icon:"📚", label:"书籍", color:"#e0f2f1"},
        {key:"运动", icon:"⚽", label:"运动户外", color:"#e8f5e9"},
        {key:"其他", icon:"🎁", label:"其他", color:"#fafafa"},
    ];

    const counts = {};
    gifts.forEach(g => { if (!g.received) counts[g.cat] = (counts[g.cat]||0) + 1; });

    document.getElementById("cat-grid").innerHTML = cats.map(c => `
        <div class="cat-card ${currentFilter===c.key?'active':''}" onclick="setFilter('${c.key}')">
            <div class="cat-icon" style="background:${c.color};">${c.icon}</div>
            <div class="cat-label">${c.label}</div>
            <div class="cat-count">${counts[c.key]||0}</div>
        </div>
    `).join("");
}

// ===== 渲染标签 =====
function renderTags() {
    const tags = ["全部", "已收到"];
    document.getElementById("tags").innerHTML = tags.map(t =>
        `<button class="tag ${t===currentFilter?'active':''}" onclick="setFilter('${t}')">${t}</button>`
    ).join("");
}

// ===== 渲染价格区间标签 =====
function renderPriceTags() {
    document.getElementById("price-tags").innerHTML = PRICE_RANGES.map(r =>
        `<button class="price-tag ${r.key===currentPriceRange?'active':''}" onclick="setPriceRange('${r.key}')">${r.label}</button>`
    ).join("");
}

function setPriceRange(range) {
    currentPriceRange = range;
    renderPriceTags();
    renderGrid();
}

// ===== 排序切换 =====
function cycleSort() {
    const cycle = ["default", "price-asc", "price-desc"];
    const idx = cycle.indexOf(currentSort);
    currentSort = cycle[(idx + 1) % cycle.length];
    const btn = document.getElementById("sort-btn");
    const labels = {"default":"默认排序", "price-asc":"价格 ↑", "price-desc":"价格 ↓"};
    btn.textContent = labels[currentSort];
    btn.classList.toggle("active", currentSort !== "default");
    renderGrid();
}

// ===== 搜索 =====
function onSearchInput(val) {
    searchKeyword = val.trim();
    renderGrid();
}

function setFilter(f) {
    currentFilter = f;
    renderCatGrid();
    renderTags();
    renderGrid();
}

// ===== 渲染礼物列表 =====
function renderGrid() {
    let list = [...gifts];

    // 1. 分类筛选
    if (currentFilter === "已收到") list = list.filter(g => g.received);
    else if (currentFilter !== "全部") list = list.filter(g => g.cat === currentFilter);

    // 2. 价格区间筛选
    if (currentPriceRange !== "all") {
        list = list.filter(g => {
            const p = g.price;
            switch (currentPriceRange) {
                case "0-100":      return p <= 100;
                case "100-500":    return p > 100 && p <= 500;
                case "500-1000":   return p > 500 && p <= 1000;
                case "1000-2000":  return p > 1000 && p <= 2000;
                case "2000-3000":  return p > 2000 && p <= 3000;
                case "3000-5000":  return p > 3000 && p <= 5000;
                case "5000-10000": return p > 5000 && p <= 10000;
                case "10000+":     return p > 10000;
                default:           return true;
            }
        });
    }

    // 3. 关键词搜索
    if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        list = list.filter(g =>
            (g.name && g.name.toLowerCase().includes(kw)) ||
            (g.cat && g.cat.toLowerCase().includes(kw))
        );
    }

    // 4. 排序
    if (currentSort === "price-asc") list.sort((a, b) => a.price - b.price);
    else if (currentSort === "price-desc") list.sort((a, b) => b.price - a.price);

    // 5. 更新结果计数
    const countEl = document.getElementById("result-count");
    if (countEl) {
        if (list.length === 0) {
            countEl.textContent = "没有找到匹配的礼物";
            countEl.classList.add("empty");
        } else {
            countEl.textContent = `找到 ${list.length} 件礼物`;
            countEl.classList.remove("empty");
        }
    }

    const grid = document.getElementById("grid");
    const empty = document.getElementById("empty");

    if (!list.length) {
        grid.style.display = "none";
        // 区分"完全没有礼物"和"筛选无结果"
        const hasFilters = (currentFilter !== "全部") || (currentPriceRange !== "all") || searchKeyword;
        if (hasFilters && gifts.length > 0) {
            empty.querySelector(".empty-icon").textContent = "🔍";
            empty.querySelector("div:nth-child(2)").textContent = "没有找到匹配的礼物";
            empty.querySelector(".empty-sub").textContent = "试试调整筛选条件吧～";
        } else {
            empty.querySelector(".empty-icon").textContent = "🎀";
            empty.querySelector("div:nth-child(2)").textContent = "许愿池还是空的～";
            empty.querySelector(".empty-sub").textContent = "点右上角「管理」来添加心愿吧";
        }
        empty.style.display = "block";
        return;
    }

    grid.style.display = "grid";
    grid.classList.remove("grid-admin");
    empty.style.display = "none";

    grid.innerHTML = list.map(g => {
        return isAdmin ? renderEditableCard(g) : renderViewCard(g);
    }).join("");
}

function renderViewCard(g) {
    const link = normalizeLink(g.link);
    const hasLink = link && link.trim();
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent || "");
    const useAppOpen = hasLink && isMobile && isAppLinkable(link);

    // 用 <a> 标签代替 window.open，不会被弹窗拦截器阻止
    let buyBtn;
    if (hasLink) {
        if (useAppOpen) {
            // 手机端电商链接：点击时先尝试唤起App，同时 <a> 保证网页一定能打开
            buyBtn = `<a href="${esc(link)}" target="_blank" rel="noopener" class="card-buy-btn" onclick="return tryOpenApp(this)">去购买 🛒</a>`;
        } else {
            buyBtn = `<a href="${esc(link)}" target="_blank" rel="noopener" class="card-buy-btn">去购买 🛒</a>`;
        }
    } else {
        buyBtn = `<span class="card-no-link">暂无链接</span>`;
    }

    const recvBadge = g.received ? `<div class="badge">✅ 已收到</div>` : "";
    
    // 图片HTML - 添加懒加载
    let imgHtml = "";
    if (g.image) {
        imgHtml = `<img src="${esc(g.image)}" alt="${esc(g.name)}" class="card-img" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'card-emoji\\'>${getEmoji(g.cat)}</div>'">`;
    } else {
        imgHtml = `<div class="card-emoji">${getEmoji(g.cat)}</div>`;
    }
    
    return `
    <div class="card ${g.received?'received':''}">
        ${recvBadge}
        <div class="card-img-wrap">
            ${imgHtml}
        </div>
        <div class="card-body">
            <div class="card-name">${esc(g.name)}</div>
            <div class="card-bottom">
                <div class="card-price">¥${g.price.toLocaleString()}</div>
                ${buyBtn}
            </div>
        </div>
    </div>`;
}

// ===== 管理员模式卡片（直接编辑） =====
function renderEditableCard(g) {
    const imgHtml = g.image
        ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" class="card-img" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'card-emoji\\'>${getEmoji(g.cat)}</div>'">`
        : `<div class="card-emoji">${getEmoji(g.cat)}</div>`;

    return `
    <div class="card card-edit-mode ${g.received?'received':''}" data-id="${g.id}">
        <div class="card-edit-toolbar">
            <label class="card-recv-toggle">
                <input type="checkbox" ${g.received?'checked':''} onchange="inlineToggleRecv(${g.id}, this.checked)">
                <span>${g.received?'✅ 已收到':'已收到'}</span>
            </label>
            <button class="card-del-btn" onclick="deleteGift(${g.id})">🗑️ 删除</button>
        </div>

        <div class="card-img-wrap" onclick="document.getElementById('img-input-${g.id}').click()">
            ${imgHtml}
            <div class="card-img-overlay">📷 点击更换图片</div>
        </div>
        <input type="file" id="img-input-${g.id}" accept="image/*" style="display:none;" onchange="inlineChangeImage(${g.id}, event)">

        <div class="card-body">
            <input type="text" class="inline-input inline-name" value="${esc(g.name)}" placeholder="商品名称"
                onblur="inlineUpdate(${g.id}, 'name', this.value)">
            <div class="inline-row">
                <div class="inline-field">
                    <label>价格 ¥</label>
                    <input type="number" class="inline-input inline-price" value="${g.price}" placeholder="0" min="0"
                        onblur="inlineUpdate(${g.id}, 'price', parseInt(this.value)||0)">
                </div>
                <div class="inline-field">
                    <label>分类</label>
                    <select class="inline-input inline-cat" onchange="inlineUpdate(${g.id}, 'cat', this.value)">
                        ${["护肤","数码","家电","日用","鞋包","衣服","鲜花水果","零食","虚拟服务","书籍","运动","其他"].map(c =>
                            `<option value="${c}" ${g.cat===c?'selected':''}>${c}</option>`
                        ).join("")}
                    </select>
                </div>
            </div>
            <input type="text" class="inline-input inline-link" value="${esc(g.link||'')}" placeholder="购买链接（淘宝/京东等）"
                onblur="inlineUpdate(${g.id}, 'link', this.value.trim())">
            <div class="card-bottom">
                ${normalizeLink(g.link) ? `<a href="${esc(normalizeLink(g.link))}" target="_blank" rel="noopener" class="card-buy-btn" onclick="return tryOpenApp(this)">🛒 测试链接</a>` : `<span class="card-no-link">未设置链接</span>`}
                <span class="inline-saved" id="saved-${g.id}">✓ 已保存</span>
            </div>
        </div>
    </div>`;
}

// ===== 内联更新 =====
async function inlineUpdate(id, field, value) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;
    if (field === "link") value = normalizeLink(value);
    if (g[field] === value) return;
    g[field] = value;
    await saveGifts();
    const savedEl = document.getElementById("saved-" + id);
    if (savedEl) {
        savedEl.style.opacity = "1";
        setTimeout(() => { if (savedEl) savedEl.style.opacity = "0"; }, 1500);
    }
    if (field === "cat" || field === "price") {
        renderCatGrid();
        updateStats();
    }
}

async function inlineToggleRecv(id, checked) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;
    g.received = checked;
    await saveGifts();
    renderCatGrid();
    updateStats();
    showToast(checked ? "已标记收到 ✓" : "已标记为想要");
}

function inlineChangeImage(id, event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const imgData = e.target.result;
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement("canvas");
            let w = img.width, h = img.height;
            // 默认选取上半截（核心产品图片在上面）
            let srcX = 0, srcY = 0, srcW = w, srcH = h;
            if (h > w * 1.2) {
                srcH = Math.round(h * 0.5);
            }
            // 缩小到最大宽度
            let outW = srcW, outH = srcH;
            if (outW > IMAGE_MAX_WIDTH) { outH = srcH * IMAGE_MAX_WIDTH / srcW; outW = IMAGE_MAX_WIDTH; }
            canvas.width = outW;
            canvas.height = outH;
            canvas.getContext("2d").drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
            const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
            const g = gifts.find(x => x.id === id);
            if (!g) return;
            g.image = dataUrl;
            await saveGifts();
            renderGrid();
            showToast("图片已更新 ✓");
        };
        img.src = imgData;
    };
    reader.readAsDataURL(file);
}

function updateStats() {
    document.getElementById("stat-total").textContent = gifts.length;
    document.getElementById("stat-want").textContent = gifts.filter(g => !g.received).length;
    const total = gifts.filter(g => !g.received).reduce((s,g) => s+g.price, 0);
    document.getElementById("stat-price").textContent = total.toLocaleString();
}

async function deleteGift(id) {
    if (!confirm("确定删除这个礼物？")) return;
    gifts = gifts.filter(g => g.id !== id);
    await saveGifts();
    renderCatGrid();
    renderGrid();
    updateStats();
    showToast("已删除");
}

function handleNewImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const imgData = e.target.result;
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            let w = img.width, h = img.height;
            // 默认选取上半截（核心产品图片在上面）
            let srcX = 0, srcY = 0, srcW = w, srcH = h;
            if (h > w * 1.2) {
                srcH = Math.round(h * 0.5);
            }
            // 缩小到最大宽度
            let outW = srcW, outH = srcH;
            if (outW > IMAGE_MAX_WIDTH) { outH = srcH * IMAGE_MAX_WIDTH / srcW; outW = IMAGE_MAX_WIDTH; }
            canvas.width = outW;
            canvas.height = outH;
            canvas.getContext("2d").drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
            const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
            document.getElementById("edit-image").value = dataUrl;
            document.getElementById("image-preview").innerHTML = `<img src="${dataUrl}" class="preview-img" loading="lazy">`;
        };
        img.src = imgData;
    };
    reader.readAsDataURL(file);
}

function setImageFromUrl(url) {
    document.getElementById("edit-image").value = url;
    if (url && !url.startsWith("data:")) {
        document.getElementById("image-preview").innerHTML = `<img src="${esc(url)}" class="preview-img" onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'>图片加载失败</div>'">`;
    } else if (url) {
        document.getElementById("image-preview").innerHTML = `<img src="${esc(url)}" class="preview-img">`;
    } else {
        document.getElementById("image-preview").innerHTML = '<div class="image-placeholder">📷 点击上传图片</div>';
    }
}

// ===== 图片预处理：只截取底部文字区域（价格+产品名） =====
function preprocessImage(imageData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            let w = img.width, h = img.height;

            // 只截取图片最底部区域（淘宝/京东截图的文字都在底部）
            // 竖图（手机截图）：底部 30%（从 70% 处开始）
            // 横图：底部 40%（从 60% 处开始）
            let srcX = 0, srcY = 0, srcW = w, srcH = h;
            if (h > w * 1.1) {
                // 手机竖屏截图：价格在 ~78%，标题在 ~88%，截取底部 30%
                srcY = Math.round(h * 0.68);
                srcH = h - srcY;
            } else {
                // 横图/方图：截取底部 40%
                srcY = Math.round(h * 0.58);
                srcH = h - srcY;
            }

            // 限制最大宽度
            const maxW = 1200;
            let outW = srcW, outH = srcH;
            if (outW > maxW) { outH = Math.round(srcH * maxW / srcW); outW = maxW; }
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

            const imgData = ctx.getImageData(0, 0, outW, outH);
            const data = imgData.data;

            // 轻度灰度化 + 对比度增强（不使用激进二值化，保留彩色文字可读性）
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                // 中等对比度增强，不做硬二值化
                const contrast = 1.4;
                let adjusted = ((gray - 128) * contrast) + 128;
                adjusted = Math.max(0, Math.min(255, adjusted));
                data[i] = data[i+1] = data[i+2] = adjusted;
            }
            ctx.putImageData(imgData, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        img.src = imageData;
    });
}

// ===== OCR 截图识别 =====
function handleOcrUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        startOcr(e.target.result);
    };
    reader.readAsDataURL(file);
}

async function startOcr(imageData) {
    const progressDiv = document.getElementById("ocr-progress");
    const progressText = document.getElementById("ocr-progress-text");
    const progressFill = document.getElementById("ocr-progress-fill");
    const resultDiv = document.getElementById("ocr-result");

    progressDiv.style.display = "block";
    resultDiv.style.display = "none";
    progressText.textContent = "正在预处理图片...";
    progressFill.style.width = "10%";

    try {
        showToast("正在识别图片文字...");
        progressText.textContent = "正在优化图片质量...";
        progressFill.style.width = "20%";

        // 图片预处理：缩放 + 灰度 + 对比度增强 + 二值化
        const processedImage = await preprocessImage(imageData);

        progressText.textContent = "正在识别文字...";
        progressFill.style.width = "30%";

        const result = await Tesseract.recognize(processedImage, "chi_sim+eng", {
            logger: (m) => {
                if (m.status === "recognizing text") {
                    const p = Math.round(30 + m.progress * 60);
                    progressFill.style.width = p + "%";
                    progressText.textContent = "正在识别文字... " + Math.round(m.progress * 100) + "%";
                }
            }
        });

        progressFill.style.width = "95%";
        progressText.textContent = "识别完成，正在解析...";

        const text = result.data.text;
        console.log("OCR识别结果：", text);

        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

        // ===== 价格提取 =====
        // 策略：在裁切后的底部区域中，价格（¥+数字）通常出现在靠上的位置（产品名上方）
        let bestPrice = 0;
        const allText = text;

        // 第一步：找带 ¥/￥/$ 符号的价格（最可靠）
        // 排除"原价/划线价"等前缀，优先取第一个有效的当前价格
        const pricePatterns = [
            /国补[^¥￥]*[¥￥]\s*([\d,]+\.?\d*)/,      // "国补后约¥4998"
            /[¥￥]\s*([\d,]+\.?\d*)\s*(起|元)?/,       // "¥4998起"
            /\$\s*([\d,]+\.?\d*)/,
        ];
        for (const pat of pricePatterns) {
            const match = allText.match(pat);
            if (match) {
                const before = allText.substring(0, allText.indexOf(match[0]));
                // 排除原价行
                if (/原价|划线价|门市价|吊牌价|建议价|优惠前/.test(before)) continue;
                const v = parseFloat(match[1].replace(/,/g, ""));
                if (v >= 1 && v <= 100000) { bestPrice = Math.round(v); break; }
            }
        }

        // 第二步：如果没找到带符号的，在所有行中找纯数字
        if (!bestPrice) {
            for (const line of lines) {
                // 跳过明显不是价格的行
                if (line.length > 10 && !/[¥￥$]/.test(line)) continue;
                if (/原|划线|吊牌|建议|优惠前|满减|补贴.*%/.test(line)) continue;
                const nums = line.match(/\b(\d{2,5})(?:\.\d{1,2})?\b/g);
                if (nums) {
                    const v = parseFloat(nums[0]);
                    if (v >= 10 && v <= 50000) { bestPrice = Math.round(v); break; }
                }
            }
        }

        // ===== 名称提取 =====
        // 在裁切的底部区域中，产品名是最长的连续文字行，位于最底部几行
        const noisePrefix = /^(天猫|淘宝|京东|【行业|爆款|顺丰|官方|正品|热卖|推荐)/;
        const noiseSuffix = /(包邮|运费险|现货|发货|赠品|券|满减|折起|起售|已售|月销|评价|收藏|加入购物车|立即购买|领券|店铺|客服|万\+|人付款|\d+\.\d*万?$)/;
        const noiseWords = /^(\d+%|[¥￥\$]|补贴|政府|可用|收货|地址|为准|保存|扫码|打开App|相册|登录)$/;

        let name = "";
        
        // 收集候选名称行（过滤掉纯数字、纯符号、过短、过长的噪音行）
        const candidates = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 基本长度过滤
            if (line.length < 5 || line.length > 80) continue;
            // 纯数字/符号行跳过
            if (/^[\d¥￥$.,\s\-+]+$/.test(line)) continue;
            // 明显的噪音词
            if (noiseWords.test(line)) continue;
            // 过短的无意义行
            if (noiseSuffix.test(line) && line.length < 15) continue;
            
            candidates.push({ line, idx: i });
        }

        if (candidates.length > 0) {
            // 产品名通常是裁切区域内最长的文字行之一
            // 优先取最长的，如果有多个差不多长的，取靠后的（更接近底部）
            candidates.sort((a, b) => b.line.length - a.line.length);
            const longestLen = candidates[0].line.length;
            // 取最长的一批里最靠下的那个（产品名在最底部）
            const topCandidates = candidates.filter(c => c.line.length >= longestLen * 0.8);
            topCandidates.sort((a, b) => b.idx - a.idx);  // 靠后优先
            name = topCandidates[0].line;
        } else {
            // 兜底：取任何看起来像文字的行
            for (const line of lines) {
                if (line.length >= 3 && !/^[\d¥￥$.,]+$/.test(line)) {
                    name = line.substring(0, 50);
                    break;
                }
            }
        }

        // 清理名称
        if (name) {
            name = name.replace(/\s+/g, " ").trim();
            // 去掉开头可能的平台标识
            name = name.replace(/^(天猫|淘宝|京东)[\s【]*/, "");
            if (name.length > 50) name = name.substring(0, 50);
        }

        progressFill.style.width = "100%";
        progressDiv.style.display = "none";

        if (name) document.getElementById("edit-name").value = name;
        if (bestPrice) document.getElementById("edit-price").value = bestPrice;
        await setOcrImage(imageData);

        resultDiv.className = "fetch-result success";
        resultDiv.innerHTML = `✅ 识别完成！<br><b>名称：</b>${esc(name || "（未识别）")}<br><b>价格：</b>¥${bestPrice || "（未识别）"}<br><small>图片已自动填入，确认后点保存。</small>`;
        resultDiv.style.display = "block";
        showToast("识别完成，请确认信息！");
    } catch(err) {
        progressDiv.style.display = "none";
        resultDiv.className = "fetch-result error";
        resultDiv.innerHTML = `❌ 识别失败：${esc(err.message)}<br>请手动填写。`;
        resultDiv.style.display = "block";
        showToast("识别失败，请手动填写");
    }
}

async function setOcrImage(imageData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            let w = img.width, h = img.height;
            // 默认选取上半截（核心产品图片在上面）
            let srcX = 0, srcY = 0, srcW = w, srcH = h;
            if (h > w * 1.2) {
                // 竖图（手机截图）：只取上半截
                srcH = Math.round(h * 0.5);
            }
            // 缩小到最大宽度
            let outW = srcW, outH = srcH;
            if (outW > IMAGE_MAX_WIDTH) { outH = srcH * IMAGE_MAX_WIDTH / srcW; outW = IMAGE_MAX_WIDTH; }
            canvas.width = outW;
            canvas.height = outH;
            canvas.getContext("2d").drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
            const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
            document.getElementById("edit-image").value = dataUrl;
            document.getElementById("image-preview").innerHTML = `<img src="${dataUrl}" class="preview-img" loading="lazy">`;
            resolve();
        };
        img.src = imageData;
    });
}

// ===== 快速粘贴 =====
function quickParse() {
    const text = document.getElementById("quick-paste").value.trim();
    if (!text) { showToast("请先粘贴商品信息"); return; }

    const priceMatch = text.match(/[¥￥$]?\s*([\d,]+\.?\d*)/);
    let price = null;
    if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ""));

    let name = text.split("\n")[0].trim();
    name = name.replace(/[¥￥$]\s*[\d,]+\.?\d*/g, "").trim();
    if (name.length > 50) name = name.substring(0, 50);

    if (name) document.getElementById("edit-name").value = name;
    if (price) document.getElementById("edit-price").value = price;

    // 智能提取链接（支持淘宝/京东大段分享文案）
    const link = extractUrl(text);
    if (link) {
        document.getElementById("edit-link").value = link;
    }

    showToast("✅ 已自动填入，请确认后保存");
}

// ===== 工具函数 =====
function getEmoji(cat) {
    return {"护肤":"✨","数码":"💻","家电":"🏠","日用":"🧴","鞋包":"👢","衣服":"👗","鲜花水果":"💐","零食":"🍰","虚拟服务":"🎮","书籍":"📚","运动":"⚽","其他":"🎁"}[cat] || "🎁";
}

// 从一段中文分享文案中，提取第一个真实的 http/https 链接
function extractUrl(text) {
    if (!text) return "";
    text = text.trim();
    // 如果整段已经是 URL，直接返回
    if (/^(https?:|mailto:|tel:)/i.test(text)) return text;

    // 提取 https?:// 开头，直到遇到空格或常见中文/特殊结束符
    // 兼容：?tk=xxx、短链、带 # 的片段等
    const m = text.match(/(https?:\/\/[a-zA-Z0-9\-._~%!$&'()*+,;=:@\/]+(?:\?[a-zA-Z0-9\-._~%!$&'()*+,;=:@\/]*)?(?:#[a-zA-Z0-9\-._~%!$&'()*+,;=:@\/]*)?)/i);
    if (m) return m[1].trim();

    // 兜底：尝试 m.tb.cn/xxx 或 e.tb.cn/xxx 这种无协议的短链
    const short = text.match(/(m\.tb\.cn|e\.tb\.cn|item\.taobao\.com|detail\.tmall\.com|item\.jd\.com|3\.cn)\/[a-zA-Z0-9\-._~%!$&'()*+,;=:@\/]+/i);
    if (short) return "https://" + short[0];

    return "";
}

function normalizeLink(url) {
    if (!url) return "";
    url = url.trim();
    // 如果是一段分享文案，先提取真实链接
    if (url.includes("https://") || url.includes("http://") || url.includes(".tb.cn") || url.includes("taobao.com") || url.includes("jd.com") || url.includes("tmall.com") || url.includes("3.cn")) {
        const extracted = extractUrl(url);
        if (extracted) url = extracted;
    }
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^\/\//.test(url)) return "https:" + url;
    // 处理如 m.tb.cn/xxxxx 的短链
    if (/^[a-z0-9]+\.[a-z0-9]+/i.test(url)) return "https://" + url;
    return url;
}

// 判断链接是否为支持 App 唤起的电商链接
function isAppLinkable(url) {
    if (!url) return false;
    return /(e\.tb\.cn|m\.tb\.cn|item\.taobao|s\.click\.taobao|tmall|tb\.cn|jd\.com|3\.cn|jingdong)/i.test(url);
}

// 根据网页链接生成对应的 App scheme URL
function buildAppUrl(url) {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);

    if (/e\.tb\.cn|m\.tb\.cn|item\.taobao|s\.click\.taobao|tmall|tb\.cn/i.test(url)) {
        return `tbopen://m.taobao.com/tbopen/index.html?action=ali.open.nav&module=h5&url=${encodeURIComponent(url)}`;
    } else if (/jd\.com|3\.cn|jingdong/i.test(url)) {
        if (isIOS) {
            return `openapp.jdmobile://virtual?params=${encodeURIComponent(JSON.stringify({des: "m", url: url}))}`;
        } else if (isAndroid) {
            return `intent://#Intent;scheme=openapp.jdmobile;package=com.jingdong.app.mall;S.params=${encodeURIComponent(JSON.stringify({des: "m", url: url}))};end`;
        }
    }
    return "";
}

// 手机端：配合 <a> 标签使用，尝试唤起App的同时让链接正常打开
// 返回 true 让 <a> 的默认行为（打开网页）继续执行
function tryOpenApp(el) {
    const url = el.getAttribute("href");
    if (!url) return true;

    const ua = navigator.userAgent || "";
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
    if (!isMobile || !isAppLinkable(url)) return true;

    const appUrl = buildAppUrl(url);
    if (appUrl) {
        // 用隐藏 iframe 尝试唤起 App，不会影响当前页面
        try {
            const iframe = document.createElement("iframe");
            iframe.style.display = "none";
            iframe.src = appUrl;
            document.body.appendChild(iframe);
            // 2秒后清理 iframe
            setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 2000);
        } catch (e) { /* 忽略 */ }
    }
    // 返回 true → <a> 标签继续打开网页链接
    // 如果 App 成功唤起，用户会看到 App；网页标签页也会打开但不影响
    return true;
}

// 管理模式测试链接：尝试唤起App，失败则跳转网页
function openAppOrWeb(url) {
    if (!url) return;
    const ua = navigator.userAgent || "";
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);

    if (!isMobile || !isAppLinkable(url)) {
        // 桌面端：用 <a> 方式打开
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }

    const appUrl = buildAppUrl(url);
    if (!appUrl) {
        window.location.href = url;
        return;
    }

    // 尝试唤起 App
    const start = Date.now();
    let iframe;
    try {
        iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = appUrl;
        document.body.appendChild(iframe);
    } catch (e) {
        window.location.href = url;
        return;
    }

    // 1.5 秒后若未离开页面，App 未打开 → 跳转网页
    // 注意：用 location.href 而非 window.open，因为 setTimeout 内的 window.open 会被弹窗拦截器阻止
    setTimeout(() => {
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (Date.now() - start < 1600) {
            window.location.href = url;
        }
    }, 1500);
}

function esc(s) {
    if (!s) return "";
    return s.toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function refreshPage() {
    // 强制从云端刷新：清除 dirty 标志，重新拉取
    localDirty = false;
    localStorage.setItem("gift_wishlist_dirty", "false");
    setSyncStatus("loading", "正在从云端刷新...");
    syncFromCloud();
    showToast("已刷新 ✓");
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

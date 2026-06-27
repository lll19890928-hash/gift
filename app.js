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
let syncStatus = "loading"; // loading | synced | offline | error
let sb = null; // Supabase 客户端实例（避免与 SDK 全局变量 supabase 冲突）

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

// ===== 等待外部 SDK 加载 =====
function waitForSupabase(maxMs = 8000) {
    return new Promise(resolve => {
        const hasSdk = (typeof supabase !== "undefined" && supabase && supabase.createClient) ||
                       (typeof createClient !== "undefined" && createClient);
        if (hasSdk) return resolve();
        let attempts = 0;
        const interval = 100;
        const timer = setInterval(() => {
            const hasSdkNow = (typeof supabase !== "undefined" && supabase && supabase.createClient) ||
                              (typeof createClient !== "undefined" && createClient);
            if (hasSdkNow) {
                clearInterval(timer);
                return resolve();
            }
            attempts++;
            if (attempts * interval >= maxMs) {
                clearInterval(timer);
                debugLog("waitForSupabase", "等待Supabase SDK超时", true);
                resolve();
            }
        }, interval);
    });
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", async () => {
    debugLog("DOMContentLoaded", "页面初始化开始");
    // 1. 先立即从本地加载并渲染，避免页面白屏/卡死（不依赖外部CDN）
    loadLocalGifts();
    debugLog("本地礼物数", gifts.length);
    renderCatGrid();
    renderTags();
    renderGrid();
    updateStats();
    debugLog("首屏渲染完成", "");

    // 2. 等待 Supabase SDK 加载后再初始化云端同步
    debugLog("等待Supabase SDK", "最多8秒...");
    await waitForSupabase();
    initSupabase();
    debugLog("Supabase初始化后", sb ? "成功" : (window.__syncErr || "失败"));

    // 3. 后台尝试从云端同步（不阻塞首屏）
    if (sb) {
        debugLog("开始云端同步", "");
        syncFromCloud();
    } else {
        debugLog("跳过云端同步", "SDK未加载或初始化失败", true);
        setSyncStatus("offline", "离线模式（外部脚本未加载）");
    }
});

// ===== Supabase =====
function initSupabase() {
    try {
        if (!SUPABASE_URL || !SUPABASE_KEY) {
            window.__syncErr = "未配置 Supabase URL/Key";
            sb = null;
            return;
        }
        // 兼容不同加载方式：本地UMD会创建全局 `supabase`，ESM可能创建 `createClient`
        const sdkGlobal = (typeof supabase !== "undefined" && supabase) ? supabase : null;
        const clientFactory = (sdkGlobal && sdkGlobal.createClient) || (typeof createClient !== "undefined" && createClient);
        if (!clientFactory) {
            window.__syncErr = "Supabase SDK 未加载（检查网络）";
            sb = null;
            return;
        }
        sb = clientFactory(SUPABASE_URL, SUPABASE_KEY);
        if (!sb) {
            window.__syncErr = "Supabase 客户端创建失败";
        }
    } catch (e) {
        console.error("Supabase 初始化失败", e);
        window.__syncErr = "初始化错误: " + (e.message || e);
        sb = null;
    }
}

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
        console.log("[loadLocalGifts] localStorage data:", d ? d.substring(0, 100) : "empty");
        if (d) {
            const parsed = JSON.parse(d);
            if (Array.isArray(parsed) && parsed.length > 0) {
                gifts = parsed;
                loaded = true;
            }
        }
    } catch (e) {
        console.error("[loadLocalGifts] parse error:", e);
    }
    if (!loaded || !gifts.length) {
        console.log("[loadLocalGifts] using default gifts");
        gifts = getDefaultGifts();
    }
    normalizeGifts();
    console.log("[loadLocalGifts] final gifts count:", gifts.length);
}

async function syncFromCloud() {
    if (!sb) {
        debugLog("syncFromCloud", "sb未初始化: " + (window.__syncErr || "未知"), true);
        setSyncStatus("error", window.__syncErr || "云端同步未启用");
        return;
    }
    setSyncStatus("loading", "正在连接云端...");
    debugLog("syncFromCloud", "开始请求云端数据");
    try {
        // 5 秒超时，避免网络卡住导致页面一直 loading
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("连接云端超时")), 5000)
        );
        const fetchCloud = sb.from("wishlist").select("data").eq("id", 1).single();
        debugLog("syncFromCloud", "已发送请求，等待响应...");
        const { data, error } = await Promise.race([fetchCloud, timeout]);
        debugLog("syncFromCloud响应", "error=" + (error ? (error.code + " " + error.message) : "null") + ", data=" + (data ? typeof data : "null"));

        if (error) {
            // 没有记录（PGRST116）时把默认数据上传到云端
            if (error.code === "PGRST116" || (error.message && error.message.includes("0 rows"))) {
                debugLog("syncFromCloud", "云端无记录，准备上传默认数据");
                const defaults = getDefaultGifts();
                const { error: upErr } = await sb.from("wishlist").upsert({ id: 1, data: defaults, updated_at: new Date().toISOString() }, { onConflict: "id" });
                if (upErr) throw upErr;
                gifts = defaults;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
                normalizeGifts();
                renderCatGrid();
                renderTags();
                renderGrid();
                updateStats();
                setSyncStatus("synced", "已同步到云端");
                debugLog("syncFromCloud", "默认数据已上传并显示");
            } else {
                throw error;
            }
        } else if (data && Array.isArray(data.data)) {
            gifts = data.data;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
            normalizeGifts();
            renderCatGrid();
            renderTags();
            renderGrid();
            updateStats();
            setSyncStatus("synced", "已同步到云端");
            debugLog("syncFromCloud", "云端数据已加载，礼物数=" + gifts.length);
        } else {
            throw new Error("云端数据格式异常: " + JSON.stringify(data).slice(0, 100));
        }
    } catch (e) {
        console.error("云端同步失败", e);
        debugLog("syncFromCloud错误", (e && e.message) || e, true);
        window.__syncErr = e.message || "云端同步失败";
        setSyncStatus("offline", "离线模式（使用本地缓存）");
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
    // 1. 先保存到本地（即时反馈）
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));

    // 2. 异步同步到 Supabase
    if (sb) {
        setSyncStatus("loading", "正在保存到云端...");
        try {
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("保存云端超时")), 5000)
            );
            const upsertCloud = sb
                .from("wishlist")
                .upsert({ id: 1, data: gifts, updated_at: new Date().toISOString() }, { onConflict: "id" });
            const { error } = await Promise.race([upsertCloud, timeout]);

            if (error) throw error;
            setSyncStatus("synced", "已同步到云端");
        } catch (e) {
            console.error("云端保存失败", e);
            setSyncStatus("error", "云端保存失败，已存到本地");
        }
    }
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
    const tags = ["全部", "想要", "已收到"];
    document.getElementById("tags").innerHTML = tags.map(t =>
        `<button class="tag ${t===currentFilter?'active':''}" onclick="setFilter('${t}')">${t}</button>`
    ).join("");
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
    grid.classList.remove("grid-admin");
    // 管理员模式下卡片内容多，用较少列数（由CSS控制）
    empty.style.display = "none";

    grid.innerHTML = list.map(g => {
        return isAdmin ? renderEditableCard(g) : renderViewCard(g);
    }).join("");
}

function renderViewCard(g) {
    const link = normalizeLink(g.link);
    const hasLink = link && link.trim();
    const buyBtn = hasLink
        ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="card-buy-btn">去购买 🛒</a>`
        : `<span class="card-no-link">暂无链接</span>`;
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
                <span>${g.received?'✅ 已收到':'🎁 想要'}</span>
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
                ${normalizeLink(g.link) ? `<a href="${esc(normalizeLink(g.link))}" target="_blank" rel="noopener noreferrer" class="card-buy-btn">🛒 测试链接</a>` : `<span class="card-no-link">未设置链接</span>`}
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
    showToast(checked ? "已标记收到 ✓" : "已标记想要");
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
            // 优化：缩小图片尺寸
            if (w > IMAGE_MAX_WIDTH) { h = h * IMAGE_MAX_WIDTH / w; w = IMAGE_MAX_WIDTH; }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
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
            // 优化：缩小图片尺寸，减少质量
            if (w > IMAGE_MAX_WIDTH) { h = h * IMAGE_MAX_WIDTH / w; w = IMAGE_MAX_WIDTH; }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
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

// ===== 图片预处理：缩放 + 灰度 + 对比度 + 二值化 =====
function preprocessImage(imageData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            let w = img.width, h = img.height;
            // 限制最大宽度，提高识别速度和准确率
            const maxW = 1200;
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);

            const imgData = ctx.getImageData(0, 0, w, h);
            const data = imgData.data;

            // 灰度化 + 对比度增强 + 二值化
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                const contrast = 1.6;
                let adjusted = ((gray - 128) * contrast) + 128;
                // 二值化：文字更黑，背景更白
                adjusted = adjusted > 175 ? 255 : 0;
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

        // 价格提取
        let bestPrice = 0;
        const lines2 = text.split("\n");
        const totalLines = lines2.length;

        // 1. 提取带 ¥/$ 符号的价格，并记录所在行
        let symbolPrices = [];
        const priceRegex = /[¥￥$]\s*([\d,]+\.?\d*)/g;
        let priceMatch;
        while ((priceMatch = priceRegex.exec(text)) !== null) {
            const before = text.substring(Math.max(0, priceMatch.index - 20), priceMatch.index);
            // 过滤原价、划线价提示
            if (/原价|划线价|门市价|专柜价|吊牌价|建议价/.test(before)) continue;
            const lineIdx = text.substring(0, priceMatch.index).split("\n").length - 1;
            symbolPrices.push({
                raw: priceMatch[0],
                value: parseFloat(priceMatch[1].replace(/,/g, "")),
                lineIdx,
                hasSymbol: true
            });
        }

        // 2. 提取下半部分的纯数字价格
        let numPrices = [];
        lines2.forEach((line, lineIdx) => {
            // 只取图片下半部分
            if (lineIdx < totalLines * 0.35) return;
            // 过滤包含促销词的行
            if (/原价|划线价|门市价|专柜价|吊牌价|建议价|到手价约|预估|满|减|券|折|补贴|政府|可用/.test(line)) return;
            const nums = line.match(/\b(\d{2,5})(?:\.\d{1,2})?\b/g);
            if (nums) {
                nums.forEach(n => {
                    const v = parseFloat(n);
                    if (v >= 10 && v <= 50000) {
                        numPrices.push({ raw: n, value: v, lineIdx, hasSymbol: false });
                    }
                });
            }
        });

        // 3. 选择最可能的价格：优先带符号的价格，且靠下的；其次靠下的纯数字
        let candidatePrices = symbolPrices.length > 0 ? symbolPrices : numPrices;
        if (candidatePrices.length > 0) {
            // 优先选择图片下半部分的价格
            const lowerHalf = candidatePrices.filter(p => p.lineIdx >= totalLines * 0.45);
            const pool = lowerHalf.length > 0 ? lowerHalf : candidatePrices;
            // 按行号（靠下）和数值综合排序，优先靠下的
            pool.sort((a, b) => b.lineIdx - a.lineIdx || b.value - a.value);
            bestPrice = Math.round(pool[0].value);
        }

        // 名称提取
        const noiseWords = /补贴|政府|可用|收货|地址|为准|保存|扫码|打开App|相册|登录|包邮|运费|险|天猫|淘宝|京东|旗舰店|官方|正品|秒杀|限时|特惠|优惠|促销|满减|领券|券后|到手价|约价|预估|原价|现价|划线价|价格|¥|￥|$|官方旗舰店|已售|月销|收藏|加购|购物车|立即购买|下单|商品|详情|参数|评价|推荐|相似|精选|热门|爆款|销量|店铺|客服|首页|分类|我的|足迹/;
        let name = "";

        // 候选行：过滤噪音后，按长度排序
        const candidates = lines
            .map((line, idx) => ({ line, idx }))
            .filter(({ line }) => {
                if (line.length < 4 || line.length > 60) return false;
                if (/^[\d¥￥$.,\s\-]+$/.test(line)) return false;
                if (/^\d+%$/.test(line)) return false;
                if (noiseWords.test(line)) return false;
                return true;
            })
            .sort((a, b) => b.line.length - a.line.length);

        if (candidates.length > 0) {
            // 优先选择上半部分较长的商品名（淘宝截图通常在顶部）
            const upper = candidates.filter(c => c.idx < totalLines * 0.6);
            name = upper.length > 0 ? upper[0].line : candidates[0].line;
        }

        // 如果没找到，放宽条件
        if (!name) {
            for (const line of lines) {
                if (line.length >= 3 && !/^[\d¥￥$.,\s]+$/.test(line)) {
                    name = line.substring(0, 50);
                    break;
                }
            }
        }

        // 清理名称中的噪音
        if (name) {
            name = name.replace(/\s+/g, " ").trim();
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
            if (h > w * 1.2) {
                const cropTop = Math.round(h * 0.15);
                const cropH = Math.round(h * 0.6);
                canvas.width = w;
                canvas.height = cropH;
                canvas.getContext("2d").drawImage(img, 0, cropTop, w, cropH, 0, 0, w, cropH);
            } else {
                // 优化：缩小图片尺寸
                if (w > IMAGE_MAX_WIDTH) { h = h * IMAGE_MAX_WIDTH / w; w = IMAGE_MAX_WIDTH; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            }
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

    const linkMatch = text.match(/(https?:\/\/[^\s]+)/);
    if (linkMatch) document.getElementById("edit-link").value = normalizeLink(linkMatch[1]);

    showToast("✅ 已自动填入，请确认后保存");
}

// ===== 工具函数 =====
function getEmoji(cat) {
    return {"护肤":"✨","数码":"💻","家电":"🏠","日用":"🧴","鞋包":"👢","衣服":"👗","鲜花水果":"💐","零食":"🍰","虚拟服务":"🎮","书籍":"📚","运动":"⚽","其他":"🎁"}[cat] || "🎁";
}

function normalizeLink(url) {
    if (!url) return "";
    url = url.trim();
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^\/\//.test(url)) return "https:" + url;
    // 处理如 m.tb.cn/xxxxx 的短链
    if (/^[a-z0-9]+\.[a-z0-9]+/i.test(url)) return "https://" + url;
    return url;
}

function esc(s) {
    if (!s) return "";
    return s.toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

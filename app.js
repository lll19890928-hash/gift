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
    renderCatGrid();
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
    document.getElementById("pwd-input").onkeydown = (e) => {
        if (e.key === "Enter") doLogin();
    };
}

// ===== 本地存储 =====
function loadGifts() {
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        if (d) gifts = JSON.parse(d);
    } catch(e) {}
    gifts.forEach(g => {
        if (!g.image) g.image = "";
        if (!g.cat) g.cat = "其他";
        if (g.received === undefined) g.received = false;
    });
    if (!gifts.length) gifts = getDefaultGifts();
}

function saveGifts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
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

// ===== 分类图标区 =====
function renderCatGrid() {
    const cats = [
        {key:"护肤", icon:"✨", label:"护肤美妆", color:"#fce4ec"},
        {key:"数码", icon:"👓", label:"数码科技", color:"#e3f2fd"},
        {key:"家电", icon:"🏠", label:"家居家电", color:"#e8f5e9"},
        {key:"日用", icon:"📦", label:"日用好物", color:"#fff3e0"},
        {key:"鞋包", icon:"👢", label:"鞋包配饰", color:"#f3e5f5"},
        {key:"电子产品", icon:"📱", label:"电子产品", color:"#e0f7fa"},
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
    grid.style.gridTemplateColumns = isAdmin ? "1fr" : "repeat(2, 1fr)";
    empty.style.display = "none";

    grid.innerHTML = list.map(g => {
        if (isAdmin) {
            return renderEditableCard(g);
        } else {
            return renderViewCard(g);
        }
    }).join("");
}

// ===== 普通浏览模式卡片 =====
function renderViewCard(g) {
    const hasLink = g.link && g.link.trim();
    const buyBtn = hasLink
        ? `<a href="${esc(g.link)}" target="_blank" rel="noopener noreferrer" class="card-buy-btn">去购买 🛒</a>`
        : `<span class="card-no-link">暂无链接</span>`;
    const recvBadge = g.received ? `<div class="badge">✅ 已收到</div>` : "";

    return `
    <div class="card ${g.received?'received':''}">
        ${recvBadge}
        <div class="card-img-wrap">
            ${g.image
                ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" class="card-img" onerror="this.parentElement.innerHTML='<div class=\\'card-emoji\\'>${getEmoji(g.cat)}</div>'">`
                : `<div class="card-emoji">${getEmoji(g.cat)}</div>`
            }
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

// ===== 管理员模式卡片（可直接编辑） =====
function renderEditableCard(g) {
    const imgHtml = g.image
        ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" class="card-img" onerror="this.parentElement.innerHTML='<div class=\\'card-emoji\\'>${getEmoji(g.cat)}</div>'">`
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
                        ${["护肤","数码","家电","日用","鞋包","电子产品","书籍","运动","其他"].map(c =>
                            `<option value="${c}" ${g.cat===c?'selected':''}>${c}</option>`
                        ).join("")}
                    </select>
                </div>
            </div>
            <input type="text" class="inline-input inline-link" value="${esc(g.link||'')}" placeholder="购买链接（淘宝/京东等）"
                onblur="inlineUpdate(${g.id}, 'link', this.value.trim())">
            <div class="card-bottom">
                ${g.link ? `<a href="${esc(g.link)}" target="_blank" rel="noopener noreferrer" class="card-buy-btn">🛒 测试链接</a>` : `<span class="card-no-link">未设置链接</span>`}
                <span class="inline-saved" id="saved-${g.id}">✓ 已保存</span>
            </div>
        </div>
    </div>`;
}

// ===== 内联更新 =====
function inlineUpdate(id, field, value) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;
    if (g[field] === value) return; // 没变就不保存
    g[field] = value;
    saveGifts();
    // 显示保存提示
    const savedEl = document.getElementById("saved-" + id);
    if (savedEl) {
        savedEl.style.opacity = "1";
        setTimeout(() => { if (savedEl) savedEl.style.opacity = "0"; }, 1500);
    }
    // 如果是分类变了，更新分类计数
    if (field === "cat" || field === "price") {
        renderCatGrid();
        updateStats();
    }
}

function inlineToggleRecv(id, checked) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;
    g.received = checked;
    saveGifts();
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
        // 压缩图片
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            let w = img.width, h = img.height;
            if (w > 600) { h = h * 600 / w; w = 600; }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
            const g = gifts.find(x => x.id === id);
            if (!g) return;
            g.image = dataUrl;
            saveGifts();
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

// ===== 管理登录 =====
function doLogin() {
    const pwd = document.getElementById("pwd-input").value;
    if (pwd === ADMIN_PWD) {
        isAdmin = true;
        document.getElementById("login-box").style.display = "none";
        document.getElementById("admin-panel").style.display = "block";
        renderGrid();
        showToast("管理模式已开启，可直接编辑卡片");
    } else {
        showToast("密码错误");
    }
}

function exitAdmin() {
    isAdmin = false;
    closeModal("modal-admin");
    renderGrid();
    showToast("已退出管理模式");
}

// ===== 添加新礼物弹窗 =====
function openEdit(id = null) {
    document.getElementById("edit-form").reset();
    document.getElementById("edit-id").value = "";
    document.getElementById("edit-image").value = "";
    document.getElementById("fetch-result").style.display = "none";
    document.getElementById("fetch-url").value = "";
    document.getElementById("quick-paste").value = "";
    document.getElementById("edit-image-url").value = "";
    document.getElementById("ocr-result").style.display = "none";
    document.getElementById("ocr-progress").style.display = "none";
    document.getElementById("ocr-preview-area").style.display = "none";
    document.getElementById("image-preview").innerHTML = '<div class="image-placeholder">暂无图片</div>';

    document.getElementById("edit-title").textContent = "添加礼物";
    openModal("modal-edit");
}

// ===== 图片预览 =====
function setImageFromUrl(url) {
    document.getElementById("edit-image").value = url;
    if (url) {
        document.getElementById("image-preview").innerHTML = `<img src="${esc(url)}" class="preview-img" onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'>图片加载失败</div>'">`;
    } else {
        document.getElementById("image-preview").innerHTML = '<div class="image-placeholder">暂无图片</div>';
    }
}

// ===== OCR 截图识别 =====
function handleOcrUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const imgData = e.target.result;
        document.getElementById("ocr-preview-img").src = imgData;
        document.getElementById("ocr-preview-area").style.display = "block";
        startOcr(imgData);
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
    progressText.textContent = "正在加载识别引擎...";
    progressFill.style.width = "10%";

    try {
        showToast("正在识别图片文字...");
        progressText.textContent = "正在识别文字...";
        progressFill.style.width = "30%";

        const result = await Tesseract.recognize(imageData, "chi_sim+eng", {
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

        let allPrices = [];
        const priceRegex = /[¥￥$]\s*([\d,]+\.?\d*)/g;
        let priceMatch;
        while ((priceMatch = priceRegex.exec(text)) !== null) {
            allPrices.push({ raw: priceMatch[0], value: parseFloat(priceMatch[1].replace(/,/g, "")), index: priceMatch.index });
        }
        const lines2 = text.split("\n");
        const totalLines = lines2.length;
        lines2.forEach((line, lineIdx) => {
            const nums = line.match(/\b(\d{3,5})\b/g);
            if (nums && lineIdx > totalLines * 0.5) {
                nums.forEach(n => {
                    const v = parseFloat(n);
                    if (v > 10 && v < 100000) {
                        allPrices.push({ raw: n, value: v, index: -1, lineIdx });
                    }
                });
            }
        });

        let bestPrice = 0;
        if (allPrices.length > 0) {
            const lowerPrices = allPrices.filter(p => p.lineIdx === undefined || p.lineIdx > totalLines * 0.4);
            const pricePool = lowerPrices.length > 0 ? lowerPrices : allPrices;
            const decimalPrices = pricePool.filter(p => p.value % 1 !== 0);
            if (decimalPrices.length > 0) {
                bestPrice = Math.round(decimalPrices[0].value);
            } else {
                const sorted = pricePool.map(p => p.value).sort((a,b) => b - a);
                bestPrice = Math.round(sorted[0]);
            }
        }

        let name = "";
        for (const line of lines) {
            if (/^[A-Za-z][A-Za-z0-9\s\-\/\.]{2,40}$/.test(line) && /\d/.test(line)) { name = line.trim(); break; }
        }
        if (!name) {
            for (const line of lines) {
                if (/^[\d¥￥$.,\s]+$/.test(line)) continue;
                if (/补贴|政府|可用|收货|地址|为准|保存|扫码|打开App|相册|登录/.test(line)) continue;
                if (/^\d+%$/.test(line)) continue;
                if (line.length < 3) continue;
                if (line.length <= 50) { name = line; break; }
            }
        }
        if (!name) {
            for (const line of lines) {
                if (line.length >= 3 && !/^[\d¥￥$.,\s]+$/.test(line)) { name = line.substring(0, 50); break; }
            }
        }

        progressFill.style.width = "100%";
        progressDiv.style.display = "none";

        if (name) document.getElementById("edit-name").value = name;
        if (bestPrice) document.getElementById("edit-price").value = bestPrice;
        await setOcrImage(imageData);

        resultDiv.className = "fetch-result success";
        resultDiv.innerHTML = `✅ 识别完成！请确认信息：<br><b>名称：</b>${esc(name || "（未识别）")}<br><b>价格：</b>¥${bestPrice || "（未识别）"}<br><small>图片已自动填入，确认后保存。</small>`;
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
                if (w > 500) { h = h * 500 / w; w = 500; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            }
            const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
            document.getElementById("edit-image").value = dataUrl;
            document.getElementById("edit-image-url").value = dataUrl;
            document.getElementById("image-preview").innerHTML = `<img src="${dataUrl}" class="preview-img">`;
            resolve();
        };
        img.src = imageData;
    });
}

function cancelCrop() {
    document.getElementById("ocr-preview-area").style.display = "none";
    document.getElementById("ocr-result").style.display = "none";
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
    if (linkMatch) {
        document.getElementById("edit-link").value = linkMatch[1];
        document.getElementById("fetch-url").value = linkMatch[1];
    }
    showToast("✅ 已自动填入，请确认后保存");
}

// ===== 链接识别 =====
async function fetchFromLink() {
    const url = document.getElementById("fetch-url").value.trim();
    if (!url) { showToast("请先粘贴商品链接"); return; }

    const btn = document.getElementById("btn-fetch");
    const resultDiv = document.getElementById("fetch-result");
    btn.disabled = true;
    btn.textContent = "识别中...";
    resultDiv.style.display = "none";

    try {
        showToast("正在识别...");
        let data = null;
        let apiSuccess = false;

        try {
            const res = await fetch(`https://api.oioweb.cn/api/common/TbPc?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
            const json = await res.json();
            if (json && json.result) { data = json.result; apiSuccess = true; }
        } catch(e) {}

        if (!apiSuccess) {
            try {
                const res2 = await fetch(`https://api.vvhan.com/api/TbPc?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
                const json2 = await res2.json();
                if (json2 && (json2.title || json2.name)) { data = json2; apiSuccess = true; }
            } catch(e) {}
        }

        btn.disabled = false;
        btn.textContent = "识别";

        if (apiSuccess && data) {
            const name = data.title || data.name || "";
            const price = data.price ? parseInt(String(data.price).replace(/[^\d]/g, "")) : 0;
            const image = data.img || data.image || data.pic || "";
            if (name) document.getElementById("edit-name").value = name;
            if (price) document.getElementById("edit-price").value = price;
            if (image) {
                document.getElementById("edit-image").value = image;
                document.getElementById("edit-image-url").value = image;
                document.getElementById("image-preview").innerHTML = `<img src="${esc(image)}" class="preview-img" onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'>图片加载失败</div>'">`;
            }
            document.getElementById("edit-link").value = url;
            resultDiv.className = "fetch-result success";
            resultDiv.innerHTML = `✅ 识别成功！已自动填入，请确认后保存。`;
            resultDiv.style.display = "block";
            showToast("识别成功！");
        } else {
            showManualInput(resultDiv, url);
        }
    } catch(err) {
        btn.disabled = false;
        btn.textContent = "识别";
        showManualInput(resultDiv, url);
    }
}

function showManualInput(resultDiv, url) {
    resultDiv.className = "fetch-result error";
    resultDiv.innerHTML = `❌ 自动识别失败<br><small>淘宝/京东有反爬虫保护。请手动填写名称、价格，链接已保留。</small>`;
    resultDiv.style.display = "block";
    document.getElementById("edit-link").value = url;
    showToast("请手动填写");
}

// ===== 保存新礼物 =====
function saveGift() {
    const name = document.getElementById("edit-name").value.trim();
    const price = parseInt(document.getElementById("edit-price").value) || 0;
    const link = document.getElementById("edit-link").value.trim();
    const cat = document.getElementById("edit-cat").value;
    const image = document.getElementById("edit-image").value.trim();

    if (!name || !price) { showToast("请填写名称和价格"); return; }

    gifts.push({ id: Date.now(), name, price, link, image, cat, received: false });
    saveGifts();
    renderCatGrid();
    renderGrid();
    updateStats();
    closeModal("modal-edit");
    showToast("添加成功！");
}

function deleteGift(id) {
    if (!confirm("确定删除这个礼物？")) return;
    gifts = gifts.filter(g => g.id !== id);
    saveGifts();
    renderCatGrid();
    renderGrid();
    updateStats();
    showToast("已删除");
}

// ===== 工具函数 =====
function getEmoji(cat) {
    return {"护肤":"✨","数码":"👓","电子产品":"📱","书籍":"📚","配饰":"👜","鞋包":"👢","家居":"🏠","家电":"🏠","日用":"📦","美妆":"💄","运动":"⚽","其他":"🎁"}[cat] || "🎁";
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

function openModal(id) {
    document.getElementById(id).classList.add("open");
    document.body.style.overflow = "hidden";
}

function closeModal(id) {
    document.getElementById(id).classList.remove("open");
    const any = document.querySelectorAll(".modal.open").length;
    if (!any) document.body.style.overflow = "";
}

// ===== 配置 =====
const ADMIN_PWD = "8888";
const STORAGE_KEY = "gift_wishlist_data";

// ===== 数据 =====
let gifts = [];
let isAdmin = false;
let currentFilter = "全部";
let ocrWorker = null;

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
}

// ===== 本地存储 =====
function loadGifts() {
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        if (d) gifts = JSON.parse(d);
    } catch(e) {}
    // 兼容旧数据
    gifts.forEach(g => { if (!g.image) g.image = ""; });
    if (!gifts.length) gifts = getDefaultGifts();
}

function saveGifts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gifts));
}

function getDefaultGifts() {
    return [
        {id:1, name:"示例礼物（可删除）", price:199, cat:"其他", link:"", image:"", received:false}
    ];
}

// ===== 分类图标区 =====
function renderCatGrid() {
    const cats = [
        {key:"电子产品", icon:"📱", label:"电子产品", color:"#e3f2fd"},
        {key:"书籍", icon:"📚", label:"书籍", color:"#fce4ec"},
        {key:"配饰", icon:"👜", label:"配饰", color:"#f3e5f5"},
        {key:"家居", icon:"🏠", label:"家居", color:"#e8f5e9"},
        {key:"美妆", icon:"💄", label:"美妆", color:"#fce4ec"},
        {key:"运动", icon:"⚽", label:"运动", color:"#e0f7fa"},
        {key:"其他", icon:"🎁", label:"其他", color:"#fff3e0"},
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
            <div class="card-img-wrap">
                ${g.image
                    ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" class="card-img" onerror="this.parentElement.innerHTML='<div class=\\'card-emoji\\'>${getEmoji(g.cat)}</div>'">`
                    : `<div class="card-emoji">${getEmoji(g.cat)}</div>`
                }
            </div>
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
    document.getElementById("edit-image").value = "";
    document.getElementById("fetch-result").style.display = "none";
    document.getElementById("fetch-url").value = "";
    document.getElementById("quick-paste").value = "";
    document.getElementById("edit-image-url").value = "";
    document.getElementById("ocr-result").style.display = "none";
    document.getElementById("ocr-progress").style.display = "none";
    document.getElementById("ocr-preview-area").style.display = "none";
    document.getElementById("image-preview").innerHTML = '<div class="image-placeholder">暂无图片</div>';

    if (id) {
        const g = gifts.find(x => x.id === id);
        if (!g) return;
        document.getElementById("edit-title").textContent = "编辑礼物";
        document.getElementById("edit-id").value = g.id;
        document.getElementById("edit-name").value = g.name;
        document.getElementById("edit-price").value = g.price;
        document.getElementById("edit-link").value = g.link || "";
        document.getElementById("edit-cat").value = g.cat || "其他";
        document.getElementById("edit-image").value = g.image || "";
        document.getElementById("edit-image-url").value = g.image || "";
        if (g.image) {
            document.getElementById("image-preview").innerHTML = `<img src="${esc(g.image)}" class="preview-img" onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'>图片加载失败</div>'">`;
        }
    } else {
        document.getElementById("edit-title").textContent = "添加礼物";
    }
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
        // 显示预览
        document.getElementById("ocr-preview-img").src = imgData;
        document.getElementById("ocr-preview-area").style.display = "block";
        // 开始 OCR
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

        // ===== 智能解析淘宝/京东截图 =====
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

        // --- 提取所有价格 ---
        let allPrices = [];
        const priceRegex = /[¥￥$]\s*([\d,]+\.?\d*)/g;
        let priceMatch;
        while ((priceMatch = priceRegex.exec(text)) !== null) {
            allPrices.push({
                raw: priceMatch[0],
                value: parseFloat(priceMatch[1].replace(/,/g, "")),
                index: priceMatch.index
            });
        }
        // 也匹配纯数字（如 "459" 独立出现）
        const numInText = text.match(/(?<![¥￥$\w\d.])(\d{2,4})(?=\s*(元|起|\n|$))/g);
        if (numInText) {
            numInText.forEach(n => {
                const v = parseFloat(n);
                if (v > 10 && v < 100000) allPrices.push({ raw: n, value: v, index: -1 });
            });
        }

        // 智能选择最佳价格：优先非整数（如575.04），其次较大的数
        let bestPrice = 0;
        if (allPrices.length > 0) {
            // 先找带小数的（通常是真实价格）
            const decimalPrices = allPrices.filter(p => p.value % 1 !== 0);
            if (decimalPrices.length > 0) {
                bestPrice = Math.round(decimalPrices[0].value);
            } else {
                // 都取整了，取中间值（排除太小的）
                const valid = allPrices.filter(p => p.value >= 50).sort((a,b) => b.value - a.value);
                if (valid.length > 0) bestPrice = Math.round(valid[0].value);
            }
        }

        // --- 智能提取商品名称 ---
        let name = "";
        // 优先级1：找包含英文+数字的型号行（如 "Lenovo L24-4C"）
        for (const line of lines) {
            if (/^[A-Za-z][A-Za-z0-9\s\-\/\.]{2,40}$/.test(line) && /\d/.test(line)) {
                name = line.trim();
                break;
            }
        }
        // 优先级2：找较长的中文行（商品全称），跳过纯价格/促销文字
        if (!name) {
            for (const line of lines) {
                // 跳过明显不是名称的行
                if (/^[\d¥￥$.,\s]+$/.test(line)) continue;
                if (/补贴|政府|可用|收货|地址|为准|保存|扫码|打开App|相册/.test(line)) continue;
                if (/^\d+%$/.test(line)) continue;  // 如 "4%"
                if (line.length < 4) continue;
                if (line.length <= 50) { name = line; break; }
            }
        }
        // 优先级3：如果还没找到，取第一行长文本
        if (!name) {
            for (const line of lines) {
                if (line.length >= 4 && !/^[\d¥￥$.,\s]+$/.test(line)) {
                    name = line.substring(0, 50);
                    break;
                }
            }
        }

        progressFill.style.width = "100%";
        progressDiv.style.display = "none";

        // 填入表单
        if (name) document.getElementById("edit-name").value = name;
        if (bestPrice) document.getElementById("edit-price").value = bestPrice;

        // 将截图转为商品图片（压缩后）
        await setOcrImage(imageData);

        resultDiv.className = "fetch-result success";
        resultDiv.innerHTML = `✅ 识别成功！<br>
            <b>名称：</b>${esc(name || "未识别")}<br>
            <b>价格：</b>¥${bestPrice || "未识别"}${allPrices.length > 1 ? '<br><small style="color:#888">识别到 '+allPrices.length+' 个价格，已选最优值</small>' : ''}<br>
            图片已自动填入（截图本身），请确认后保存。`;
        resultDiv.style.display = "block";
        showToast("识别成功！");

    } catch(err) {
        console.error("OCR失败：", err);
        progressDiv.style.display = "none";
        resultDiv.className = "fetch-result error";
        resultDiv.innerHTML = `❌ 文字识别失败：${esc(err.message)}<br>请手动填写商品信息。`;
        resultDiv.style.display = "block";
        showToast("识别失败，请手动填写");
    }
}

async function setOcrImage(imageData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            let w = img.width;
            let h = img.height;

            // 智能裁剪：对于竖向淘宝截图，尝试截取中间的商品图区域
            // 典型淘宝截图布局：顶部品牌区 → 中间商品大图 → 底部价格/信息
            if (h > w * 1.3 && h > 400) {
                // 竖向截图：取中间 60% 高度区域（通常是商品主图）
                const cropTop = Math.round(h * 0.18);
                const cropH = Math.round(h * 0.55);
                canvas.width = w;
                canvas.height = cropH;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, cropTop, w, cropH, 0, 0, w, cropH);
            } else {
                // 横向或小图：压缩到最大宽度 500px
                let maxW = 500;
                if (w > maxW) { h = h * maxW / w; w = maxW; }
                canvas.width = w;
                canvas.height = h;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
            }

            // 转为 JPEG data URL（质量 0.75）
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

// ===== 快速粘贴解析 =====
function quickParse() {
    const text = document.getElementById("quick-paste").value.trim();
    if (!text) {
        showToast("请先粘贴商品信息");
        return;
    }

    const priceMatch = text.match(/[¥￥$]?\s*([\d,]+\.?\d*)/);
    let price = null;
    if (priceMatch) {
        price = parseInt(priceMatch[1].replace(/,/g, ""));
    }

    let name = text.split("\n")[0].trim();
    name = name.replace(/[¥￥$]\s*[\d,]+\.?\d*/g, "").trim();
    if (name.length > 50) {
        name = name.substring(0, 50);
    }

    if (name) document.getElementById("edit-name").value = name;
    if (price) document.getElementById("edit-price").value = price;

    const linkMatch = text.match(/(https?:\/\/[^\s]+)/);
    if (linkMatch) {
        document.getElementById("edit-link").value = linkMatch[1];
        document.getElementById("fetch-url").value = linkMatch[1];
        setTimeout(() => fetchFromLink(), 500);
    }

    showToast("✅ 已自动填入，正在获取图片...");
}

// ===== 链接识别 =====
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

        let data = null;
        let apiSuccess = false;

        // 尝试 oioweb API
        try {
            const res = await fetch(`https://api.oioweb.cn/api/common/TbPc?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(8000)
            });
            const json = await res.json();
            if (json && json.result) {
                data = json.result;
                apiSuccess = true;
            }
        } catch(e) {}

        if (!apiSuccess) {
            try {
                const res2 = await fetch(`https://api.vvhan.com/api/TbPc?url=${encodeURIComponent(url)}`, {
                    signal: AbortSignal.timeout(8000)
                });
                const json2 = await res2.json();
                if (json2 && (json2.title || json2.name)) {
                    data = json2;
                    apiSuccess = true;
                }
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
            resultDiv.innerHTML = `✅ 识别成功！已自动填入名称、价格、图片和链接，请确认后保存。`;
            resultDiv.style.display = "block";
            showToast("识别成功！");
        } else {
            await fetchByCorsProxy(url);
        }
    } catch(err) {
        btn.disabled = false;
        btn.textContent = "识别";
        await fetchByCorsProxy(url);
    }
}

async function fetchByCorsProxy(url) {
    const btn = document.getElementById("btn-fetch");
    const resultDiv = document.getElementById("fetch-result");

    try {
        showToast("正在通过代理抓取...");
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        const html = await res.text();

        let name = "";
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) name = titleMatch[1].trim();

        let price = 0;
        const pricePatterns = [
            /"price"[:\s]+"?(\d+\.?\d*)/i,
            /¥\s*(\d+)/,
            /￥\s*(\d+)/,
            /"viewPrice"\s*:\s*"([\d.]+)"/
        ];
        for (const pattern of pricePatterns) {
            const m = html.match(pattern);
            if (m) { price = parseInt(m[1]); break; }
        }

        let image = "";
        const imgPatterns = [
            /"img"\s*:\s*"([^"]+)"/,
            /"pic_url"\s*:\s*"([^"]+)"/,
            /<meta\s+property="og:image"\s+content="([^"]+)"/i
        ];
        for (const pattern of imgPatterns) {
            const m = html.match(pattern);
            if (m) { image = m[1]; break; }
        }

        btn.disabled = false;
        btn.textContent = "识别";

        if (name || price) {
            if (name) document.getElementById("edit-name").value = name.substring(0, 80);
            if (price) document.getElementById("edit-price").value = price;
            if (image) {
                document.getElementById("edit-image").value = image;
                document.getElementById("edit-image-url").value = image;
                document.getElementById("image-preview").innerHTML = `<img src="${esc(image)}" class="preview-img" onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'>图片加载失败</div>'">`;
            }
            document.getElementById("edit-link").value = url;

            resultDiv.className = "fetch-result success";
            resultDiv.innerHTML = `✅ 抓取成功！已自动填入信息，请确认后保存。`;
            resultDiv.style.display = "block";
            showToast("抓取成功！");
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
    resultDiv.innerHTML = `
        ❌ 自动识别失败<br>
        <small>淘宝/京东有反爬虫保护，自动识别成功率较低。</small><br><br>
        <strong>📝 手动填写（只需10秒）：</strong><br>
        1. 复制商品标题 → 粘贴到「礼物名称」<br>
        2. 复制商品价格 → 粘贴到「价格」<br>
        3. 复制商品图片地址 → 粘贴到「图片网址」<br>
        4. 商品链接已自动保留在下方<br><br>
        <button onclick="keepLinkOnly()" style="padding:8px 16px;background:#ff6b8a;color:#fff;border:none;border-radius:8px;cursor:pointer;">保留链接并手动填写</button>
    `;
    resultDiv.style.display = "block";
    showToast("请手动填写");
}

function keepLinkOnly() {
    const url = document.getElementById("fetch-url").value.trim();
    document.getElementById("edit-link").value = url;
    document.getElementById("edit-name").focus();
    showToast("链接已保留，请补充名称、价格和图片");
}

// ===== 保存礼物 =====
function saveGift() {
    const id = document.getElementById("edit-id").value;
    const name = document.getElementById("edit-name").value.trim();
    const price = parseInt(document.getElementById("edit-price").value) || 0;
    const link = document.getElementById("edit-link").value.trim();
    const cat = document.getElementById("edit-cat").value;
    const image = document.getElementById("edit-image").value.trim();

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
            gifts[idx].image = image;
            gifts[idx].cat = cat;
        }
    } else {
        gifts.push({
            id: Date.now(),
            name,
            price,
            link,
            image,
            cat,
            received: false
        });
    }

    saveGifts();
    renderCatGrid();
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
    renderCatGrid();
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
    renderCatGrid();
    renderGrid();
    updateStats();
    renderAdminList();
    showToast(g.received ? "已标记收到 ✓" : "已标记想要");
}

// ===== 查看详情（支持深度链接跳转App）=====
function viewDetail(id) {
    const g = gifts.find(x => x.id === id);
    if (!g) return;

    let imgHtml = "";
    if (g.image) {
        imgHtml = `<img src="${esc(g.image)}" style="width:100%;max-width:260px;border-radius:12px;margin-bottom:12px;box-shadow:0 4px 16px rgba(0,0,0,0.1);" onerror="this.style.display='none'">`;
    }

    let html = `
        <div style="text-align:center;padding:20px;">
            ${imgHtml}
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
        const isTaobao = /taobao\.com|tmall\.com/.test(g.link);
        const isJD = /jd\.com|jingdong\.com/.test(g.link);

        let deepLink = g.link;
        let deepLinkText = "🛒 去购买";

        if (isTaobao) {
            const itemMatch = g.link.match(/id=(\d+)/);
            if (itemMatch) {
                deepLink = `taobao://item.taobao.com/item.htm?id=${itemMatch[1]}`;
                deepLinkText = "🛒 在淘宝App中打开";
            }
        } else if (isJD) {
            const skuMatch = g.link.match(/\/(\d+)\.html/);
            if (skuMatch) {
                deepLink = `openapp.jdmobile://virtual?params={"category":"jump","des":"productDetail","skuId":"${skuMatch[1]}"}`;
                deepLinkText = "🛒 在京东App中打开";
            }
        }

        html += `
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
                <a href="javascript:void(0)" onclick="openAppLink('${esc(g.link)}','${esc(deepLink)}')" style="padding:14px 32px;background:linear-gradient(135deg,#ff6b8a,#ff8eb4);color:#fff;text-decoration:none;border-radius:14px;font-size:16px;font-weight:600;display:inline-block;cursor:pointer;border:none;font-family:inherit;">${deepLinkText}</a>
                <a href="${esc(g.link)}" target="_blank" style="padding:14px 32px;background:#f0f0f0;color:#666;text-decoration:none;border-radius:14px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;cursor:pointer;font-family:inherit;">浏览器打开</a>
            </div>
            <div style="color:#999;font-size:12px;margin-top:8px;">如未安装App，将自动在浏览器中打开</div>
        `;
    } else {
        html += `<div style="color:#999;font-size:13px;margin-top:16px;">暂无购买链接</div>`;
    }

    html += `</div>`;
    document.getElementById("detail-body").innerHTML = html;
    openModal("modal-detail");
}

// ===== 深度链接跳转 =====
function openAppLink(webUrl, deepLink) {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = deepLink;
    document.body.appendChild(iframe);

    const timer = setTimeout(() => {
        window.location.href = webUrl;
    }, 1500);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) clearTimeout(timer);
    });

    setTimeout(() => {
        if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
        }
    }, 2000);

    showToast("正在打开App...");
}

// ===== 工具函数 =====
function getEmoji(cat) {
    return {"电子产品":"📱","书籍":"📚","配饰":"👜","家居":"🏠","美妆":"💄","运动":"⚽","其他":"🎁"}[cat] || "🎁";
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

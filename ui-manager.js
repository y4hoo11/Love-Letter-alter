// ui-manager.js
import { game } from "./game-logic.js";
import { isHost, rawPlayerList, broadcastState, hostKickPlayer, hostTransferAuthority } from "./network-manager.js";

// ホスト用：ゲーム開始
export function hostStartGame() {
    if (!isHost) return;
    const success = game.initRound(rawPlayerList);
    if (success) {
        document.getElementById("start-game-btn").style.display = "none";
        broadcastState();
        updateUI();
    }
}

// ホスト用：次のラウンドへ
export function hostNextRound() {
    if (!isHost) return;
    const currentScores = {};
    game.players.forEach(p => { currentScores[p.id] = p.score; });
    
    rawPlayerList.forEach(p => {
        p.score = currentScores[p.id] || 0;
    });

    const success = game.initRound(rawPlayerList);
    if (success) {
        document.getElementById("next-round-btn").style.display = "none";
        broadcastState();
        updateUI();
    }
}

// 画面全体の再描画
export function updateUI() {
    const deckCountEl = document.getElementById("deck-count");
    if (deckCountEl) {
        deckCountEl.innerText = game.isGameStarted ? `山札: ${game.deck.length}枚` : "山札: --枚";
    }

    const roleDisplayEl = document.getElementById("role-display");
    if (roleDisplayEl) {
        if (!game.isGameStarted) {
            roleDisplayEl.innerText = isHost ? "👑 ホスト（待機中）" : "🟢 ゲスト（待機中）";
        } else {
            const currentTurnPlayer = game.players[game.turnIndex];
            if (currentTurnPlayer) {
                roleDisplayEl.innerText = `Turn: ${currentTurnPlayer.name}`;
            }
        }
    }

    const startBtn = document.getElementById("start-game-btn");
    if (startBtn && isHost && !game.isGameStarted) {
        const nextBtn = document.getElementById("next-round-btn");
        if (!nextBtn || nextBtn.style.display !== "block") {
            startBtn.style.display = "block";
        }
    }

    renderPlayerList();
    renderMyHand();
    renderTracker();
}

// プレイヤーリストのレンダリング（初手カード・ドローカードの区別化）
function renderPlayerList() {
    const listEl = document.getElementById("player-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    const targetList = game.isGameStarted ? game.players : rawPlayerList;

    targetList.forEach(p => {
        const item = document.createElement("div");
        item.className = "player-item";
        if (game.isGameStarted) {
            if (!p.alive) item.classList.add("eliminated");
            const currentTurnPlayer = game.players[game.turnIndex];
            if (currentTurnPlayer && currentTurnPlayer.id === p.id && p.alive) {
                item.classList.add("active");
            }
        }

        const header = document.createElement("div");
        header.className = "player-header";

        const nameSpan = document.createElement("span");
        nameSpan.style.fontWeight = "bold";
        nameSpan.innerHTML = `${p.name} <span class="score-badge">${p.score || 0}勝</span> ${p.protected ? "🛡️" : ""}`;
        header.appendChild(nameSpan);

        if (isHost && p.id !== window.myId) {
            const btnGroup = document.createElement("div");
            
            const kickBtn = document.createElement("button");
            kickBtn.className = "btn-danger";
            kickBtn.innerText = "キック";
            kickBtn.onclick = () => hostKickPlayer(p.id);
            
            const transBtn = document.createElement("button");
            transBtn.className = "btn-host-transfer";
            transBtn.innerText = "権限譲渡";
            transBtn.onclick = () => hostTransferAuthority(p.id);

            btnGroup.appendChild(transBtn);
            btnGroup.appendChild(kickBtn);
            header.appendChild(btnGroup);
        }
        item.appendChild(header);

        // 🃏 相手の手札（初手かドローカードかを色と文字で区別）
        if (game.isGameStarted && !p.spectator && p.alive && p.id !== window.myId) {
            const handContainer = document.createElement("div");
            handContainer.className = "enemy-hand-container";
            handContainer.style.marginTop = "5px";

            p.hand.forEach((cardVal, index) => {
                const cardBack = document.createElement("div");
                cardBack.className = "card-back-red";
                
                // インデックスが初期配布枚数未満なら「初手」、それ以降なら「ドロー」
                const isInitialHand = index < game.drawSettings.firstTurnCount;
                
                cardBack.style.width = "55px";
                cardBack.style.height = "40px";
                cardBack.style.fontSize = "0.65rem";
                cardBack.style.display = "flex";
                cardBack.style.flexDirection = "column";
                cardBack.style.justifyContent = "center";
                cardBack.style.alignItems = "center";
                cardBack.style.borderRadius = "4px";
                cardBack.style.border = "1.5px solid #fff";

                if (isInitialHand) {
                    cardBack.style.background = "linear-gradient(135deg, #2980b9, #2c3e50)"; // 初手は青系
                    cardBack.innerHTML = `<span style="color:#f1c40f;">★初手</span><span>[${index + 1}枚目]</span>`;
                } else {
                    cardBack.style.background = "linear-gradient(135deg, #e74c3c, #c0392b)"; // ドローは赤系
                    cardBack.innerHTML = `<span style="color:#fff;">📥ドロー</span><span>[${index + 1}枚目]</span>`;
                }
                
                handContainer.appendChild(cardBack);
            });
            item.appendChild(handContainer);
        }

        // 捨て札履歴
        if (p.history && p.history.length > 0) {
            const historyEl = document.createElement("div");
            historyEl.className = "played-history";
            p.history.forEach(val => {
                const info = game.cardSettings[val] || { name: "?", desc: "" };
                const badge = document.createElement("div");
                badge.className = `history-card card-${val}`;
                badge.style.position = "relative"; 
                badge.style.cursor = "help"; 

                badge.innerHTML = `
                    <div>${val}</div>
                    <div class="h-name">${info.name}</div>
                    <div class="card-tooltip" style="width:160px; font-weight:normal; bottom:120%;">${info.desc}</div>
                `;
                historyEl.appendChild(badge);
            });
            item.appendChild(historyEl);
        }

        listEl.appendChild(item);
    });
}

// 自分の手札をレンダリング
function renderMyHand() {
    const cardArea = document.getElementById("card-area");
    const handTitle = document.getElementById("hand-title");
    if (!cardArea) return;
    cardArea.innerHTML = "";

    if (!game.isGameStarted) {
        if (handTitle) handTitle.style.display = "none";
        return;
    }

    const me = game.players.find(p => p.id === window.myId);
    if (!me || !me.alive || me.spectator) {
        if (handTitle) handTitle.style.display = "block";
        if (handTitle) handTitle.innerText = "あなたは観戦中、または脱落しています";
        return;
    }

    if (handTitle) {
        handTitle.style.display = "block";
        handTitle.innerText = "あなたの手札";
    }

    const currentTurnPlayer = game.players[game.turnIndex];
    const isMyTurn = currentTurnPlayer && currentTurnPlayer.id === window.myId;

    me.hand.forEach((val, index) => {
        const info = game.cardSettings[val] || { name: "??", desc: "" };
        const card = document.createElement("div");
        card.className = `card card-${val}`;
        
        const isInitialHand = index < game.drawSettings.firstTurnCount;
        const originText = isInitialHand ? "★初手" : "📥ドロー";

        card.innerHTML = `
            <div style="font-size:0.65rem; background:rgba(0,0,0,0.4); padding:2px 6px; border-radius:10px; color:#fff;">${originText}</div>
            <div class="card-num">${val}</div>
            <div class="card-name">${info.name}</div>
            <div class="card-tooltip">${info.desc}</div>
        `;

        if (isMyTurn) {
            card.onclick = () => selectPlayTarget(val);
        } else {
            card.style.cursor = "not-allowed";
            card.style.opacity = "0.8";
        }

        cardArea.appendChild(card);
    });
}

// ターゲット選択モーダル
function selectPlayTarget(cardValue) {
    if ([4, 7, 8].includes(cardValue)) {
        executePlayCard(cardValue, {});
        return;
    }

    const modal = document.getElementById("target-modal");
    const container = document.getElementById("target-buttons");
    if (!modal || !container) return;

    container.innerHTML = `<h4>「${game.cardSettings[cardValue].name}」の対象を選択</h4>`;
    const targets = game.players.filter(p => p.alive && !p.spectator && p.id !== window.myId);

    if (targets.length === 0) {
        const btn = document.createElement("button");
        btn.innerText = "対象なし（不発プレイ）";
        btn.onclick = () => {
            modal.style.display = "none";
            executePlayCard(cardValue, {});
        };
        container.appendChild(btn);
    } else {
        targets.forEach(t => {
            const btn = document.createElement("button");
            btn.innerText = `${t.name} ${t.protected ? "(🛡️保護中)" : ""}`;
            btn.onclick = () => {
                if (cardValue === 1) {
                    selectGuessValue(cardValue, t.id);
                } else {
                    modal.style.display = "none";
                    executePlayCard(cardValue, { targetPlayerId: t.id });
                }
            };
            container.appendChild(btn);
        });
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "キャンセル";
    cancelBtn.style.background = "#7f8c8d";
    cancelBtn.onclick = () => { modal.style.display = "none"; };
    container.appendChild(cancelBtn);

    modal.style.display = "flex";
}

// 兵士用：数字選択
function selectGuessValue(cardValue, targetPlayerId) {
    const container = document.getElementById("target-buttons");
    if (!container) return;
    container.innerHTML = `<h4>予想するカードを選択</h4>`;

    for (let i = 2; i <= 8; i++) {
        const btn = document.createElement("button");
        btn.innerText = `${i}: ${game.cardSettings[i]?.name || ''}`;
        btn.onclick = () => {
            document.getElementById("target-modal").style.display = "none";
            executePlayCard(cardValue, { targetPlayerId: targetPlayerId, guessCardValue: i });
        };
        container.appendChild(btn);
    }
}

function executePlayCard(cardValue, target) {
    if (isHost) {
        game.playCard(window.myId, cardValue, target);
        broadcastState();
        updateUI();
    } else {
        if (window.connToHost && window.connToHost.open) {
            window.connToHost.send(JSON.stringify({
                type: "ACTION",
                playerId: window.myId,
                cardValue: cardValue,
                target: target
            }));
        }
    }
}

// トラッカーレンダリング
function renderTracker() {
    const listEl = document.getElementById("card-tracker-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    listEl.style.display = "flex";
    listEl.style.flexWrap = "wrap";
    listEl.style.gap = "8px";
    listEl.style.justifyContent = "center";
    listEl.style.padding = "5px 0";

    const baseCounts = {};
    for (const [val, config] of Object.entries(game.cardSettings)) {
        baseCounts[val] = config.count;
    }

    const usedCounts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0 };
    if (game.isGameStarted) {
        game.players.forEach(p => {
            if (p.history) {
                p.history.forEach(c => { if (usedCounts[c] !== undefined) usedCounts[c]++; });
            }
        });
    }

    const circledNumbers = { 1:"①", 2:"②", 3:"③", 4:"④", 5:"⑤", 6:"⑥", 7:"⑦", 8:"⑧" };

    for (let i = 1; i <= 8; i++) {
        const total = baseCounts[i] || 0;
        const used = usedCounts[i] || 0;
        const remain = Math.max(0, total - used);
        const info = game.cardSettings[i] || { name: "", desc: "" };

        for (let k = 0; k < total; k++) {
            const badge = document.createElement("div");
            const isUsed = k >= remain;

            badge.className = `tracker-item tracker-${i}`;
            badge.style.position = "relative";
            badge.style.display = "inline-flex";
            badge.style.justifyContent = "center";
            badge.style.alignItems = "center";
            badge.style.width = "32px";
            badge.style.height = "32px";
            badge.style.borderRadius = "50%";
            badge.style.fontSize = "1.2rem";
            badge.style.fontWeight = "bold";
            badge.style.cursor = "help";

            if (isUsed) {
                badge.style.background = "#2c3e50";
                badge.style.color = "#7f8c8d";
                badge.style.opacity = "0.25";
                badge.style.border = "1px dashed #7f8c8d";
            }

            badge.innerHTML = `
                ${circledNumbers[i]}
                <div class="card-tooltip" style="width:160px; font-weight:normal; bottom:125%; font-size:0.75rem;">
                    <strong>【${i}: ${info.name}】</strong><br>${info.desc}
                </div>
            `;
            listEl.appendChild(badge);
        }
    }
}

// ⚙️ ホスト用：枚数カスタムUIの自動生成（ルール設定項目を追加）
export function injectCustomSettingsUIIntoGame() {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer || document.getElementById("host-custom-settings")) return;

    const div = document.createElement("div");
    div.id = "host-custom-settings";
    div.className = "custom-card-settings";
    
    let html = `<h3>⚙️ ルームカスタム設定 (ホスト権限)</h3>`;
    
    // 👑 ルール・枚数設定の追加
    html += `
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #f1c40f;">
            <h4 style="margin: 0 0 8px 0; color: #f1c40f; font-size:0.9rem;">📐 配布枚数設定</h4>
            <div class="setting-item">
                <span>最初の手札枚数:</span>
                <div class="setting-input-wrapper">
                    <input type="number" id="cfg-first-draw" value="${game.drawSettings.firstTurnCount}" min="1" max="5">
                </div>
            </div>
            <div class="setting-item">
                <span>毎ターンのドロー枚数:</span>
                <div class="setting-input-wrapper">
                    <input type="number" id="cfg-every-draw" value="${game.drawSettings.everyTurnCount}" min="1" max="3">
                </div>
            </div>
        </div>
        <h4 style="margin: 5px 0; font-size:0.9rem;">🃏 カードデッキ構成枚数</h4>
    `;

    for (let i = 1; i <= 8; i++) {
        html += `
            <div class="setting-item">
                <span class="setting-card-info">${i}番 ${game.cardSettings[i].name}</span>
                <div class="setting-input-wrapper">
                    <label>枚数:</label>
                    <input type="number" id="cfg-count-${i}" value="${game.cardSettings[i].count}" min="0" max="10">
                </div>
            </div>
        `;
    }
    div.innerHTML = html;
    
    const logBox = document.getElementById("log-box");
    gameContainer.insertBefore(div, logBox);

    // イベントフック: 初手枚数
    document.getElementById("cfg-first-draw")?.addEventListener("change", (e) => {
        game.drawSettings.firstTurnCount = Math.max(1, parseInt(e.target.value) || 1);
        broadcastState();
        updateUI();
    });

    // イベントフック: ターン枚数
    document.getElementById("cfg-every-draw")?.addEventListener("change", (e) => {
        game.drawSettings.everyTurnCount = Math.max(1, parseInt(e.target.value) || 1);
        broadcastState();
        updateUI();
    });

    // イベントフック: 各カード
    for (let i = 1; i <= 8; i++) {
        document.getElementById(`cfg-count-${i}`)?.addEventListener("change", (e) => {
            game.cardSettings[i].count = Math.max(0, parseInt(e.target.value) || 0);
            broadcastState();
            updateUI();
        });
    }
}

// 📋 ゲスト用：現在のホスト構成設定の同期表示
export function syncGuestSettingsUI(cardSettings, drawSettings) {
    if (isHost) return;

    let div = document.getElementById("guest-custom-settings");
    const gameContainer = document.getElementById("game-container");

    if (!div) {
        div = document.createElement("div");
        div.id = "guest-custom-settings";
        div.className = "custom-card-settings guest-view-only";
        const logBox = document.getElementById("log-box");
        gameContainer.insertBefore(div, logBox);
    }

    let html = `<h3>📋 現在のルームカスタム設定</h3>`;
    html += `
        <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin-bottom: 10px;">
            <div class="setting-item"><span>最初の手札枚数:</span><input type="number" value="${drawSettings.firstTurnCount}" disabled style="width:50px; text-align:center;"></div>
            <div class="setting-item"><span>毎ターンのドロー枚数:</span><input type="number" value="${drawSettings.everyTurnCount}" disabled style="width:50px; text-align:center;"></div>
        </div>
    `;

    for (let i = 1; i <= 8; i++) {
        const count = cardSettings[i]?.count ?? 0;
        html += `
            <div class="setting-item">
                <span class="setting-card-info">${i}番 ${game.cardSettings[i].name}</span>
                <div class="setting-input-wrapper">
                    <label>枚数:</label>
                    <input type="number" value="${count}" disabled>
                </div>
            </div>
        `;
    }
    div.innerHTML = html;
}

// ホスト用：ゲーム強制中断ボタン
export function injectAbortButton() {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer || document.getElementById("abort-game-btn")) return;

    const btn = document.createElement("button");
    btn.id = "abort-game-btn";
    btn.innerText = "🛑 ゲームを強制中断して待機室に戻る";
    btn.style.background = "#e74c3c";
    btn.style.marginTop = "10px";
    
    btn.onclick = () => {
        if (!isHost) return;
        game.isGameStarted = false;
        game.log("🛑 ホストによってゲームが強制中断されました。");
        broadcastState();
        updateUI();
    };

    const tracker = document.getElementById("card-tracker-container");
    gameContainer.insertBefore(btn, tracker);
}
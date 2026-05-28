// ui-manager.js
import { game } from "./game-logic.js";
import { isHost, rawPlayerList, broadcastState, hostKickPlayer, hostTransferAuthority, hostRemoveDisconnectedPlayer } from "./network-manager.js";

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
    if (startBtn) {
        startBtn.style.display = (isHost && !game.isGameStarted) ? "block" : "none";
    }

    const abortBtn = document.getElementById("abort-game-btn");
    if (abortBtn) {
        abortBtn.style.display = (isHost && game.isGameStarted) ? "block" : "none";
    }

    renderPlayerList();
    renderMyHand();
    renderTracker();
    renderCustomSettingsUI();
}

// プレイヤーリストのレンダリング
function renderPlayerList() {
    const listEl = document.getElementById("player-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    rawPlayerList.forEach(p => {
        const item = document.createElement("div");
        item.className = "player-item";
        
        // 接続切れ表示（視覚的に薄暗くする）
        if (p.disconnected) {
            item.classList.add("eliminated");
        }

        if (game.isGameStarted) {
            const pInGame = game.players.find(gp => gp.id === p.id);
            if (pInGame && !pInGame.alive) item.classList.add("eliminated");
            const currentTurnPlayer = game.players[game.turnIndex];
            if (currentTurnPlayer && currentTurnPlayer.id === p.id && (!pInGame || pInGame.alive)) {
                item.classList.add("active");
            }
        }

        const header = document.createElement("div");
        header.className = "player-header";

        const nameSpan = document.createElement("span");
        nameSpan.style.fontWeight = "bold";
        
        const statusText = p.disconnected ? " <span style='color:#e74c3c;'>[接続切れ]</span>" : "";
        const hostCrown = p.isHost ? "👑 " : "";
        const isProtected = game.isGameStarted && game.players.find(gp => gp.id === p.id)?.protected ? "🛡️" : "";

        nameSpan.innerHTML = `${hostCrown}${p.name}${statusText} <span class="score-badge">${p.score || 0}勝</span> ${isProtected}`;
        header.appendChild(nameSpan);

        // ホスト用操作ボタンの制御
        if (isHost && p.id !== window.myId) {
            const btnGroup = document.createElement("div");
            
            if (p.disconnected) {
                // 接続切れプレイヤーに対して「表示ごと完全に削除」するボタン
                const removeBtn = document.createElement("button");
                removeBtn.className = "btn-danger";
                removeBtn.innerText = "完全に削除";
                removeBtn.style.background = "#95a5a6";
                removeBtn.onclick = () => hostRemoveDisconnectedPlayer(p.id);
                btnGroup.appendChild(removeBtn);
            } else {
                // 通常のアクティブプレイヤーに対する操作ボタン
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
            }
            header.appendChild(btnGroup);
        }
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        item.appendChild(header);

        // 相手の手札描画
        if (game.isGameStarted && !p.spectator && p.id !== window.myId) {
            const pInGame = game.players.find(gp => gp.id === p.id);
            if (pInGame && pInGame.alive) {
                const handContainer = document.createElement("div");
                handContainer.className = "enemy-hand-container";
                handContainer.style.marginTop = "5px";

                pInGame.hand.forEach((cardVal, index) => {
                    const cardBack = document.createElement("div");
                    cardBack.className = "card-back-red";
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
                        cardBack.style.background = "linear-gradient(135deg, #2980b9, #2c3e50)";
                        cardBack.innerHTML = `<span style="color:#f1c40f;">★初手</span><span>[${index + 1}枚目]</span>`;
                    } else {
                        cardBack.style.background = "linear-gradient(135deg, #e74c3c, #c0392b)";
                        cardBack.innerHTML = `<span style="color:#fff;">📥ドロー</span><span>[${index + 1}枚目]</span>`;
                    }
                    handContainer.appendChild(cardBack);
                });
                item.appendChild(handContainer);
            }
        }

        // 捨て札履歴
        const pInGame = game.players.find(gp => gp.id === p.id);
        if (pInGame && pInGame.history && pInGame.history.length > 0) {
            const historyEl = document.createElement("div");
            historyEl.className = "played-history";
            pInGame.history.forEach(val => {
                const info = game.cardSettings[val] || { name: "?", desc: "" };
                const badge = document.createElement("div");
                badge.className = `history-card card-${val}`;
                badge.title = `【${val}: ${info.name}】\n${info.desc}`;
                badge.style.cursor = "help"; 

                badge.innerHTML = `
                    <div>${val}</div>
                    <div class="h-name">${info.name}</div>
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
        if (handTitle) {
            handTitle.style.display = "block";
            handTitle.innerText = "あなたは観戦中、または脱落しています";
        }
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
        card.title = info.desc;
        
        const isInitialHand = index < game.drawSettings.firstTurnCount;
        const originText = isInitialHand ? "★初手" : "📥ドロー";

        card.innerHTML = `
            <div style="font-size:0.65rem; background:rgba(0,0,0,0.4); padding:2px 6px; border-radius:10px; color:#fff;">${originText}</div>
            <div class="card-num">${val}</div>
            <div class="card-name">${info.name}</div>
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
            badge.style.display = "inline-flex";
            badge.style.justifyContent = "center";
            badge.style.alignItems = "center";
            badge.style.width = "32px";
            badge.style.height = "32px";
            badge.style.borderRadius = "50%";
            badge.style.fontSize = "1.2rem";
            badge.style.fontWeight = "bold";
            badge.style.cursor = "help";
            badge.title = `【${i}: ${info.name}】\n${info.desc}`;

            if (isUsed) {
                badge.style.background = "#2c3e50";
                badge.style.color = "#7f8c8d";
                badge.style.opacity = "0.25";
                badge.style.border = "1px dashed #7f8c8d";
            }

            badge.innerText = circledNumbers[i];
            listEl.appendChild(badge);
        }
    }
}

// ⚙️ 統合されたルール・枚数カスタム設定UI
export function renderCustomSettingsUI() {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer) return;

    const oldHostUI = document.getElementById("host-custom-settings");
    const oldGuestUI = document.getElementById("guest-custom-settings");
    if (oldHostUI) oldHostUI.remove();
    if (oldGuestUI) oldGuestUI.remove();

    let div = document.getElementById("integrated-custom-settings");
    if (!div) {
        div = document.createElement("div");
        div.id = "integrated-custom-settings";
        div.className = "custom-card-settings";
        const logBox = document.getElementById("log-box");
        gameContainer.insertBefore(div, logBox);
    }

    if (!isHost) {
        div.style.opacity = "0.5";
        div.style.pointerEvents = "none";
    } else {
        div.style.opacity = "1.0";
        div.style.pointerEvents = "auto";
    }

    const titleText = isHost ? "⚙️ ルームカスタム設定 (ホスト権限)" : "📋 現在のルームカスタム設定 (閲覧のみ)";
    const disabledAttr = isHost ? "" : "disabled";

    let html = `<h3>${titleText}</h3>`;
    html += `
        <h4 style="margin: 5px 0 12px 0; font-size:0.9rem;">🃏 カードデッキ構成枚数</h4>
    `;

    // 1番から8番（女王）までの入力欄を先にループ出力
    for (let i = 1; i <= 8; i++) {
        html += `
            <div class="setting-item">
                <span class="setting-card-info">${i}番 ${game.cardSettings[i].name}</span>
                <div class="setting-input-wrapper">
                    <label>枚数:</label>
                    <input type="number" id="cfg-count-${i}" value="${game.cardSettings[i].count}" min="0" max="10" ${disabledAttr}>
                </div>
            </div>
        `;
    }

    // ご指定の通り、8番 女王の枚数設定のすぐ下（カスタムブロックの最下部）に配布枚数設定を配置
    html += `
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-top: 15px; border: 1px solid #f1c40f;">
            <h4 style="margin: 0 0 8px 0; color: #f1c40f; font-size:0.9rem;">📐 配布枚数設定</h4>
            <div class="setting-item">
                <span>最初の手札枚数:</span>
                <div class="setting-input-wrapper">
                    <input type="number" id="cfg-first-draw" value="${game.drawSettings.firstTurnCount}" min="1" max="5" ${disabledAttr}>
                </div>
            </div>
            <div class="setting-item">
                <span>毎ターンのドロー枚数:</span>
                <div class="setting-input-wrapper">
                    <input type="number" id="cfg-every-draw" value="${game.drawSettings.everyTurnCount}" min="1" max="3" ${disabledAttr}>
                </div>
            </div>
        </div>
    `;
    
    div.innerHTML = html;

    if (isHost) {
        document.getElementById("cfg-first-draw")?.addEventListener("change", (e) => {
            game.drawSettings.firstTurnCount = Math.max(1, parseInt(e.target.value) || 1);
            broadcastState();
            updateUI();
        });

        document.getElementById("cfg-every-draw")?.addEventListener("change", (e) => {
            game.drawSettings.everyTurnCount = Math.max(1, parseInt(e.target.value) || 1);
            broadcastState();
            updateUI();
        });

        for (let i = 1; i <= 8; i++) {
            document.getElementById(`cfg-count-${i}`)?.addEventListener("change", (e) => {
                game.cardSettings[i].count = Math.max(0, parseInt(e.target.value) || 0);
                broadcastState();
                updateUI();
            });
        }
    }
}

// 旧互換維持用ダミー
export function syncGuestSettingsUI(cardSettings, drawSettings) {}
export function injectCustomSettingsUIIntoGame() {}

// ホスト用：ゲーム強制中断ボタン
export function injectAbortButton() {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer || document.getElementById("abort-game-btn")) return;

    const btn = document.createElement("button");
    btn.id = "abort-game-btn";
    btn.innerText = "🛑 ゲームを強制中断して待機室に戻る";
    btn.style.background = "#e74c3c";
    btn.style.marginTop = "10px";
    btn.style.display = isHost ? "block" : "none";
    
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
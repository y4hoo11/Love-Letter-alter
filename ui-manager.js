// ui-manager.js
import { game } from "./game-logic.js";
import { isHost, myId, rawPlayerList, broadcastState, leaveRoom, hostKickPlayer, hostTransferAuthority, safeSend, connToHost } from "./network-manager.js";

// ホスト側のゲーム開始・続行関数
export function hostStartGame() {
    if (!isHost) return;
    
    // 各カード枚数設定の読み込み
    for (let i = 1; i <= 8; i++) {
        const inputEl = document.getElementById(`card-count-${i}`);
        if (inputEl) {
            game.updateCardCount(i, parseInt(inputEl.value) || 0);
        }
    }

    // ドロー設定の読み込み
    const firstDrawEl = document.getElementById("draw-count-first");
    const everyDrawEl = document.getElementById("draw-count-every");
    if (firstDrawEl) game.drawSettings.firstTurnCount = parseInt(firstDrawEl.value) || 1;
    if (everyDrawEl) game.drawSettings.everyTurnCount = parseInt(everyDrawEl.value) || 1;

    const success = game.initRound(rawPlayerList);
    if (success) {
        document.getElementById("start-game-btn").style.display = "none";
        document.getElementById("next-round-btn").style.display = "none";
        
        const settingsArea = document.getElementById("host-card-settings-area");
        if (settingsArea) settingsArea.style.display = "none";

        broadcastState();
        updateUI();
        
        game.startTurn();
    }
}

export function hostNextRound() {
    if (!isHost) return;
    hostStartGame();
}

export function hostAbortGame() {
    if (!isHost) return;
    if (!confirm("現在のゲームを勝敗なしで終了し、待機室に戻しますか？")) return;

    game.isGameStarted = false;
    game.deck = [];
    game.players.forEach(p => { 
        p.hand = []; 
        p.alive = !p.spectator; 
        p.history = []; 
        p.protected = false; 
    });
    game.log("⚠️ ホストによって現在のゲームが強制終了されました(勝敗なし)。");
    
    broadcastState();
    updateUI();
}

// 設定画面の生成 (ホスト用)
export function injectCustomSettingsUIIntoGame() {
    const gameContainer = document.getElementById("game-container");
    const targetNode = document.getElementById("log-box");
    if (!gameContainer || !targetNode) return;
    if (document.getElementById("host-card-settings-area")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "custom-card-settings";
    wrapper.id = "host-card-settings-area";
    
    let htmlContent = `<h3>🃏 カスタムゲーム設定（ホスト専用）</h3>`;
    for (const [val, config] of Object.entries(game.cardSettings)) {
        htmlContent += `
            <div class="setting-item">
                <span class="setting-card-info">強さ${val}: ${config.name}</span>
                <div class="setting-input-wrapper">
                    <input type="number" id="card-count-${val}" value="${config.count}" min="0" max="10" id-data="${val}" class="host-count-input"> 枚
                </div>
            </div>
        `;
    }

    htmlContent += `
        <h4 style="margin: 15px 0 5px 0; color:#f1c40f; font-size:0.85rem; border-top:1px solid #4f5d73; padding-top:10px;">🎲 ドロー枚数設定</h4>
        <div class="setting-item">
            <span class="setting-card-info">初手の手札枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-first" value="${game.drawSettings.firstTurnCount}" min="1" max="5" class="host-draw-input" data-type="first"> 枚
            </div>
        </div>
        <div class="setting-item">
            <span class="setting-card-info">手番ごとのドロー枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-every" value="${game.drawSettings.everyTurnCount}" min="1" max="5" class="host-draw-input" data-type="every"> 枚
            </div>
        </div>
    `;

    wrapper.innerHTML = htmlContent;
    gameContainer.insertBefore(wrapper, targetNode);

    // イベントリスナーの付与
    wrapper.querySelectorAll(".host-count-input").forEach(input => {
        input.addEventListener("change", (e) => {
            const val = e.target.getAttribute("id-data");
            if (!isHost) return;
            game.updateCardCount(val, parseInt(e.target.value) || 0);
            broadcastState();
        });
    });

    wrapper.querySelectorAll(".host-draw-input").forEach(input => {
        input.addEventListener("change", (e) => {
            const type = e.target.getAttribute("data-type");
            if (!isHost) return;
            if (type === 'first') game.drawSettings.firstTurnCount = parseInt(e.target.value) || 1;
            if (type === 'every') game.drawSettings.everyTurnCount = parseInt(e.target.value) || 1;
            broadcastState();
        });
    });
}

// ゲスト用設定同期画面
export function syncGuestSettingsUI(hostCardSettings, hostDrawSettings) {
    const gameContainer = document.getElementById("game-container");
    const targetNode = document.getElementById("log-box");
    if (!gameContainer || !targetNode) return;

    let wrapper = document.getElementById("host-card-settings-area");
    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.id = "host-card-settings-area";
        gameContainer.insertBefore(wrapper, targetNode);
    }

    wrapper.className = "custom-card-settings guest-view-only";
    
    let htmlContent = `<h3>🃏 カスタムゲーム設定状況（ホストが設定中…）</h3>`;
    for (let i = 1; i <= 8; i++) {
        htmlContent += `
            <div class="setting-item">
                <span class="setting-card-info">強さ${i}: ${hostCardSettings[i].name}</span>
                <div class="setting-input-wrapper">
                    <input type="number" id="card-count-${i}" value="${hostCardSettings[i].count}" disabled> 枚
                </div>
            </div>
        `;
    }

    htmlContent += `
        <h4 style="margin: 15px 0 5px 0; color:#f1c40f; font-size:0.85rem; border-top:1px solid #4f5d73; padding-top:10px;">🎲 ドロー枚数設定</h4>
        <div class="setting-item">
            <span class="setting-card-info">初手の手札枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-first" value="${hostDrawSettings.firstTurnCount}" disabled> 枚
            </div>
        </div>
        <div class="setting-item">
            <span class="setting-card-info">手番ごとのドロー枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-every" value="${hostDrawSettings.everyTurnCount}" disabled> 枚
            </div>
        </div>
    `;

    wrapper.innerHTML = htmlContent;
}

// 中断ボタンの埋め込み
export function injectAbortButton() {
    const trackerContainer = document.getElementById("card-tracker-container");
    if (!trackerContainer) return;
    if (document.getElementById("abort-game-btn")) return;

    const abortBtn = document.createElement("button");
    abortBtn.id = "abort-game-btn";
    abortBtn.innerText = "🛑 現在のゲームを終了 (勝敗なし)";
    abortBtn.style.background = "#d35400";
    abortBtn.style.marginTop = "15px";
    abortBtn.style.display = "none"; 
    abortBtn.onclick = hostAbortGame;

    trackerContainer.appendChild(abortBtn);
}

// 待機室メンバーリスト表示
export function updatePlayerListUI() {
    const listArea = document.getElementById("player-list");
    if (!listArea) return;
    
    if (!game.isGameStarted) {
        listArea.innerHTML = "<h4>現在の参加メンバー:</h4>";
        rawPlayerList.forEach(p => {
            const isMe = p.id === myId;
            const specLabel = p.spectator ? " <span style='color:#e74c3c;'>(観戦中)</span>" : "";
            
            const pItem = document.createElement("div");
            pItem.style.cssText = "padding: 6px 0; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05);";
            
            let infoDiv = document.createElement("div");
            infoDiv.innerHTML = `・${p.name} ${isMe ? " (あなた)" : ""}${specLabel}`;
            
            let btnDiv = document.createElement("div");
            if (isHost && !isMe) {
                const kickBtn = document.createElement("button");
                kickBtn.className = "btn-danger";
                kickBtn.style.cssText = "display:inline-block; width:auto; padding:2px 6px; font-size:0.7rem; margin-right:4px;";
                kickBtn.innerText = "キック";
                kickBtn.onclick = () => hostKickPlayer(p.id);

                const transBtn = document.createElement("button");
                transBtn.className = "btn-host-transfer";
                transBtn.style.cssText = "display:inline-block; width:auto; padding:2px 6px; font-size:0.7rem;";
                transBtn.innerText = "権限譲渡";
                transBtn.onclick = () => hostTransferAuthority(p.id);

                btnDiv.appendChild(kickBtn);
                btnDiv.appendChild(transBtn);
            }

            pItem.appendChild(infoDiv);
            pItem.appendChild(btnDiv);
            listArea.appendChild(pItem);
        });
    }
}

// 画面UI全体の更新タスク
export function updateUI() {
    const me = game.players.find(p => p.id === myId);
    
    const deckCountEl = document.getElementById("deck-count");
    if (deckCountEl) deckCountEl.innerText = `山札: ${game.deck.length}枚`;
    
    const roleDisplay = document.getElementById("role-display");
    if (roleDisplay && me) {
        if (me.spectator) {
            roleDisplay.innerText = "👁️ 観戦中";
        } else {
            roleDisplay.innerText = me.alive ? (me.protected ? "🛡️ 僧侶ガード中" : "🟢 生存") : "💀 脱落";
        }
    }

    const abortBtn = document.getElementById("abort-game-btn");
    const startBtn = document.getElementById("start-game-btn");
    const nextBtn = document.getElementById("next-round-btn");
    const settingsArea = document.getElementById("host-card-settings-area");
    
    if (isHost) {
        if (!game.isGameStarted) {
            if (startBtn) startBtn.style.display = "block";
            if (nextBtn) nextBtn.style.display = (game.players.length > 0) ? "block" : "none";
            if (abortBtn) abortBtn.style.display = "none";
            if (settingsArea) settingsArea.style.display = "block";
        } else {
            if (startBtn) startBtn.style.display = "none";
            if (nextBtn) nextBtn.style.display = "none";
            if (abortBtn) abortBtn.style.display = "block"; 
        }
    } else {
        if (startBtn) startBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        if (abortBtn) abortBtn.style.display = "none";
        if (settingsArea) {
            settingsArea.style.display = !game.isGameStarted ? "block" : "none";
        }
    }

    const pList = document.getElementById("player-list");
    if (pList) {
        if (game.isGameStarted) {
            pList.innerHTML = "";
            game.players.forEach((p, idx) => {
                const isCurrentTurn = game.turnIndex === idx;
                const pItem = document.createElement("div");
                pItem.className = `player-item ${isCurrentTurn ? 'active' : ''} ${!p.alive ? 'eliminated' : ''}`;
                
                let handBacks = "";
                if (p.alive && !p.spectator) {
                    for (let i = 0; i < p.hand.length; i++) {
                        handBacks += `<span class="card-back-index-badge" style="display:inline-block; margin:2px; padding:4px 8px; background:#34495e; color:#fff; border-radius:4px; font-size:0.75rem;">[${i+1}枚目]</span>`;
                    }
                } else if (p.spectator) {
                    handBacks = "<span style='font-size:0.75rem;color:#e74c3c;'>👁️ 観戦モード</span>";
                }

                let historyHTML = "";
                p.history.forEach(hVal => {
                    historyHTML += `
                        <div class="history-card history-card-${hVal}">
                            <div>${hVal}</div>
                            <div class="h-name">${game.cardSettings[hVal] ? game.cardSettings[hVal].name : "不明"}</div>
                        </div>
                    `;
                });

                pItem.innerHTML = `
                    <div class="player-header">
                        <strong>${p.name} ${p.id === myId ? "(あなた)" : ""} ${p.spectator ? "(観戦)" : ""}</strong>
                        <span class="score-badge">🏆 ${p.score}勝</span>
                    </div>
                    <div class="enemy-hand-container" style="margin: 5px 0;">
                        <span style="font-size:0.8rem; color:#bdc3c7;">手札状態: </span>${handBacks || "<span style='font-size:0.75rem;color:#e74c3c;'>手札なし</span>"}
                    </div>
                    <div class="played-history">${historyHTML || "<span style='font-size:0.75rem;color:#7f8c8d;'>捨て札なし</span>"}</div>
                `;

                if (isHost && p.id !== myId) {
                    const ctrlDiv = document.createElement("div");
                    ctrlDiv.style.marginTop = "5px";
                    const kick = document.createElement("button");
                    kick.className = "btn-danger";
                    kick.style.cssText = "padding:2px 6px; font-size:0.65rem;";
                    kick.innerText = "キック";
                    kick.onclick = () => hostKickPlayer(p.id);
                    ctrlDiv.appendChild(kick);
                    pItem.appendChild(ctrlDiv);
                }
                pList.appendChild(pItem);
            });
        } else {
            updatePlayerListUI();
        }
    }

    const cardArea = document.getElementById("card-area");
    const handTitle = document.getElementById("hand-title");
    if (cardArea) {
        cardArea.innerHTML = "";
        if (me && me.alive && game.isGameStarted && !me.spectator) {
            if (handTitle) handTitle.style.display = "block";
            const isMyTurn = game.players[game.turnIndex] && game.players[game.turnIndex].id === myId;
            
            me.hand.forEach((cVal, idx) => {
                const cardNode = document.createElement("div");
                cardNode.className = `card card-${cVal}`;
                cardNode.innerHTML = `
                    <div class="card-num">${cVal}</div>
                    <div class="card-name">${game.cardSettings[cVal].name}</div>
                    <div class="card-tooltip">（自分の${idx+1}枚目の手札）<br>${game.cardSettings[cVal].desc}</div>
                `;
                
                if (isMyTurn) {
                    cardNode.onclick = () => selectActionTarget(cVal);
                } else {
                    cardNode.style.cursor = "not-allowed";
                    cardNode.style.opacity = "0.8";
                }
                cardArea.appendChild(cardNode);
            });
        } else {
            if (handTitle) handTitle.style.display = "none";
        }
    }

    updateTrackerUI();
}

// カウンター（トラッカー）UIの更新
export function updateTrackerUI() {
    const trackerList = document.getElementById("card-tracker-list");
    if (!trackerList) return;
    trackerList.innerHTML = "";

    const usedCounts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0 };
    game.players.forEach(p => {
        p.history.forEach(c => { if(usedCounts[c] !== undefined) usedCounts[c]++; });
    });

    for (let i = 1; i <= 8; i++) {
        const total = game.cardSettings[i]?.count || 0;
        const remaining = Math.max(0, total - usedCounts[i]);
        
        let circlesHTML = "";
        for (let r = 0; r < remaining; r++) {
            circlesHTML += `<span class="circle-active" style="margin-right:2px; font-size:1.1rem; line-height:1;">●</span>`;
        }
        for (let u = 0; u < usedCounts[i]; u++) {
            circlesHTML += `<span class="circle-used" style="margin-right:2px; opacity:0.3; font-size:1.1rem; line-height:1;">〇</span>`;
        }

        const item = document.createElement("div");
        item.className = `tracker-item card-${i} tracker-${i} ${remaining === 0 ? 'used-up' : ''}`;
        item.style.cssText = "display:flex; align-items:center; justify-content:space-between; padding:6px 10px; margin:4px 0; border-radius:4px;";

        item.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="tracker-num" style="font-weight:bold; margin-right:8px;">[${i}]</span>
                <span class="tracker-name" style="font-weight:bold;">${game.cardSettings[i]?.name || "不明"}</span>
            </div>
            <div class="tracker-circles-container" style="letter-spacing: 1px;">
                ${circlesHTML}
            </div>
        `;
        trackerList.appendChild(item);
    }
}

// --- 🎯 モーダル・ターゲット選択ロジック ---
let currentSelectedCard = null;
let currentTargetPlayerId = null;

export function selectActionTarget(cardValue) {
    currentSelectedCard = cardValue;
    const modal = document.getElementById("target-modal");
    const tButtons = document.getElementById("target-buttons");
    if (!modal || !tButtons) return;
    tButtons.innerHTML = "";

    // 対象選択が不要なカード（道化、将軍、大臣、魔王など）
    if ([2, 6, 7, 8].includes(cardValue)) {
        executeCardPlay(myId, cardValue, {});
        return;
    }

    modal.style.display = "flex";
    tButtons.innerHTML = "<h4>効果の対象プレイヤーを選択:</h4>";
    
    game.players.forEach(p => {
        if (cardValue !== 4 && p.id === myId) return; // 僧侶以外は自分自身を対象にできない
        if (!p.alive || p.spectator) return;

        const btn = document.createElement("button");
        btn.innerText = p.name + (p.protected ? " (ガード中)" : "");
        btn.style.cssText = "margin-bottom:8px; width:100%;";
        btn.onclick = () => {
            currentTargetPlayerId = p.id;
            if ([1, 3, 4].includes(cardValue) && p.hand.length > 1) {
                selectTargetHandIndex(p);
            } else {
                if (cardValue === 1) {
                    selectGuessCard(p.id, 0);
                } else {
                    executeCardPlay(myId, cardValue, { targetPlayerId: p.id, handIndex: 0 });
                    modal.style.display = "none";
                }
            }
        };
        tButtons.appendChild(btn);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "キャンセル";
    cancelBtn.style.cssText = "background: #e74c3c; margin-top:10px;";
    cancelBtn.onclick = () => { modal.style.display = "none"; };
    tButtons.appendChild(cancelBtn);
}

function selectTargetHandIndex(targetPlayer) {
    const tButtons = document.getElementById("target-buttons");
    if (!tButtons) return;
    tButtons.innerHTML = `<h4>${targetPlayer.name} の何枚目のカードを対象にしますか？</h4>`;

    for (let i = 0; i < targetPlayer.hand.length; i++) {
        const btn = document.createElement("button");
        btn.innerText = `${i + 1}枚目の手札`;
        btn.style.cssText = "margin-bottom:6px; width:100%;";
        btn.onclick = () => {
            if (currentSelectedCard === 1) {
                selectGuessCard(targetPlayer.id, i);
            } else {
                executeCardPlay(myId, currentSelectedCard, { targetPlayerId: targetPlayer.id, handIndex: i });
                document.getElementById("target-modal").style.display = "none";
            }
        };
        tButtons.appendChild(btn);
    }
}

function selectGuessCard(targetPlayerId, handIndex) {
    const tButtons = document.getElementById("target-buttons");
    if (!tButtons) return;
    tButtons.innerHTML = `<h4>${handIndex + 1}枚目のカードに対する予測を宣言:</h4>`;

    for (let i = 2; i <= 8; i++) {
        const btn = document.createElement("button");
        btn.className = `btn-secondary`;
        btn.style.cssText = "margin-bottom:5px; width:100%;";
        btn.innerText = `${i}: ${game.cardSettings[i].name}`;
        btn.onclick = () => {
            executeCardPlay(myId, currentSelectedCard, { 
                targetPlayerId: targetPlayerId, 
                guessCardValue: i,
                handIndex: handIndex 
            });
            document.getElementById("target-modal").style.display = "none";
        };
        tButtons.appendChild(btn);
    }
}

function executeCardPlay(playerId, cardValue, target) {
    if (isHost) {
        game.playCard(playerId, cardValue, target);
        broadcastState();
        updateUI();
    } else {
        safeSend(connToHost, {
            type: "ACTION",
            playerId: playerId,
            cardValue: cardValue,
            target: target
        });
    }
}

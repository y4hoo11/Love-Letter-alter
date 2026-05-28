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
    // スコアを引き継ぎつつ新ラウンド初期化
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
    // 1. 山札数の同期
    const deckCountEl = document.getElementById("deck-count");
    if (deckCountEl) {
        deckCountEl.innerText = game.isGameStarted ? `山札: ${game.deck.length}枚` : "山札: --枚";
    }

    // 2. ロール（手番）状況表示
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

    // 3. ホスト用ゲーム開始ボタンの表示制御
    const startBtn = document.getElementById("start-game-btn");
    if (startBtn && isHost && !game.isGameStarted) {
        const nextBtn = document.getElementById("next-round-btn");
        if (!nextBtn || nextBtn.style.display !== "block") {
            startBtn.style.display = "block";
        }
    }

    // 4. プレイヤーリストの描画
    renderPlayerList();

    // 5. 自分の手札エリアの描画
    renderMyHand();

    // 6. トラッカー（残数計算機）の同期描画
    renderTracker();
}

// プレイヤーリストのレンダリング
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

        // ヘッダー（名前・スコア・操作ボタン）
        const header = document.createElement("div");
        header.className = "player-header";

        const nameSpan = document.createElement("span");
        nameSpan.style.fontWeight = "bold";
        nameSpan.innerHTML = `${p.name} <span class="score-badge">${p.score || 0}勝</span> ${p.protected ? "🛡️" : ""}`;
        header.appendChild(nameSpan);

        // ホスト用管理ボタン（自分以外）
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

        // 手札枚数のインジケータ表示（ゲーム中のみ）
        if (game.isGameStarted && !p.spectator && p.alive) {
            const handContainer = document.createElement("div");
            handContainer.className = "enemy-hand-container";
            p.hand.forEach(() => {
                const cardBack = document.createElement("div");
                cardBack.className = "card-back-red";
                cardBack.style.width = "24px";
                cardBack.style.height = "34px";
                cardBack.style.border = "1px solid #fff";
                handContainer.appendChild(cardBack);
            });
            item.appendChild(handContainer);
        }

        // 捨て札履歴の描画
        if (p.history && p.history.length > 0) {
            const historyEl = document.createElement("div");
            historyEl.className = "played-history";
            p.history.forEach(val => {
                const info = game.cardSettings[val] || { name: "?" };
                const badge = document.createElement("div");
                badge.className = `history-card card-${val}`;
                badge.innerHTML = `<div>${val}</div><div class="h-name">${info.name}</div>`;
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

    me.hand.forEach(val => {
        const info = game.cardSettings[val] || { name: "??", desc: "" };
        const card = document.createElement("div");
        card.className = `card card-${val}`;
        
        card.innerHTML = `
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

// カード使用時のターゲット選択モーダル展開
function selectPlayTarget(cardValue) {
    // 対象選択が不要な効果 (4:僧侶, 7:大臣, 8:女王)
    if ([4, 7, 8].includes(cardValue)) {
        executePlayCard(cardValue, {});
        return;
    }

    const modal = document.getElementById("target-modal");
    const container = document.getElementById("target-buttons");
    if (!modal || !container) return;

    container.innerHTML = `<h4>「${game.cardSettings[cardValue].name}」の対象を選択</h4>`;

    // 生存している他プレイヤーをリストアップ
    const targets = game.players.filter(p => p.alive && !p.spectator && p.id !== window.myId);

    if (targets.length === 0) {
        // 対象が誰もいない場合は不発として自分をターゲットに設定する（ルール準拠）
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
                    // 兵士の場合はカードの予想に進む
                    selectGuessValue(cardValue, t.id);
                } else {
                    modal.style.display = "none";
                    executePlayCard(cardValue, { targetPlayerId: t.id });
                }
            };
            container.appendChild(btn);
        });
    }

    // キャンセルボタン
    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "キャンセル";
    cancelBtn.style.background = "#7f8c8d";
    cancelBtn.onclick = () => { modal.style.display = "none"; };
    container.appendChild(cancelBtn);

    modal.style.display = "flex";
}

// 兵士用：当てる数字の選択UI
function selectGuessValue(cardValue, targetPlayerId) {
    const container = document.getElementById("target-buttons");
    if (!container) return;
    container.innerHTML = `<h4>予想するカードを選択</h4>`;

    // 兵士以外の1〜8の選択肢を作成
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

// カードの実際のプレイ命令を発行
function executePlayCard(cardValue, target) {
    if (isHost) {
        game.playCard(window.myId, cardValue, target);
        broadcastState();
        updateUI();
    } else {
        // ゲストはホストへ要求アクションを送信
        const { connToHost } = require("./network-manager.js"); // 循環回避用
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

// トラッカー（残数計算機）のレンダリング
function renderTracker() {
    const listEl = document.getElementById("card-tracker-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    // プレイされて既に出た各カードの枚数をカウント
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

    for (let i = 1; i <= 8; i++) {
        const total = baseCounts[i] || 0;
        const used = usedCounts[i] || 0;
        const remain = Math.max(0, total - used);

        const item = document.createElement("div");
        item.className = `tracker-item tracker-${i}`;
        if (remain === 0 && total > 0) item.classList.add("used-up");

        let circles = "";
        for (let j = 0; j < remain; j++) circles += "●";
        for (let j = 0; j < used; j++) circles += "○";

        item.style.display = "flex";
        item.style.justify = "space-between";
        item.style.alignItems = "center";
        
        item.innerHTML = `
            <span class="tracker-name">${i}: ${game.cardSettings[i]?.name || ''} (残り${remain}枚)</span>
            <span class="tracker-circles-container">${circles}</span>
        `;
        listEl.appendChild(item);
    }
}

// ホスト用：ゲームエリアにカスタム設定UIを差し込む
export function injectCustomSettingsUIIntoGame() {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer || document.getElementById("host-custom-settings")) return;

    const div = document.createElement("div");
    div.id = "host-custom-settings";
    div.className = "custom-card-settings";
    
    let html = `<h3>⚙️ ルームカスタム設定 (ホストのみ変更可能)</h3>`;
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
    
    // ログボックスの上部に挿入
    const logBox = document.getElementById("log-box");
    gameContainer.insertBefore(div, logBox);

    // インプット値変更のイベント検知
    for (let i = 1; i <= 8; i++) {
        document.getElementById(`cfg-count-${i}`)?.addEventListener("change", (e) => {
            const newVal = parseInt(e.target.value) || 0;
            game.cardSettings[i].count = newVal;
            broadcastState();
            updateUI();
        });
    }
}

// ゲスト用：ホストの設定を画面に同期反映（書き換え不可スタイル）
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

    let html = `<h3>📋 現在のルームカード構成設定</h3>`;
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

// ホスト用：ゲーム強制中断ボタンの生成
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
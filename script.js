/**
 * アークライト公式『ラブレター』ルール準拠
 * オンライン P2P対応（人数無制限・ドロー枚数＆カード枚数カスタム同期機能搭載）
 * 全員が最初の番に「最初のドロー枚数」を引くようにロジックを修正
 */

// --- ⚙️ ゲームシステム・データ管理クラス ---
class LoveLetterCustomGame {
    constructor() {
        // デフォルトのカード設定（アークライト公式準拠）
        this.cardSettings = {
            1: { name: "兵士", value: 1, count: 5, desc: "他プレイヤー1人の手札を予測（兵士以外）。的中すれば脱落。" },
            2: { name: "僧侶", value: 2, count: 2, desc: "次の自分の手番まで、自分へのカード効果を無効化する。" },
            3: { name: "騎士", value: 3, count: 2, desc: "他プレイヤー1人と手札を比較。数字が小さい方が脱落。" },
            4: { name: "魔術師", value: 4, count: 2, desc: "自分含む1人を指名。手札を捨てさせ山札から1枚引かせる。" },
            5: { name: "将軍", value: 5, count: 2, desc: "他プレイヤー1人を指名し、お互いの手札を交換する。" },
            6: { name: "大臣", value: 6, count: 1, desc: "手札に入った時点で、もう1枚との合計が12以上なら即脱落。" },
            7: { name: "公爵", value: 7, count: 1, desc: "効果なし。ただし、4(魔術師)か5(将軍)と同時に持つと強制廃棄。" },
            8: { name: "姫", value: 8, count: 1, desc: "このカードを捨てる、または捨てさせられた場合、即脱落。" }
        };

        // ドロー枚数のカスタム設定用プロパティ
        this.drawSettings = {
            firstTurnCount: 1, // 各プレイヤーの「最初の番」に引く追加枚数
            everyTurnCount: 1  // 各プレイヤーの「2回目以降の番」に引く枚数
        };

        this.deck = [];
        this.removedCard = null; 
        this.faceUpCards = [];   
        this.players = [];       // { id, name, hand:[], alive:true, protected:false, history:[], score:0 }
        this.turnIndex = 0;
        this.isGameStarted = false;
    }

    // ホストがカード枚数を変更するための関数
    updateCardCount(cardValue, newCount) {
        if (this.isGameStarted) return false;
        if (this.cardSettings[cardValue] && newCount >= 0) {
            this.cardSettings[cardValue].count = Number(newCount);
            return true;
        }
        return false;
    }

    // ラウンド（ゲーム）の初期化
    initRound(playerList) {
        if (playerList.length < 2) {
            this.log("エラー: ゲームを開始するには2人以上のプレイヤーが必要です。");
            return false;
        }

        // デッキの再構築
        this.deck = [];
        for (const [value, config] of Object.entries(this.cardSettings)) {
            for (let i = 0; i < config.count; i++) {
                this.deck.push(Number(value));
            }
        }

        // 必要枚数のチェック
        const minRequired = playerList.length + this.drawSettings.firstTurnCount + (playerList.length < 4 ? 4 : 1);
        if (this.deck.length < minRequired) {
            this.log(`エラー: カードの総枚数(${this.deck.length}枚)が不足しています。枚数を増やしてください。`);
            return false;
        }

        this.shuffle(this.deck);

        // プレイヤー状態の初期化（スコアは維持）
        this.players = playerList.map(p => {
            const existing = this.players.find(ep => ep.id === p.id);
            return {
                id: p.id,
                name: p.name,
                hand: [],
                alive: true,
                protected: false,
                history: [],
                score: existing ? existing.score : 0,
                isFirstTurn: true // 【重要】各プレイヤーが「自分の最初の番を迎えたか」のフラグ
            };
        });

        // ルール準拠：カードの脇置き除外処理
        this.removedCard = this.deck.pop();
        this.faceUpCards = [];
        if (this.players.length < 4) {
            for (let i = 0; i < 3; i++) {
                this.faceUpCards.push(this.deck.pop());
            }
        }

        // 【修正点】ゲーム開始時は、全員に「最初のベースとなる1枚」だけを配る（ここでは余分にドローさせない）
        for (let player of this.players) {
            player.hand.push(this.deck.pop());
            this.checkChancellorBurst(player);
        }

        this.turnIndex = 0;
        this.isGameStarted = true;
        this.log("📢 ゲームが開始されました！");
        return true;
    }

    // ターン開始
    startTurn() {
        let currentPlayer = this.players[this.turnIndex];
        if (!currentPlayer.alive) {
            this.nextTurn();
            return;
        }

        currentPlayer.protected = false; // 僧侶解除

        // 【修正点】1番手も含め、全員が「自分の最初の番」になった瞬間に設定された「最初のドロー枚数」を引く
        const drawCount = currentPlayer.isFirstTurn ? this.drawSettings.firstTurnCount : this.drawSettings.everyTurnCount;
        currentPlayer.isFirstTurn = false; // 最初のターンフラグを消化

        if (this.deck.length >= drawCount) {
            // 設定された枚数分カードを引く
            for (let i = 0; i < drawCount; i++) {
                const drawnCard = this.deck.pop();
                currentPlayer.hand.push(drawnCard);
            }
            this.log(`👉 ${currentPlayer.name} の手番（${drawCount}枚ドロー / 山札残: ${this.deck.length}枚）`);

            // 大臣チェック
            if (this.checkChancellorBurst(currentPlayer)) {
                this.log(`💥 ${currentPlayer.name} は【大臣】のバースト（手札合計12以上）で脱落しました。`);
                this.checkRoundEndConditions();
                return;
            }
        } else {
            // ドロー枚数が足りない場合は山札切れでラウンド終了
            this.endRound();
            return;
        }
    }

    // カードのプレイ処理
    playCard(playerId, cardValue, target = {}) {
        let player = this.players.find(p => p.id === playerId);
        if (!player || !player.alive) return;

        const cardIdx = player.hand.indexOf(cardValue);
        if (cardIdx === -1) return;
        player.hand.splice(cardIdx, 1);
        player.history.push(cardValue);

        let targetPlayer = this.players.find(p => p.id === target.targetPlayerId);
        this.log(`📝 ${player.name} が【${this.cardSettings[cardValue].name}】をプレイ。`);

        if (targetPlayer && targetPlayer.protected && player.id !== targetPlayer.id) {
            this.log(`🛡️ ${targetPlayer.name} は僧侶に守られているため効果は無効。`);
            this.checkRoundEndConditions();
            return;
        }

        switch(cardValue) {
            case 1: // 兵士
                if (targetPlayer.hand[0] === target.guessCardValue) {
                    this.log(`🎯 的中！ ${targetPlayer.name} の手札は【${this.cardSettings[target.guessCardValue].name}】でした。`);
                    targetPlayer.alive = false;
                    this.handleDiscardEffects(targetPlayer, targetPlayer.hand[0]);
                } else {
                    this.log(`❌ ハズレ！ ${targetPlayer.name} の手札は違いました。`);
                }
                break;
            case 2: // 僧侶
                player.protected = true;
                this.log(`🔮 ${player.name} は次の手番まで守られます。`);
                break;
            case 3: // 騎士
                this.log(`⚔️ ${player.name} と ${targetPlayer.name} が騎士で手札勝負。`);
                if (player.hand[0] > targetPlayer.hand[0]) {
                    targetPlayer.alive = false;
                    this.log(`💀 ${targetPlayer.name} が敗北し脱落。`);
                    this.handleDiscardEffects(targetPlayer, targetPlayer.hand[0]);
                } else if (player.hand[0] < targetPlayer.hand[0]) {
                    player.alive = false;
                    this.log(`💀 ${player.name} が敗北し脱落。`);
                    this.handleDiscardEffects(player, player.hand[0]);
                } else {
                    this.log("🤝 引き分け！両者無事でした。");
                }
                break;
            case 4: // 魔術師
                this.log(`🪄 ${targetPlayer.name} の手札を強制廃棄。`);
                const discarded = targetPlayer.hand.pop();
                targetPlayer.history.push(discarded);
                if (discarded === 8) {
                    targetPlayer.alive = false;
                    this.log(`💀 【姫】が捨てられたため、${targetPlayer.name} は即脱落！`);
                } else {
                    if (this.deck.length > 0) {
                        targetPlayer.hand.push(this.deck.pop());
                    } else {
                        targetPlayer.hand.push(this.removedCard);
                        this.log("💡 山札が空のため、脇の裏向きカードを引き直しました。");
                    }
                    this.checkChancellorBurst(targetPlayer);
                }
                break;
            case 5: // 将軍
                this.log(`🔄 ${player.name} と ${targetPlayer.name} の手札を交換。`);
                let temp = player.hand;
                player.hand = targetPlayer.hand;
                targetPlayer.hand = temp;
                this.checkChancellorBurst(player);
                this.checkChancellorBurst(targetPlayer);
                break;
            case 6: // 大臣
            case 7: // 公爵
                break;
            case 8: // 姫
                player.alive = false;
                this.log(`💀 ${player.name} は【姫】を失い、脱落しました。`);
                break;
        }
        this.checkRoundEndConditions();
    }

    checkChancellorBurst(player) {
        if (!player.alive || player.hand.length < 2) return false;
        const totalSum = player.hand.reduce((a, b) => a + b, 0);
        if (totalSum >= 12 && player.hand.includes(6)) {
            player.alive = false;
            while(player.hand.length > 0) {
                player.history.push(player.hand.pop());
            }
            return true;
        }
        return false;
    }

    handleDiscardEffects(player, cardValue) {
        player.hand = [];
        player.history.push(cardValue);
    }

    nextTurn() {
        if (this.getAlivePlayers().length <= 1 || this.deck.length === 0) {
            this.endRound();
            return;
        }
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.startTurn();
    }

    checkRoundEndConditions() {
        if (this.getAlivePlayers().length <= 1) {
            this.endRound();
        } else {
            this.nextTurn();
        }
    }

    endRound() {
        this.log("🏁 --- ラウンド終了 ---");
        this.isGameStarted = false;
        let alivePlayers = this.getAlivePlayers();

        if (alivePlayers.length === 1) {
            alivePlayers[0].score += 1;
            this.log(`🏆 勝者: ${alivePlayers[0].name} (生き残り勝利)`);
        } else {
            this.log("⚖️ 生存者の手札比較を行います。");
            alivePlayers.forEach(p => this.log(`・${p.name}: 強さ ${p.hand[0]} (${this.cardSettings[p.hand[0]].name})`));

            let maxValue = Math.max(...alivePlayers.map(p => p.hand[0]));
            let winners = alivePlayers.filter(p => p.hand[0] === maxValue);

            if (winners.length === 1) {
                winners[0].score += 1;
                this.log(`🏆 勝者: ${winners[0].name} (カード最大値)`);
            } else {
                this.log("👔 同点のため、これまでの捨て札合計値で比較（タイブレーク）");
                let maxHistorySum = -1;
                let finalWinner = null;

                winners.forEach(w => {
                    const sum = w.history.reduce((a, b) => a + b, 0);
                    this.log(`・${w.name} の捨て札合計: ${sum}`);
                    if (sum > maxHistorySum) {
                        maxHistorySum = sum;
                        finalWinner = w;
                    }
                });
                if (finalWinner) {
                    finalWinner.score += 1;
                    this.log(`🏆 タイブレーク勝者: ${finalWinner.name}!`);
                }
            }
        }
        updateUI(); 
    }

    getAlivePlayers() { return this.players.filter(p => p.alive); }
    shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
    log(msg) {
        const lb = document.getElementById("log-box");
        if(lb) { lb.innerHTML += `<div>${msg}</div>`; lb.scrollTop = lb.scrollHeight; }
    }
}

// --- 🌐 P2P通信・ネットワーク管理ロジック ---
const game = new LoveLetterCustomGame();
let peer = null;
let myId = "";
let connections = []; 
let connToHost = null; 
let isHost = false; 
let myPlayerName = "プレイヤー";
let rawPlayerList = []; 

function generateNumericRoomId() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

window.addEventListener('load', () => {
    myId = generateNumericRoomId();
    peer = new Peer(myId, { debug: 1 });

    peer.on('open', (id) => {
        document.getElementById("my-peer-id").innerText = `あなたの部屋ID: ${id} (タップでコピー)`;
    });

    peer.on('error', (err) => {
        console.error("PeerJSエラー:", err);
        document.getElementById("my-peer-id").innerText = "部屋ID生成失敗。再読み込みしてください。";
    });

    peer.on('connection', (conn) => {
        if (!isHost) {
            conn.close();
            return;
        }
        connections.push(conn);
        conn.on('data', (data) => {
            handleReceivedData(data, conn);
        });
    });

    const oldResetBtn = document.getElementById("reset-game-btn");
    if(oldResetBtn) oldResetBtn.remove();

    injectAbortButton();
    updateTrackerUI();
});

// IDコピー機能
document.getElementById("my-peer-id").addEventListener('click', () => {
    navigator.clipboard.writeText(myId);
    alert("部屋IDをコピーしました！友達に共有してください。");
});

// HTML内の「親として部屋を作る」に対応
function beHost() {
    myPlayerName = document.getElementById("name-input").value.trim() || "ホスト";
    isHost = true; 
    rawPlayerList = [{ id: myId, name: myPlayerName }];
    
    document.getElementById("setup-container").style.display = "none";
    document.getElementById("game-container").style.display = "block";
    document.getElementById("start-game-btn").style.display = "block";
    
    injectCustomSettingsUIIntoGame();
    game.log(`🏠 部屋を作成しました（ID: ${myId}）。参加者を待っています…`);
    updatePlayerListUI();
}

// HTML内の「子として参加する」に対応
function joinRoom() {
    const targetRoomId = document.getElementById("room-id-input").value.trim();
    myPlayerName = document.getElementById("name-input").value.trim() || "ゲスト";
    
    if (targetRoomId.length !== 8 || isNaN(targetRoomId)) {
        alert("エラー: 部屋IDは数字8桁で入してください。");
        return;
    }

    game.log(`🌐 部屋 ${targetRoomId} に接続を試みています…`);
    connToHost = peer.connect(targetRoomId);

    connToHost.on('open', () => {
        isHost = false; 
        document.getElementById("setup-container").style.display = "none";
        document.getElementById("game-container").style.display = "block";
        
        game.log(`🟢 部屋 ${targetRoomId} との接続に成功しました！ゲーム開始を待っています。`);
        
        connToHost.send({ type: "JOIN", name: myPlayerName, id: myId });
    });

    connToHost.on('data', (data) => {
        handleReceivedData(data, null);
    });

    connToHost.on('close', () => {
        alert("ホストとの接続が切れました。");
        location.reload();
    });
}

// データの受送信ハンドラ
function handleReceivedData(data, conn) {
    if (isHost) {
        if (data.type === "JOIN") {
            if (!rawPlayerList.some(p => p.id === data.id)) {
                rawPlayerList.push({ id: data.id, name: data.name });
                game.log(`👥 ${data.name} が参加しました。`);
                broadcastState();
                updatePlayerListUI();
            }
        }
        if (data.type === "ACTION") {
            game.playCard(data.playerId, data.cardValue, data.target);
            broadcastState();
            updateUI();
        }
    } else {
        if (data.type === "SYNC") {
            Object.assign(game, data.gameState);
            rawPlayerList = data.rawPlayerList;
            
            syncGuestSettingsUI(data.gameState.cardSettings, data.gameState.drawSettings);
            updateUI();
        }
    }
}

// ホストから全員に現在の状況を配信
function broadcastState() {
    if (!isHost) return;
    const syncData = {
        type: "SYNC",
        gameState: {
            deck: game.deck,
            removedCard: game.removedCard,
            faceUpCards: game.faceUpCards,
            players: game.players,
            turnIndex: game.turnIndex,
            isGameStarted: game.isGameStarted,
            cardSettings: game.cardSettings,
            drawSettings: game.drawSettings 
        },
        rawPlayerList: rawPlayerList
    };
    connections.forEach(c => {
        if(c.open) c.send(syncData);
    });
}

// --- 🎮 ゲーム制御ボタン用関数 ---
function hostStartGame() {
    if (!isHost) return;
    
    // 入力値の取得（カード初期枚数）
    for (let i = 1; i <= 8; i++) {
        const inputEl = document.getElementById(`card-count-${i}`);
        if (inputEl) {
            game.updateCardCount(i, parseInt(inputEl.value) || 0);
        }
    }

    // 入力値の取得（ドロー枚数設定）
    const firstDrawEl = document.getElementById("draw-count-first");
    const everyDrawEl = document.getElementById("draw-count-every");
    if(firstDrawEl) game.drawSettings.firstTurnCount = parseInt(firstDrawEl.value) || 1;
    if(everyDrawEl) game.drawSettings.everyTurnCount = parseInt(everyDrawEl.value) || 1;

    const success = game.initRound(rawPlayerList);
    if (success) {
        document.getElementById("start-game-btn").style.display = "none";
        document.getElementById("next-round-btn").style.display = "none";
        
        const settingsArea = document.getElementById("host-card-settings-area");
        if (settingsArea) settingsArea.style.display = "none";

        broadcastState();
        updateUI();
    }
}

function hostNextRound() {
    if (!isHost) return;
    hostStartGame();
}

function hostAbortGame() {
    if (!isHost) return;
    if (!confirm("現在のゲームを勝敗なしで終了し、待機室に戻しますか？")) return;

    game.isGameStarted = false;
    game.deck = [];
    game.players.forEach(p => { p.hand = []; p.alive = true; p.history = []; p.protected = false; });
    game.log("⚠️ ホストによって現在のゲームが強制終了されました(勝敗なし)。");
    
    broadcastState();
    updateUI();
}

// --- 🖥️ UI描画・DOM操作ロジック ---

function injectCustomSettingsUIIntoGame() {
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
                    <input type="number" id="card-count-${val}" value="${config.count}" min="0" max="10" onchange="onHostChangeCount(${val}, this.value)"> 枚
                </div>
            </div>
        `;
    }

    htmlContent += `
        <h4 style="margin: 15px 0 5px 0; color:#f1c40f; font-size:0.85rem; border-top:1px solid #4f5d73; padding-top:10px;">🎲 ドロー枚数設定</h4>
        <div class="setting-item">
            <span class="setting-card-info">初手（最初の番）のドロー枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-first" value="${game.drawSettings.firstTurnCount}" min="1" max="5" onchange="onHostChangeDraw('first', this.value)"> 枚
            </div>
        </div>
        <div class="setting-item">
            <span class="setting-card-info">毎ターン（2周目以降）のドロー枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-every" value="${game.drawSettings.everyTurnCount}" min="1" max="5" onchange="onHostChangeDraw('every', this.value)"> 枚
            </div>
        </div>
    `;

    wrapper.innerHTML = htmlContent;
    gameContainer.insertBefore(wrapper, targetNode);
}

function onHostChangeCount(val, value) {
    if(!isHost) return;
    game.updateCardCount(val, parseInt(value) || 0);
    broadcastState();
}

function onHostChangeDraw(type, value) {
    if(!isHost) return;
    if(type === 'first') game.drawSettings.firstTurnCount = parseInt(value) || 1;
    if(type === 'every') game.drawSettings.everyTurnCount = parseInt(value) || 1;
    broadcastState();
}

function syncGuestSettingsUI(hostCardSettings, hostDrawSettings) {
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
            <span class="setting-card-info">初手（最初の番）のドロー枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-first" value="${hostDrawSettings.firstTurnCount}" disabled> 枚
            </div>
        </div>
        <div class="setting-item">
            <span class="setting-card-info">毎ターン（2周目以降）のドロー枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-every" value="${hostDrawSettings.everyTurnCount}" disabled> 枚
            </div>
        </div>
    `;

    wrapper.innerHTML = htmlContent;
}

function injectAbortButton() {
    const trackerContainer = document.getElementById("card-tracker-container");
    if (!trackerContainer) return;
    if(document.getElementById("abort-game-btn")) return;

    const abortBtn = document.createElement("button");
    abortBtn.id = "abort-game-btn";
    abortBtn.innerText = "🛑 現在のゲームを終了 (勝敗なし)";
    abortBtn.style.background = "#d35400";
    abortBtn.style.marginTop = "15px";
    abortBtn.style.display = "none"; 
    abortBtn.onclick = hostAbortGame;

    trackerContainer.appendChild(abortBtn);
}

function updatePlayerListUI() {
    const listArea = document.getElementById("player-list");
    if (!listArea) return;
    
    if (!game.isGameStarted) {
        listArea.innerHTML = "<h4>現在の参加メンバー:</h4>";
        rawPlayerList.forEach(p => {
            listArea.innerHTML += `<div style="padding: 4px 0;">・${p.name} ${p.id === myId ? " (あなた)" : ""}</div>`;
        });
    }
}

function updateUI() {
    const me = game.players.find(p => p.id === myId);
    
    document.getElementById("deck-count").innerText = `山札: ${game.deck.length}枚`;
    
    const roleDisplay = document.getElementById("role-display");
    if (me) {
        roleDisplay.innerText = me.alive ? (me.protected ? "🛡️ 僧侶ガード中" : "🟢 生存") : "💀 脱落";
    }

    const abortBtn = document.getElementById("abort-game-btn");
    
    if (isHost) {
        if (!game.isGameStarted) {
            document.getElementById("start-game-btn").style.display = "block";
            document.getElementById("next-round-btn").style.display = (game.players.length > 0) ? "block" : "none";
            if(abortBtn) abortBtn.style.display = "none";
            
            const settingsArea = document.getElementById("host-card-settings-area");
            if (settingsArea) settingsArea.style.display = "block";
        } else {
            document.getElementById("start-game-btn").style.display = "none";
            document.getElementById("next-round-btn").style.display = "none";
            if(abortBtn) abortBtn.style.display = "block"; 
        }
    } else {
        document.getElementById("start-game-btn").style.display = "none";
        document.getElementById("next-round-btn").style.display = "none";
        if(abortBtn) abortBtn.style.display = "none";

        const settingsArea = document.getElementById("host-card-settings-area");
        if (settingsArea) {
            settingsArea.style.display = !game.isGameStarted ? "block" : "none";
        }
    }

    const pList = document.getElementById("player-list");
    
    if (game.isGameStarted) {
        pList.innerHTML = "";
        game.players.forEach((p, idx) => {
            const isCurrentTurn = game.turnIndex === idx;
            const pItem = document.createElement("div");
            pItem.className = `player-item ${isCurrentTurn ? 'active' : ''} ${!p.alive ? 'eliminated' : ''}`;
            
            let handBacks = "";
            if (p.alive) {
                for(let i=0; i<p.hand.length; i++) {
                    handBacks += `<div class="card-back"></div>`;
                }
            }

            let historyHTML = "";
            p.history.forEach(hVal => {
                historyHTML += `
                    <div class="history-card history-card-${hVal}">
                        <div>${hVal}</div>
                        <div class="h-name">${game.cardSettings[hVal].name}</div>
                    </div>
                `;
            });

            pItem.innerHTML = `
                <div class="player-header">
                    <strong>${p.name} ${p.id === myId ? "(あなた)" : ""}</strong>
                    <span class="score-badge">🏆 ${p.score}勝</span>
                </div>
                <div class="enemy-hand-container">${handBacks}</div>
                <div class="played-history">${historyHTML || "<span style='font-size:0.75rem;color:#7f8c8d;'>捨て札なし</span>"}</div>
            `;
            pList.appendChild(pItem);
        });
    } else {
        updatePlayerListUI();
    }

    const cardArea = document.getElementById("card-area");
    const handTitle = document.getElementById("hand-title");
    cardArea.innerHTML = "";
    
    if (me && me.alive && game.isGameStarted) {
        handTitle.style.display = "block";
        const isMyTurn = game.players[game.turnIndex].id === myId;
        
        me.hand.forEach(cVal => {
            const cardNode = document.createElement("div");
            cardNode.className = `card card-${cVal}`;
            cardNode.innerHTML = `
                <div class="card-num">${cVal}</div>
                <div class="card-name">${game.cardSettings[cVal].name}</div>
                <div class="card-tooltip">${game.cardSettings[cVal].desc}</div>
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
        handTitle.style.display = "none";
    }

    updateTrackerUI();
}

function updateTrackerUI() {
    const trackerList = document.getElementById("card-tracker-list");
    if (!trackerList) return;
    trackerList.innerHTML = "";

    const usedCounts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0 };
    game.players.forEach(p => {
        p.history.forEach(c => { usedCounts[c]++; });
    });

    for (let i = 1; i <= 8; i++) {
        const total = game.cardSettings[i].count;
        const remaining = Math.max(0, total - usedCounts[i]);
        
        const item = document.createElement("div");
        item.className = `tracker-item tracker-${i} ${remaining === 0 ? 'used-up' : ''}`;
        item.innerHTML = `
            <div class="tracker-num">${i}</div>
            <div class="tracker-name">${game.cardSettings[i].name}</div>
            <div class="tracker-count">残 ${remaining}/${total}</div>
        `;
        trackerList.appendChild(item);
    }
}

// --- 🎯 モーダル・ターゲット選択ロジック ---
let currentSelectedCard = null;

function selectActionTarget(cardValue) {
    currentSelectedCard = cardValue;
    const modal = document.getElementById("target-modal");
    const tButtons = document.getElementById("target-buttons");
    tButtons.innerHTML = "";

    if ([2, 6, 7, 8].includes(cardValue)) {
        executeCardPlay(myId, cardValue, {});
        return;
    }

    modal.style.display = "flex";
    
    game.players.forEach(p => {
        if (cardValue !== 4 && p.id === myId) return;
        if (!p.alive) return;

        const btn = document.createElement("button");
        btn.innerText = p.name + (p.protected ? " (ガード中)" : "");
        btn.style.marginBottom = "5px";
        btn.onclick = () => {
            if (cardValue === 1) {
                selectGuessCard(p.id);
            } else {
                executeCardPlay(myId, cardValue, { targetPlayerId: p.id });
                modal.style.display = "none";
            }
        };
        tButtons.appendChild(btn);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "キャンセル";
    cancelBtn.style.background = "#e74c3c";
    cancelBtn.onclick = () => { modal.style.display = "none"; };
    tButtons.appendChild(cancelBtn);
}

function selectGuessCard(targetPlayerId) {
    const tButtons = document.getElementById("target-buttons");
    tButtons.innerHTML = "<h4>予測するカードを選択:</h4>";

    for (let i = 2; i <= 8; i++) {
        const btn = document.createElement("button");
        btn.className = `btn-secondary`;
        btn.style.marginBottom = "5px";
        btn.innerText = `${i}: ${game.cardSettings[i].name}`;
        btn.onclick = () => {
            executeCardPlay(myId, currentSelectedCard, { targetPlayerId: targetPlayerId, guessCardValue: i });
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
        connToHost.send({
            type: "ACTION",
            playerId: playerId,
            cardValue: cardValue,
            target: target
        });
    }
}

/**
 * アークライト公式『ラブレター』ルール準拠
 * オンライン P2P対応（人数無制限・カスタム同期機能搭載）
 * 【2026安定版】接続ログの可視化、Cloudflare STUN、詳細エラーハンドリング搭載
 */

// --- ⚙️ ゲームシステム・データ管理クラス ---
class LoveLetterCustomGame {
    constructor() {
        this.cardSettings = {
            1: { name: "兵士", value: 1, count: 5, desc: "他プレイヤーの指定した1枚の手札を予測（兵士以外）。的中すれば脱落。" },
            2: { name: "僧侶", value: 2, count: 2, desc: "次の自分の手番まで、自分へのカード効果を無効化する。" },
            3: { name: "騎士", value: 3, count: 2, desc: "他プレイヤー1人と手札を比較。数字が小さい方が脱落。" },
            4: { name: "魔術師", value: 4, count: 2, desc: "自分含む1人を指名。指定した1枚を捨てさせ山札から1枚引かせる。" },
            5: { name: "将軍", value: 5, count: 2, desc: "他プレイヤー1人を指名し、お互いの手札を全交換する。" },
            6: { name: "大臣", value: 6, count: 1, desc: "手札に入った時点で、もう1枚との合計が12以上なら即脱落。" },
            7: { name: "公爵", value: 7, count: 1, desc: "効果なし。ただし、4(魔術師)か5(将軍)と同時に持つと強制廃棄。" },
            8: { name: "姫", value: 8, count: 1, desc: "このカードを捨てる、または捨てさせられた場合、即脱落。" }
        };

        this.drawSettings = {
            firstTurnCount: 1, 
            everyTurnCount: 1  
        };

        this.deck = [];
        this.removedCard = null; 
        this.faceUpCards = [];   
        this.players = [];       
        this.turnIndex = 0;
        this.isGameStarted = false;
        this.logData = []; 
    }

    updateCardCount(cardValue, newCount) {
        if (this.isGameStarted) return false;
        if (this.cardSettings[cardValue] && newCount >= 0) {
            this.cardSettings[cardValue].count = Number(newCount);
            return true;
        }
        return false;
    }

    initRound(playerList) {
        const activePlayers = playerList.filter(p => !p.spectator);

        if (activePlayers.length < 2) {
            this.log("エラー: ゲームを開始するには2人以上の有効なプレイヤーが必要です(観戦者除く)。");
            return false;
        }

        this.deck = [];
        for (const [value, config] of Object.entries(this.cardSettings)) {
            for (let i = 0; i < config.count; i++) {
                this.deck.push(Number(value));
            }
        }

        const minRequired = (activePlayers.length * this.drawSettings.firstTurnCount) + this.drawSettings.everyTurnCount + (activePlayers.length < 4 ? 4 : 1);
        if (this.deck.length < minRequired) {
            this.log(`エラー: カードの総枚数(${this.deck.length}枚)が不足しています。枚数を増やしてください。`);
            return false;
        }

        this.shuffle(this.deck);

        this.players = playerList.map(p => {
            const existing = this.players.find(ep => ep.id === p.id);
            return {
                id: p.id,
                name: p.name,
                hand: [],
                alive: !p.spectator, 
                spectator: !!p.spectator,
                protected: false,
                history: [],
                score: existing ? existing.score : 0
            };
        });

        this.removedCard = this.deck.pop();
        this.faceUpCards = [];
        if (activePlayers.length < 4) {
            for (let i = 0; i < 3; i++) {
                this.faceUpCards.push(this.deck.pop());
            }
        }

        for (let player of this.players) {
            if (player.spectator) continue;
            for (let i = 0; i < this.drawSettings.firstTurnCount; i++) {
                if (this.deck.length > 0) {
                    player.hand.push(this.deck.pop());
                }
            }
            this.checkChancellorBurst(player); 
        }

        this.turnIndex = this.players.findIndex(p => p.alive && !p.spectator);
        if (this.turnIndex === -1) this.turnIndex = 0;

        this.isGameStarted = true;
        this.log("📢 ゲームが開始されました！");
        return true;
    }

    startTurn() {
        let currentPlayer = this.players[this.turnIndex];
        if (!currentPlayer || !currentPlayer.alive || currentPlayer.spectator) {
            this.nextTurn();
            return;
        }

        currentPlayer.protected = false; 
        const drawCount = this.drawSettings.everyTurnCount;

        if (this.deck.length >= drawCount) {
            for (let i = 0; i < drawCount; i++) {
                currentPlayer.hand.push(this.deck.pop());
            }
            this.log(`👉 ${currentPlayer.name} の手番（${drawCount}枚ドロー / 山札残: ${this.deck.length}枚）`);

            if (this.checkChancellorBurst(currentPlayer)) {
                this.log(`💥 ${currentPlayer.name} は【大臣】のバースト（手札合計12以上）で脱落しました。`);
                this.checkRoundEndConditions();
                return;
            }
            
            broadcastState();
            updateUI();
        } else {
            this.endRound();
            return;
        }
    }

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

        const targetHandIdx = (target.handIndex !== undefined) ? target.handIndex : 0;

        switch(cardValue) {
            case 1: 
                const targetCard = targetPlayer.hand[targetHandIdx];
                this.log(`🏹 ${player.name} は ${targetPlayer.name} の 【${targetHandIdx + 1}枚目のカード】 を狙い、予測を【${this.cardSettings[target.guessCardValue].name}】と宣言。`);
                
                if (targetCard === target.guessCardValue) {
                    this.log(`🎯 的中！ ${targetPlayer.name} の${targetHandIdx + 1}枚目の手札は【${this.cardSettings[target.guessCardValue].name}】でした。`);
                    targetPlayer.alive = false;
                    while(targetPlayer.hand.length > 0) {
                        this.handleDiscardEffects(targetPlayer, targetPlayer.hand.pop());
                    }
                } else {
                    this.log(`❌ ハズレ！ その位置のカードは違いました。`);
                }
                break;

            case 2: 
                player.protected = true;
                this.log(`🔮 ${player.name} は次の手番まで守られます。`);
                break;

            case 3: 
                const myCompareCard = player.hand[0] || cardValue; 
                const enemyCompareCard = targetPlayer.hand[targetHandIdx] || targetPlayer.hand[0];
                
                this.log(`⚔️ ${player.name} の手札と ${targetPlayer.name} の【${targetHandIdx + 1}枚目の手札】で騎士の勝負。`);
                
                if (myCompareCard > enemyCompareCard) {
                    targetPlayer.alive = false;
                    this.log(`💀 ${targetPlayer.name} が敗北し脱落。`);
                    while(targetPlayer.hand.length > 0) this.handleDiscardEffects(targetPlayer, targetPlayer.hand.pop());
                } else if (myCompareCard < enemyCompareCard) {
                    player.alive = false;
                    this.log(`💀 ${player.name} が敗北し脱落。`);
                    while(player.hand.length > 0) this.handleDiscardEffects(player, player.hand.pop());
                } else {
                    this.log("🤝 引き分け！両者無事でした。");
                }
                break;

            case 4: 
                this.log(`🪄 ${targetPlayer.name} の【${targetHandIdx + 1}枚目の手札】を強制廃棄。`);
                const discarded = targetPlayer.hand.splice(targetHandIdx, 1)[0];
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

            case 5: 
                this.log(`🔄 ${player.name} と ${targetPlayer.name} のすべての手札を丸ごと交換。`);
                let temp = player.hand;
                player.hand = targetPlayer.hand;
                targetPlayer.hand = temp;
                this.checkChancellorBurst(player);
                this.checkChancellorBurst(targetPlayer);
                break;

            case 6: 
            case 7: 
                break;

            case 8: 
                player.alive = false;
                this.log(`💀 ${player.name} は【姫】を失い、脱落しました。`);
                break;
        }
        this.checkRoundEndConditions();
    }

    checkChancellorBurst(player) {
        if (!player.alive || player.hand.length < 2 || player.spectator) return false;
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
        player.history.push(cardValue);
    }

    nextTurn() {
        const alivePlayers = this.getAlivePlayers();
        if (alivePlayers.length <= 1 || this.deck.length === 0) {
            this.endRound();
            return;
        }
        
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
        } while ((!this.players[this.turnIndex].alive || this.players[this.turnIndex].spectator) && alivePlayers.length > 0);

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
        } else if (alivePlayers.length > 1) {
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
        
        this.players.forEach(p => {
            let rawP = rawPlayerList.find(rp => rp.id === p.id);
            if (rawP && p.spectator) rawP.spectator = true;
        });

        updateUI(); 
    }

    getAlivePlayers() { return this.players.filter(p => p.alive && !p.spectator); }
    shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
    
    log(msg) {
        this.logData.push(msg);
        renderLogBox(this.logData);
    }
}

function renderLogBox(logsArray) {
    const lb = document.getElementById("log-box");
    if (lb) {
        lb.innerHTML = logsArray.map(line => `<div>${line}</div>`).join("");
        lb.scrollTop = lb.scrollHeight;
    }
}

// --- 🌐 P2P通信・ネットワーク管理ロジック ---
let game = new LoveLetterCustomGame();
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

function safeSend(conn, dataObj) {
    if (conn && conn.open) {
        try {
            conn.send(JSON.stringify(dataObj));
        } catch (e) {
            console.error("送信エラー:", e);
        }
    }
}

// 🌐 回線相性を最大まで突破するための最新パブリックICE（STUN）サーバーリスト
const globalIceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ],
    iceCandidatePoolSize: 10
};

window.addEventListener('load', () => {
    myId = generateNumericRoomId();
    
    peer = new Peer(myId, {
        debug: 3, 
        secure: true,
        config: globalIceConfig
    });

    peer.on('open', (id) => {
        document.getElementById("my-peer-id").innerText = `あなたの部屋ID: ${id} (タップでコピー)`;
    });

    peer.on('error', (err) => {
        console.error("PeerJSシステムエラー:", err);
        // 参加側がロビー画面でもエラーを把握できるようにログ表示
        if (!game.isGameStarted) {
            document.getElementById("setup-container").style.display = "block";
            document.getElementById("game-container").style.display = "block"; // ログを見せるために一時展開
        }
        
        if (err.type === 'peer-unavailable') {
            game.log(`❌ 接続失敗: 部屋ID「${document.getElementById("room-id-input").value}」が見つかりません。番号が間違っているか、ホストが部屋を閉じています。`);
        } else if (err.type === 'network') {
            game.log("❌ 接続失敗: ネットワークエラーが発生しました。お互いにWi-Fiを切ってキャリア回線（4G/5G）でお試しください。");
        } else {
            game.log(`❌ エラーが発生しました (タイプ: ${err.type})`);
        }
    });

    peer.on('connection', (conn) => {
        // 接続が確立した際の処理
        conn.on('open', () => {
            connections.push(conn);
            game.log(`🔗 プレイヤーと接続しました: ${conn.peer}`);
            // 接続した瞬間に最新の状態を同期してあげる
            broadcastState(); 
        });

        conn.on('data', (rawMsg) => {
            try {
                const data = (typeof rawMsg === "string") ? JSON.parse(rawMsg) : rawMsg;
                handleReceivedData(data, conn);
            } catch(e) { console.error("データ解析失敗:", e); }
        });

        conn.on('close', () => {
            connections = connections.filter(c => c.peer !== conn.peer);
            handlePlayerDisconnect(conn.peer);
        });
    });

    injectAbortButton();
    updateTrackerUI();
});

window.addEventListener('beforeunload', () => {
    if (isHost) {
        connections.forEach(c => safeSend(c, { type: "HOST_DISCONNECT" }));
    } else if (connToHost) {
        safeSend(connToHost, { type: "LEAVE", id: myId });
    }
});

document.getElementById("my-peer-id").addEventListener('click', () => {
    navigator.clipboard.writeText(myId);
    alert("部屋IDをコピーしました！友達に共有してください。");
});

function beHost() {
    myPlayerName = document.getElementById("name-input").value.trim() || "ホスト";
    isHost = true; 
    rawPlayerList = [{ id: myId, name: myPlayerName, spectator: false }];
    
    document.getElementById("setup-container").style.display = "none";
    document.getElementById("game-container").style.display = "block";
    document.getElementById("start-game-btn").style.display = "block";
    
    injectCustomSettingsUIIntoGame();
    game.log(`🏠 部屋を作成しました（ID: ${myId}）。参加者を待っています…`);
    updatePlayerListUI();
}

function joinRoom() {
    const targetRoomId = document.getElementById("room-id-input").value.trim();
    myPlayerName = document.getElementById("name-input").value.trim() || "ゲスト";
    
    if (targetRoomId.length !== 8) {
        alert("エラー: 部屋IDは数字8桁です。");
        return;
    }

    game.log(`⏳ 接続中... ID: ${targetRoomId}`);
    
    connToHost = peer.connect(targetRoomId, {
        reliable: true // 信頼性の高い通信を強制
    });

    connToHost.on('open', () => {
        game.log(`✅ 接続確立！入室シグナルを送信中…`);
        safeSend(connToHost, { type: "JOIN", name: myPlayerName, id: myId });
    });

    connToHost.on('data', (rawMsg) => {
        const data = (typeof rawMsg === "string") ? JSON.parse(rawMsg) : rawMsg;
        handleReceivedData(data, null);
    });

    connToHost.on('error', (err) => {
        game.log(`❌ 通信エラー: ${err.message}`);
    });
}

function handlePlayerDisconnect(peerId) {
    const playerIndex = rawPlayerList.findIndex(p => p.id === peerId);
    if (playerIndex === -1) return;

    const pName = rawPlayerList[playerIndex].name;

    if (!game.isGameStarted) {
        rawPlayerList[playerIndex].spectator = true;
        game.log(`⚠️ ${pName} の接続が切れました。ゲーム開始前のため観戦者扱いになります。`);
        
        connections = connections.filter(c => c.peer !== peerId);
        broadcastState();
        updatePlayerListUI();
        updateUI();
    } else {
        const inGamePlayer = game.players.find(p => p.id === peerId);
        if (inGamePlayer && inGamePlayer.alive && !inGamePlayer.spectator) {
            inGamePlayer.alive = false;
            inGamePlayer.spectator = true; 
            while(inGamePlayer.hand.length > 0) {
                game.handleDiscardEffects(inGamePlayer, inGamePlayer.hand.pop());
            }
            game.log(`💥 プレイ中の ${pName} の接続が切れたため、ペナルティで敗北（脱落）扱いとなりました。`);
            game.checkRoundEndConditions();
        }
        
        rawPlayerList[playerIndex].spectator = true;
        connections = connections.filter(c => c.peer !== peerId);
        broadcastState();
        updateUI();
    }
}

function handleReceivedData(data, conn) {
    if (isHost) {
        if (data.type === "JOIN") {
            let existing = rawPlayerList.find(p => p.id === data.id);
            if (!existing) {
                rawPlayerList.push({ id: data.id, name: data.name, spectator: false });
                game.log(`👥 ${data.name} が参加しました。`);
            } else {
                if (!game.isGameStarted) existing.spectator = false;
                game.log(`👥 ${data.name} が再接続しました。`);
            }
            broadcastState();
            updatePlayerListUI();
            updateUI();
        }
        if (data.type === "ACTION") {
            game.playCard(data.playerId, data.cardValue, data.target);
            broadcastState();
            updateUI();
        }
        if (data.type === "LEAVE") {
            game.log(`🚪 ${data.name || "プレイヤー"} が自主的に部屋を離脱しました。`);
            handlePlayerDisconnect(data.id);
            if(conn) conn.close();
        }
    } else {
        if (data.type === "SYNC") {
            // ホストからデータが同期された＝完全に同期・入室成功
            if (game.logData.length <= 2) {
                // 初回同期時のみ歓迎ログを追加
                game.log("🎉 部屋の同期が完了しました！ゲームの開始を待っています。");
            }
            if (data.logData && Array.isArray(data.logData)) {
                // 接続ログを残しつつホスト側の本番ログと結合
                const oldLogs = game.logData.filter(l => l.includes("⏳") || l.includes("🟡") || l.includes("🟢") || l.includes("✅"));
                game.logData = [...oldLogs, ...data.logData];
                renderLogBox(game.logData);
            }
            Object.assign(game, data.gameState);
            rawPlayerList = data.rawPlayerList;
            
            syncGuestSettingsUI(data.gameState.cardSettings, data.gameState.drawSettings);
            updateUI();
        }
        if (data.type === "KICKED") {
            alert("部屋のホストによってキックされました。");
            location.reload();
        }
        if (data.type === "HOST_DISCONNECT") {
            alert("ホストの接続が切れたため、部屋が解散されました。");
            location.reload();
        }
        if (data.type === "BE_HOST") {
            alert("👑 あなたにホスト権限が譲渡されました！");
            isHost = true;
            connToHost = null;
            
            document.getElementById("start-game-btn").style.display = game.isGameStarted ? "none" : "block";
            const oldArea = document.getElementById("host-card-settings-area");
            if(oldArea) oldArea.remove();
            injectCustomSettingsUIIntoGame();
            
            broadcastState();
            updateUI();
        }
    }
}

function broadcastState() {
    if (!isHost) return;
    const syncData = {
        type: "SYNC",
        logData: game.logData, 
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
        safeSend(c, syncData);
    });
}

function hostKickPlayer(peerId) {
    if (!isHost) return;
    const target = rawPlayerList.find(p => p.id === peerId);
    if (!target) return;

    if (confirm(`本当に ${target.name} をキックしますか？`)) {
        game.log(`🔨 ホストが ${target.name} をキックしました。`);
        
        const conn = connections.find(c => c.peer === peerId);
        if (conn) {
            safeSend(conn, { type: "KICKED" });
            setTimeout(() => conn.close(), 200);
        }
        handlePlayerDisconnect(peerId);
        rawPlayerList = rawPlayerList.filter(p => p.id !== peerId);
        broadcastState();
        updatePlayerListUI();
        updateUI();
    }
}

function hostTransferAuthority(peerId) {
    if (!isHost) return;
    const target = rawPlayerList.find(p => p.id === peerId);
    if (!target) return;

    if (confirm(`本当に ${target.name} にホスト権限を譲渡しますか？`)) {
        const conn = connections.find(c => c.peer === peerId);
        if (conn) {
            game.log(`👑 ホスト権限が ${myPlayerName} から ${target.name} へ譲渡されました。`);
            safeSend(conn, { type: "BE_HOST" });
            
            isHost = false;
            connToHost = conn; 
            connections = [];
            
            document.getElementById("start-game-btn").style.display = "none";
            document.getElementById("next-round-btn").style.display = "none";
            const abortBtn = document.getElementById("abort-game-btn");
            if(abortBtn) abortBtn.style.display = "none";

            const settingsArea = document.getElementById("host-card-settings-area");
            if(settingsArea) settingsArea.className = "custom-card-settings guest-view-only";

            updateUI();
        }
    }
}

function leaveRoom() {
    if (confirm("本当にこの部屋から離脱しますか？")) {
        if (isHost) {
            if (confirm("あなたがホストです。離脱すると部屋全員が解散されます。よろしいですか？")) {
                connections.forEach(c => safeSend(c, { type: "HOST_DISCONNECT" }));
                setTimeout(() => location.reload(), 200);
            }
        } else {
            if (connToHost) {
                safeSend(connToHost, { type: "LEAVE", id: myId, name: myPlayerName });
                setTimeout(() => location.reload(), 200);
            }
        }
    }
}

function hostStartGame() {
    if (!isHost) return;
    
    for (let i = 1; i <= 8; i++) {
        const inputEl = document.getElementById(`card-count-${i}`);
        if (inputEl) {
            game.updateCardCount(i, parseInt(inputEl.value) || 0);
        }
    }

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
        
        game.startTurn();
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
    game.players.forEach(p => { p.hand = []; p.alive = !p.spectator; p.history = []; p.protected = false; });
    game.log("⚠️ ホストによって現在のゲームが強制終了されました(勝敗なし)。");
    
    broadcastState();
    updateUI();
}

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
            <span class="setting-card-info">初手の手札枚数</span>
            <div class="setting-input-wrapper">
                <input type="number" id="draw-count-first" value="${game.drawSettings.firstTurnCount}" min="1" max="5" onchange="onHostChangeDraw('first', this.value)"> 枚
            </div>
        </div>
        <div class="setting-item">
            <span class="setting-card-info">手番ごとのドロー枚数</span>
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
            let ctrlButtons = "";
            if (isHost && p.id !== myId) {
                ctrlButtons = `
                    <button class="btn-danger" style="display:inline-block; width:auto; padding:2px 6px; font-size:0.7rem;" onclick="hostKickPlayer('${p.id}')">キック</button>
                    <button class="btn-host-transfer" style="display:inline-block; width:auto; padding:2px 6px; font-size:0.7rem;" onclick="hostTransferAuthority('${p.id}')">権限譲渡</button>
                `;
            }
            const specLabel = p.spectator ? " <span style='color:#e74c3c;'>(観戦中)</span>" : "";
            listArea.innerHTML += `
                <div style="padding: 6px 0; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div>・${p.name} ${p.id === myId ? " (あなた)" : ""}${specLabel}</div>
                    <div>${ctrlButtons}</div>
                </div>`;
        });
    }
}

function updateUI() {
    const me = game.players.find(p => p.id === myId);
    
    document.getElementById("deck-count").innerText = `山札: ${game.deck.length}枚`;
    
    const roleDisplay = document.getElementById("role-display");
    if (me) {
        if (me.spectator) {
            roleDisplay.innerText = "👁️ 観戦中";
        } else {
            roleDisplay.innerText = me.alive ? (me.protected ? "🛡️ 僧侶ガード中" : "🟢 生存") : "💀 脱落";
        }
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
            if (p.alive && !p.spectator) {
                for(let i=0; i<p.hand.length; i++) {
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

            let ctrlButtons = "";
            if (isHost && p.id !== myId) {
                ctrlButtons = `
                    <div style="margin-top:5px;">
                        <button class="btn-danger" style="padding:2px 6px; font-size:0.65rem;" onclick="hostKickPlayer('${p.id}')">キック</button>
                    </div>
                `;
            }

            pItem.innerHTML = `
                <div class="player-header">
                    <strong>${p.name} ${p.id === myId ? "(あなた)" : ""} ${p.spectator ? "(観戦)" : ""}</strong>
                    <span class="score-badge">🏆 ${p.score}勝</span>
                </div>
                <div class="enemy-hand-container" style="margin: 5px 0;">
                    <span style="font-size:0.8rem; color:#bdc3c7;">手札状態: </span>${handBacks || "<span style='font-size:0.75rem;color:#e74c3c;'>手札なし</span>"}
                </div>
                <div class="played-history">${historyHTML || "<span style='font-size:0.75rem;color:#7f8c8d;'>捨て札なし</span>"}</div>
                ${ctrlButtons}
            `;
            pList.appendChild(pItem);
        });
    } else {
        updatePlayerListUI();
    }

    const cardArea = document.getElementById("card-area");
    const handTitle = document.getElementById("hand-title");
    cardArea.innerHTML = "";
    
    if (me && me.alive && game.isGameStarted && !me.spectator) {
        handTitle.style.display = "block";
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
        p.history.forEach(c => { if(usedCounts[c] !== undefined) usedCounts[c]++; });
    });

    for (let i = 1; i <= 8; i++) {
        const total = game.cardSettings[i].count;
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
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.padding = "6px 10px";
        item.style.margin = "4px 0";
        item.style.borderRadius = "4px";

        item.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="tracker-num" style="font-weight:bold; margin-right:8px;">[${i}]</span>
                <span class="tracker-name" style="font-weight:bold;">${game.cardSettings[i].name}</span>
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
    tButtons.innerHTML = "<h4>効果の対象プレイヤーを選択:</h4>";
    
    game.players.forEach(p => {
        if (cardValue !== 4 && p.id === myId) return;
        if (!p.alive || p.spectator) return;

        const btn = document.createElement("button");
        btn.innerText = p.name + (p.protected ? " (ガード中)" : "");
        btn.style.marginBottom = "8px";
        btn.style.width = "100%";
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
    cancelBtn.style.background = "#e74c3c";
    cancelBtn.style.marginTop = "10px";
    cancelBtn.onclick = () => { modal.style.display = "none"; };
    tButtons.appendChild(cancelBtn);
}

function selectTargetHandIndex(targetPlayer) {
    const tButtons = document.getElementById("target-buttons");
    tButtons.innerHTML = `<h4>${targetPlayer.name} の何枚目のカードを対象にしますか？</h4>`;

    for (let i = 0; i < targetPlayer.hand.length; i++) {
        const btn = document.createElement("button");
        btn.innerText = `${i + 1}枚目の手札`;
        btn.style.marginBottom = "6px";
        btn.style.width = "100%";
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
    tButtons.innerHTML = `<h4>${handIndex + 1}枚目のカードに対する予測を宣言:</h4>`;

    for (let i = 2; i <= 8; i++) {
        const btn = document.createElement("button");
        btn.className = `btn-secondary`;
        btn.style.marginBottom = "5px";
        btn.style.width = "100%";
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

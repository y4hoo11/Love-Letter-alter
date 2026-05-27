const CARD_DATA = {
    1: { name: "兵士", effect: "相手を指名し手札を予想。当たれば脱落させる" },
    2: { name: "僧侶", effect: "次の自分の手番まで効果を受けない" },
    3: { name: "騎士", effect: "相手と手札を比較し、低い方を脱落させる" },
    4: { name: "魔術師", effect: "相手の手札を捨てさせ、1枚引かせる" },
    5: { name: "将軍", effect: "相手と手札を交換する" },
    8: { name: "姫", effect: "手札から捨てると即脱落する" }
};

const CARD_COUNTS = { 1: 5, 2: 2, 3: 2, 4: 2, 5: 1, 8: 1 };
const ORIGINAL_DECK = [1,1,1,1,1, 2,2, 3,3, 4,4, 5, 8]; 
const WINNING_SCORE = 3; 

let peer = null;
let connections = []; 
let connToHost = null; 
let isHost = false;
let myId = "";
let myName = "";
let currentHostId = ""; 

let gameState = {
    started: false,
    roundOver: false, 
    matchOver: false, 
    deck: [],
    players: [], // { peerId, name, hand:[], playedCards:[], alive:true, protected:false, score:0 }
    turnIndex: 0,
    logs: [],
    hostPeerId: "" 
};

const customRoomId = String(Math.floor(10000000 + Math.random() * 90000000));

peer = new Peer(customRoomId, {
    config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] }
});

peer.on('open', (id) => {
    myId = id;
    document.getElementById('my-peer-id').innerText = `あなたの部屋ID: ${id} (タップでコピー)`;
});

peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
        alert("部屋IDがすでに使われていました。ページを再読み込みしてください。");
    } else {
        alert("通信エラーが発生しました: " + err.type);
    }
    console.error(err);
});

document.getElementById('my-peer-id').onclick = () => {
    navigator.clipboard.writeText(myId);
    alert("部屋IDをコピーしました！友達に送ってください。");
};

function beHost() {
    isHost = true;
    currentHostId = myId;
    gameState.hostPeerId = myId;
    myName = document.getElementById('name-input').value;
    gameState.players = [{ peerId: myId, name: myName, hand: [], playedCards: [], alive: true, protected: false, score: 0 }];
    
    document.getElementById('setup-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    setupHostConnectionListener();
    
    pushLog(`[部屋作成] 部屋（ID: ${myId}）を作成しました。参加者を待っています...`);
    updateUI();
}

function setupHostConnectionListener() {
    peer.on('connection', (conn) => {
        if (gameState.started) {
            setTimeout(() => { conn.send({ type: 'KICK', msg: '[システム] すでにゲームが開始されています。' }); }, 500);
            return;
        }
        connections.push(conn);
        conn.on('data', (data) => handleDataFromGuest(data, conn));
        conn.on('close', () => handleDisconnect(conn.peer));
    });
}

function joinRoom() {
    const hostId = document.getElementById('room-id-input').value.trim();
    if(!hostId) return alert("ホストの8桁の部屋IDを入力してください");
    
    const joinBtn = document.getElementById('join-btn');
    joinBtn.innerText = "接続確認中...";
    joinBtn.disabled = true;

    let isConnectedSuccessfully = false;
    const testConn = peer.connect(hostId);
    
    const timeout = setTimeout(() => {
        if (!isConnectedSuccessfully) {
            testConn.close();
            alert("[エラー] 指定された部屋はまだ開かれていないか、存在しません。\nホストが「部屋を作る」を押したことを確認してください。");
            joinBtn.innerText = "子（ゲスト）として参加する";
            joinBtn.disabled = false;
        }
    }, 3000);

    testConn.on('open', () => {
        isConnectedSuccessfully = true;
        clearTimeout(timeout);
        testConn.close(); 
        
        myName = document.getElementById('name-input').value;
        currentHostId = hostId;
        connectToHostId(hostId);
        
        joinBtn.innerText = "子（ゲスト）として参加する";
        joinBtn.disabled = false;
    });

    testConn.on('error', (err) => {
        clearTimeout(timeout);
        alert("[エラー] 指定された部屋に接続できません。部屋IDが正しいか確認してください。");
        joinBtn.innerText = "子（ゲスト）として参加する";
        joinBtn.disabled = false;
    });
}

function connectToHostId(hostId) {
    if(connToHost) { connToHost.close(); }
    
    connToHost = peer.connect(hostId);
    
    connToHost.on('open', () => {
        document.getElementById('setup-container').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        connToHost.send({ type: 'JOIN', name: myName });
    });
    
    connToHost.on('data', (data) => {
        if (data.type === 'SYNC') {
            gameState = data.state;
            currentHostId = gameState.hostPeerId;
            if (gameState.hostPeerId === myId && !isHost) {
                becomeNewHost();
            }
            updateUI();
        }
        if (data.type === 'ALERT') alert(data.msg);
        if (data.type === 'KICK') {
            alert(data.msg || "部屋から退出させられました。");
            resetToSetup();
        }
    });

    connToHost.on('close', () => {
        setTimeout(() => {
            if (!isHost && currentHostId === gameState.hostPeerId) {
                handleHostFailure();
            }
        }, 1500);
    });
}

function becomeNewHost() {
    isHost = true;
    connToHost = null;
    pushLog(`[システム] あなたが新しいホスト（部屋の主）になりました。`);
    connections = [];
    setupHostConnectionListener();
    broadcastState();
}

function transferHost(targetPeerId, targetName) {
    if (!isHost) return;
    if (confirm(`${targetName} さんにホスト権限を渡しますか？`)) {
        pushLog(`[ホスト交代] ${myName} から ${targetName} へホスト権限が譲渡されました。`);
        gameState.hostPeerId = targetPeerId;
        
        isHost = false;
        connections = [];
        
        broadcastState();
        setTimeout(() => {
            connectToHostId(targetPeerId);
        }, 500);
    }
}

function handleHostFailure() {
    const oldHostId = gameState.hostPeerId;
    gameState.players = gameState.players.filter(p => p.peerId !== oldHostId);
    
    if (gameState.players.length === 0) {
        alert("部屋の接続が完全に切れました。");
        resetToSetup();
        return;
    }
    
    const nextHost = gameState.players[0];
    gameState.hostPeerId = nextHost.peerId;
    pushLog(`[ホスト交代] 元のホストが切断したため、${nextHost.name} が新しいホストになります。`);
    
    if (nextHost.peerId === myId) {
        becomeNewHost();
    } else {
        connectToHostId(nextHost.peerId);
    }
}

function resetToSetup() {
    isHost = false;
    gameState.started = false;
    gameState.roundOver = false;
    gameState.matchOver = false;
    gameState.players = [];
    if(connToHost) { connToHost.close(); connToHost = null; }
    connections.forEach(c => c.close());
    connections = [];
    document.getElementById('setup-container').style.display = 'block';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('role-display').innerText = "-";
}

function kickPlayer(targetPeerId, targetName) {
    if (!isHost) return;
    if (confirm(`${targetName} さんをキックしますか？`)) {
        const connIdx = connections.findIndex(c => c.peer === targetPeerId);
        if (connIdx !== -1) {
            connections[connIdx].send({ type: 'KICK', msg: 'ホストによってキックされました。' });
            connections[connIdx].close();
            connections.splice(connIdx, 1);
        }
        gameState.players = gameState.players.filter(p => p.peerId !== targetPeerId);
        pushLog(`[退室] ${targetName} がホストによってキックされました。`);
        if (gameState.started) {
            if (gameState.turnIndex >= gameState.players.length) {
                gameState.turnIndex = 0;
            }
        }
        broadcastState();
    }
}

function handleDisconnect(peerId) {
    const player = gameState.players.find(p => p.peerId === peerId);
    if (player) {
        pushLog(`[切断] ${player.name} の接続が切れました。`);
        if (gameState.started) {
            player.alive = false; 
        } else {
            gameState.players = gameState.players.filter(p => p.peerId !== peerId); 
        }
        connections = connections.filter(c => c.peer !== peerId);
        broadcastState();
    }
}

function handleDataFromGuest(data, conn) {
    if (data.type === 'JOIN') {
        if(!gameState.players.some(p => p.peerId === conn.peer)) {
            gameState.players.push({ peerId: conn.peer, name: data.name, hand: [], playedCards: [], alive: true, protected: false, score: 0 });
            pushLog(`[参加] ${data.name} が参加しました。`);
        }
        if (!connections.some(c => c.peer === conn.peer)) {
            connections.push(conn);
        }
        broadcastState();
    }
    if (data.type === 'ACTION') {
        resolveAction(data.action);
    }
}

function broadcastState() {
    if (!isHost) return;
    connections.forEach(conn => {
        if(conn.open) conn.send({ type: 'SYNC', state: gameState });
    });
    updateUI();
}

function pushLog(msg) {
    gameState.logs.push(msg);
    if(gameState.logs.length > 20) gameState.logs.shift();
}

function hostStartGame() {
    if(gameState.players.length < 2) return alert("2人以上いないと始められません！");
    gameState.players.forEach(p => p.score = 0);
    gameState.matchOver = false;
    startNewRound();
}

function startNewRound() {
    gameState.started = true;
    gameState.roundOver = false;
    gameState.deck = [...ORIGINAL_DECK].sort(() => Math.random() - 0.5);
    gameState.deck.pop(); 
    
    gameState.players.forEach(p => {
        p.hand = [gameState.deck.pop()];
        p.playedCards = []; 
        p.alive = true;
        p.protected = false;
    });
    
    gameState.turnIndex = 0;
    pushLog(`[開始] ラウンドが開始されました！(3点先取)`);
    broadcastState();
}

function hostNextRound() {
    if(!isHost || !gameState.roundOver || gameState.matchOver) return;
    startNewRound();
}

function hostResetEntireGame() {
    if(!isHost) return;
    gameState.started = false;
    gameState.roundOver = false;
    gameState.matchOver = false;
    gameState.players.forEach(p => {
        p.score = 0;
        p.hand = [];
        p.playedCards = [];
        p.alive = true;
    });
    pushLog("[リセット] ゲームが完全にリセットされました。");
    broadcastState();
}

function startTurn() {
    const alivePlayers = gameState.players.filter(p => p.alive);
    if (alivePlayers.length <= 1 || gameState.deck.length === 0) {
        endGame();
        return;
    }

    const currentPlayer = gameState.players[gameState.turnIndex];
    if (!currentPlayer.alive) {
        nextTurn();
        return;
    }

    currentPlayer.protected = false;
    currentPlayer.hand.push(gameState.deck.pop());
    broadcastState();
}

function nextTurn() {
    if (gameState.roundOver) return; 
    gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    startTurn();
}

function updateUI() {
    const logBox = document.getElementById("log-box");
    logBox.innerHTML = gameState.logs.map(l => `<div>${l}</div>`).join('');
    logBox.scrollTop = logBox.scrollHeight;

    document.getElementById("deck-count").innerText = `山札: ${gameState.deck ? gameState.deck.length : 0}枚`;

    if (isHost) {
        document.getElementById('role-display').innerText = `部屋の主 (部屋ID: ${gameState.hostPeerId || myId})`;
    } else {
        document.getElementById('role-display').innerText = `ゲスト参加中 (部屋ID: ${currentHostId})`;
    }

    const totalUsedCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 8: 0 };
    gameState.players.forEach(p => {
        if(p.playedCards) {
            p.playedCards.forEach(cNum => { totalUsedCounts[cNum]++; });
        }
    });

    const listEl = document.getElementById("player-list");
    listEl.innerHTML = "";
    
    gameState.players.forEach((p, idx) => {
        const isCurrent = idx === gameState.turnIndex && gameState.started && !gameState.roundOver;
        let statusText = p.alive ? "生存" : "脱落";
        if (p.protected) statusText += " (ガード状態)";

        const hostMark = (p.peerId === gameState.hostPeerId) ? "👑" : "";

        const item = document.createElement("div");
        item.className = `player-item ${isCurrent ? 'active' : ''} ${(!p.alive && gameState.started) ? 'eliminated' : ''}`;
        
        const header = document.createElement("div");
        header.className = "player-header";
        
        const infoSpan = document.createElement("span");
        infoSpan.innerHTML = `<strong>${hostMark}${p.name}</strong> ${p.peerId === myId ? '<span style="color:#2ecc71;">(あなた)</span>' : ''}
                              <span class="score-badge">${p.score}pt</span>
                              <span style="margin-left:10px; font-size:0.8rem; color:#bdc3c7;">[${statusText}]</span>`;
        header.appendChild(infoSpan);

        const actionBtnContainer = document.createElement("div");
        if (isHost && p.peerId !== myId) {
            const transBtn = document.createElement("button");
            transBtn.className = "btn-host-transfer";
            transBtn.innerText = "👑譲渡";
            transBtn.onclick = () => transferHost(p.peerId, p.name);
            actionBtnContainer.appendChild(transBtn);

            if(!gameState.started) {
                const kickBtn = document.createElement("button");
                kickBtn.className = "btn-danger";
                kickBtn.innerText = "キック";
                kickBtn.onclick = () => kickPlayer(p.peerId, p.name);
                actionBtnContainer.appendChild(kickBtn);
            }
        }
        header.appendChild(actionBtnContainer);
        item.appendChild(header);

        if (gameState.started && !gameState.roundOver && p.alive) {
            const handContainer = document.createElement("div");
            handContainer.className = "enemy-hand-container";
            
            const handSize = p.hand ? p.hand.length : 0;
            for(let i = 0; i < handSize; i++) {
                const cardBack = document.createElement("div");
                cardBack.className = "card-back";
                handContainer.appendChild(cardBack);
            }
            item.appendChild(handContainer);
        }

        const historyContainer = document.createElement("div");
        historyContainer.className = "played-history";
        
        if (p.playedCards && p.playedCards.length > 0) {
            p.playedCards.forEach(cNum => {
                const hCard = document.createElement("div");
                hCard.className = "history-card";
                hCard.innerHTML = `
                    <div>${cNum}</div>
                    <div class="h-name">${CARD_DATA[cNum].name}</div>
                    <div class="card-tooltip"><strong>【${CARD_DATA[cNum].name}】</strong><br>${CARD_DATA[cNum].effect}</div>
                `;
                historyContainer.appendChild(hCard);
            });
        } else {
            historyContainer.innerHTML = `<span style="font-size:0.75rem; color:#7f8c8d; padding-left:5px;">まだカードを出していません</span>`;
        }
        item.appendChild(historyContainer);

        listEl.appendChild(item);
    });

    if (isHost) {
        if (!gameState.started && !gameState.roundOver) {
            document.getElementById('start-game-btn').style.display = 'block';
            document.getElementById('next-round-btn').style.display = 'none';
            document.getElementById('reset-game-btn').style.display = 'none';
        } else if (gameState.roundOver) {
            document.getElementById('start-game-btn').style.display = 'none';
            if (gameState.matchOver) {
                document.getElementById('next-round-btn').style.display = 'none';
                document.getElementById('reset-game-btn').style.display = 'block';
            } else {
                document.getElementById('next-round-btn').style.display = 'block';
                document.getElementById('reset-game-btn').style.display = 'block';
            }
        } else {
            document.getElementById('start-game-btn').style.display = 'none';
            document.getElementById('next-round-btn').style.display = 'none';
            document.getElementById('reset-game-btn').style.display = 'none';
        }
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('next-round-btn').style.display = 'none';
        document.getElementById('reset-game-btn').style.display = 'none';
    }

    const cardArea = document.getElementById("card-area");
    cardArea.innerHTML = "";
    const me = gameState.players.find(p => p.peerId === myId);
    
    if (me && me.alive && gameState.started && !gameState.roundOver) {
        document.getElementById("hand-title").style.display = "block";
        const isMyTurn = gameState.players[gameState.turnIndex].peerId === myId;
        
        me.hand.forEach((cardNum, idx) => {
            const card = CARD_DATA[cardNum];
            const cardEl = document.createElement("div");
            cardEl.className = "card";
            cardEl.innerHTML = `
                <div class="card-num">${cardNum}</div>
                <div class="card-name">${card.name}</div>
                <div class="card-tooltip"><strong>【${card.name}】</strong><br>${card.effect}</div>
            `;
            
            if (isMyTurn) {
                cardEl.onclick = () => selectCard(idx, cardNum);
            } else {
                cardEl.style.opacity = "0.7";
                cardEl.style.cursor = "not-allowed";
            }
            cardArea.appendChild(cardEl);
        });
    } else {
        document.getElementById("hand-title").style.display = "none";
    }

    const trackerListEl = document.getElementById("card-tracker-list");
    trackerListEl.innerHTML = "";
    
    [1, 2, 3, 4, 5, 8].forEach(cNum => {
        const usedCount = totalUsedCounts[cNum];
        const maxCount = CARD_COUNTS[cNum];
        const isUsedUp = usedCount >= maxCount;

        const trackerItem = document.createElement("div");
        trackerItem.className = `tracker-item ${isUsedUp ? 'used-up' : ''}`;
        
        trackerItem.innerHTML = `
            <div class="tracker-num">${cNum}</div>
            <div class="tracker-name">${CARD_DATA[cNum].name}</div>
            <div class="tracker-count">${usedCount} / ${maxCount}</div>
            <div class="card-tooltip"><strong>${CARD_DATA[cNum].name}</strong><br>${CARD_DATA[cNum].effect}</div>
        `;
        trackerListEl.appendChild(trackerItem);
    });
}

function selectCard(handIdx, cardNum) {
    if (cardNum === 8 || cardNum === 2) { 
        sendAction({ type: 'PLAY', card: cardNum, targetId: null });
        return;
    }
    showTargetModal(cardNum);
}

function showTargetModal(cardNum) {
    const modal = document.getElementById("target-modal");
    const btnContainer = document.getElementById("target-buttons");
    btnContainer.innerHTML = "";
    
    gameState.players.forEach((p, idx) => {
        if (p.peerId !== myId && p.alive && !p.protected) {
            const btn = document.createElement("button");
            btn.innerText = p.name;
            btn.onclick = () => {
                modal.style.display = "none";
                if (cardNum === 1) {
                    guessCard(p.peerId);
                } else {
                    sendAction({ type: 'PLAY', card: cardNum, targetId: p.peerId });
                }
            };
            btnContainer.appendChild(btn);
        }
    });

    if(btnContainer.innerHTML === "") {
        const btn = document.createElement("button");
        btn.innerText = "対象なし (不発)";
        btn.onclick = () => { modal.style.display = "none"; sendAction({ type: 'PLAY', card: cardNum, targetId: null }); };
        btnContainer.appendChild(btn);
    }
    modal.style.display = "flex";
}

function guessCard(targetId) {
    const modal = document.getElementById("target-modal");
    const btnContainer = document.getElementById("target-buttons");
    btnContainer.innerHTML = "<h3>手札の数字を予想：</h3>";
    
    [2, 3, 4, 5, 8].forEach(num => {
        const btn = document.createElement("button");
        btn.innerText = `${num}: ${CARD_DATA[num].name}`;
        btn.onclick = () => {
            modal.style.display = "none";
            sendAction({ type: 'PLAY', card: 1, targetId: targetId, guess: num });
        };
        btnContainer.appendChild(btn);
    });
    modal.style.display = "flex";
}

function sendAction(action) {
    if (isHost) {
        resolveAction(action);
    } else {
        if(connToHost && connToHost.open) {
            connToHost.send({ type: 'ACTION', action: action });
        } else {
            alert("ホストとの通信が切れているため行動できません。");
        }
    }
}

function resolveAction(action) {
    if (gameState.roundOver) return;

    const attacker = gameState.players[gameState.turnIndex];
    const cardIdx = attacker.hand.indexOf(action.card);
    attacker.hand.splice(cardIdx, 1);
    
    if(!attacker.playedCards) attacker.playedCards = [];
    attacker.playedCards.push(action.card);
    
    pushLog(`[プレイ] ${attacker.name} が 【${CARD_DATA[action.card].name}】 を使用。`);

    const target = gameState.players.find(p => p.peerId === action.targetId);

    if (action.card === 8) { 
        pushLog(`[脱落] ${attacker.name} は姫を捨てたため脱落した！`);
        attacker.alive = false;
    }
    else if (action.card === 2) { 
        attacker.protected = true;
        pushLog(`[効果] ${attacker.name} は次の手番まで守られます。`);
    }
    else if (target && target.alive) {
        if (action.card === 1) { 
            pushLog(`[予想] ${attacker.name} は ${target.name} の手札を [${action.guess}] と予想。`);
            if (target.hand[0] === action.guess) {
                pushLog(`[的中] 当たり！ ${target.name} が脱落。`);
                target.alive = false;
                target.playedCards.push(target.hand[0]);
                target.hand = [];
            } else {
                pushLog("[結果] ハズレ！ 効果はありません。");
            }
        }
        else if (action.card === 3) { 
            pushLog(`[対決] ${attacker.name} と ${target.name} が騎士で対決！`);
            const p1 = attacker.hand[0];
            const p2 = target.hand[0];
            if (p1 > p2) {
                pushLog(`[結果] ${attacker.name} の勝利！ ${target.name} が脱落。`);
                target.alive = false;
                target.playedCards.push(target.hand[0]);
                target.hand = [];
            } else if (p1 < p2) {
                pushLog(`[結果] ${target.name} の勝利！ ${attacker.name} が脱落。`);
                attacker.alive = false;
                attacker.playedCards.push(attacker.hand[0]);
                attacker.hand = [];
            } else {
                pushLog("[結果] 引き分け！");
            }
        }
        else if (action.card === 4) { 
            if (target.hand.length > 0) {
                const discardedCard = target.hand[0];
                pushLog(`[効果] ${target.name} は手札【${CARD_DATA[discardedCard].name}】を捨てさせられた。`);
                target.playedCards.push(discardedCard);
                target.hand = [];
                
                if (discardedCard === 8) {
                    pushLog(`[脱落] 姫が捨てられた！ ${target.name} は脱落。`);
                    target.alive = false;
                } else {
                    if (gameState.deck.length > 0) {
                        target.hand.push(gameState.deck.pop());
                    } else {
                        pushLog(`[システム] 山札が空のため、脇に除外されていたカードを引きます。`);
                        target.hand.push(1); 
                    }
                }
            } else {
                pushLog(`[不発] ${target.name} は手札を持っていません。`);
            }
        }
        else if (action.card === 5) { 
            pushLog(`[効果] ${attacker.name} と ${target.name} の手札が交換されました。`);
            const temp = attacker.hand[0];
            attacker.hand[0] = target.hand[0];
            target.hand[0] = temp;
        }
    } else {
        if (action.targetId) pushLog("[不発] 対象が不適切、または守られていたため効果なし。");
    }

    const alivePlayers = gameState.players.filter(p => p.alive);
    if (alivePlayers.length <= 1 || gameState.deck.length === 0) {
        endGame();
    } else {
        broadcastState();
        setTimeout(nextTurn, 2000);
    }
}

function endGame() {
    gameState.roundOver = true; 
    pushLog("--- ラウンド終了 ---");
    
    let roundWinner = null;
    let maxCard = -1;

    gameState.players.forEach(p => {
        if (p.alive) {
            const card = p.hand[0] || 0;
            pushLog(`[公開] ${p.name} の手札は 【${CARD_DATA[card] ? CARD_DATA[card].name : card}】`);
            if (card > maxCard) {
                maxCard = card;
                roundWinner = p;
            }
        }
    });

    if (roundWinner) {
        roundWinner.score += 1; 
        pushLog(`[目標] ${roundWinner.name} がこのラウンドを獲得！(+1pt)`);
        
        if (roundWinner.score >= WINNING_SCORE) {
            gameState.matchOver = true;
            pushLog(`🏆🎉【最終勝者】${roundWinner.name} が 3点先取し、ゲームを制しました！！`);
        }
    } else {
        pushLog("[結果] 生存者がおらず、このラウンドは引き分けです。");
    }
    
    broadcastState();
}

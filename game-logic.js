// game-logic.js

export const game = {
    isGameStarted: false,
    deck: [],
    players: [], // { id, name, hand:[], alive, spectator, score, history:[], protected }
    turnIndex: 0,
    
    // カードの初期デフォルト設定
    cardSettings: {
        1: { name: "兵士", count: 5, desc: "相手の手札を予想する" },
        2: { name: "道化", count: 2, desc: "相手の手札を見る" },
        3: { name: "騎士", count: 2, desc: "相手と手札の強さを比べる" },
        4: { name: "僧侶", count: 2, desc: "次の自分の手番まで効果を受けない" },
        5: { name: "魔術師", count: 2, desc: "相手に手札を捨てさせてドローさせる" },
        6: { name: "将軍", count: 1, desc: "相手と手札を交換する" },
        7: { name: "大臣", count: 1, desc: "手札の合計が12以上なら脱落" },
        8: { name: "女王", count: 1, desc: "捨てたら脱落" }
    },
    
    // ドロー枚数のデフォルト設定
    drawSettings: {
        firstTurnCount: 1,
        everyTurnCount: 1
    },

    // ホストによる設定の更新
    updateCardCount(val, count) {
        if (this.cardSettings[val]) {
            this.cardSettings[val].count = count;
        }
    },

    // ラウンドの初期化
    initRound(rawPlayerList) {
        // 山札の構築
        this.deck = [];
        for (const [val, config] of Object.entries(this.cardSettings)) {
            for (let i = 0; i < config.count; i++) {
                this.deck.push(parseInt(val));
            }
        }
        
        // 山札のシャッフル
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }

        // プレイヤーの初期化
        this.players = rawPlayerList.map(p => ({
            id: p.id,
            name: p.name,
            hand: [],
            alive: !p.spectator,
            spectator: p.spectator || false,
            score: p.score || 0,
            history: [],
            protected: false
        }));

        // 参加プレイヤーが足りない場合の簡易チェック
        const activePlayers = this.players.filter(p => !p.spectator);
        if (activePlayers.length < 2) {
            this.log("⚠️ 観戦者を除くプレイヤーが2名以上必要です。");
            return false;
        }

        // 初手の配布 (設定値枚数を配る)
        for (let i = 0; i < this.drawSettings.firstTurnCount; i++) {
            activePlayers.forEach(p => {
                if (this.deck.length > 0) p.hand.push(this.deck.pop());
            });
        }

        this.isGameStarted = true;
        this.turnIndex = 0;
        this.log("🎮 ゲームが開始されました！");
        return true;
    },

    // 手番の開始
    startTurn() {
        const currentPlayer = this.players[this.turnIndex];
        if (!currentPlayer || !currentPlayer.alive) {
            this.nextTurn();
            return;
        }
        
        // 僧侶の解除
        currentPlayer.protected = false;

        // 規定枚数をドロー
        for (let i = 0; i < this.drawSettings.everyTurnCount; i++) {
            if (this.deck.length > 0) {
                currentPlayer.hand.push(this.deck.pop());
            }
        }
        this.log(`🎲 ${currentPlayer.name} のターンです。`);
    },

    // ターン変更
    nextTurn() {
        // 生存チェック、ゲーム終了判定などを経て次のプレイヤーへ
        let loopCount = 0;
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
            loopCount++;
        } while (!this.players[this.turnIndex].alive && loopCount < this.players.length);

        if (this.isGameEnded()) {
            this.endRound();
        } else {
            this.startTurn();
        }
    },

    // カードをプレイしたときの処理（ホスト側で実行）
    playCard(playerId, cardValue, target) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;

        // 手札からカードを消費し、履歴（捨て札）に追加
        const cardIdx = player.hand.indexOf(cardValue);
        if (cardIdx !== -1) {
            player.hand.splice(cardIdx, 1);
        }
        player.history.push(cardValue);

        this.log(`🃏 ${player.name} が 「${this.cardSettings[cardValue].name}」 をプレイしました。`);

        // 対象プレイヤーの取得
        const targetPlayer = target.targetPlayerId ? this.players.find(p => p.id === target.targetPlayerId) : null;

        // 僧侶ガードのチェック (対象がガード中の場合は不発、ただし自身への効果は除く)
        if (targetPlayer && targetPlayer.protected && targetPlayer.id !== player.id) {
            this.log(`🛡️ ${targetPlayer.name} は僧侶の効果で守られています！効果は発動しません。`);
            this.nextTurn();
            return;
        }

        // --- 各カードの効果ロジック ---
        switch (cardValue) {
            case 1: // 兵士
                if (targetPlayer) {
                    const idx = target.handIndex || 0;
                    const guessed = target.guessCardValue;
                    const actual = targetPlayer.hand[idx];
                    this.log(`[予想] ${player.name} は ${targetPlayer.name} の ${idx + 1}枚目の手札を 「${this.cardSettings[guessed].name}」 と予想。`);
                    if (actual === guessed) {
                        this.log(`💥 的中！ ${targetPlayer.name} は脱落しました。`);
                        targetPlayer.alive = false;
                        targetPlayer.hand = [];
                    } else {
                        this.log(`❌ ハズレ！`);
                    }
                }
                break;
            case 4: // 僧侶
                player.protected = true;
                this.log(`🛡️ ${player.name} は次の手番まで守られます。`);
                break;
            // 2, 3, 5, 6, 7, 8 などの個別ロジックもここに同様に実装可能
            default:
                this.log(`効果が処理されました。`);
                break;
        }

        this.nextTurn();
    },

    isGameEnded() {
        const alivePlayers = this.players.filter(p => p.alive && !p.spectator);
        return alivePlayers.length <= 1 || this.deck.length === 0;
    },

    endRound() {
        this.isGameStarted = false;
        this.log("🏁 ラウンドが終了しました。");
        // 勝者の割り出しやスコア加算などの処理をここに記述
    },

    log(message) {
        console.log(message);
        // UIのログボックスがある場合はそこへ追加
        const logBox = document.getElementById("log-box");
        if (logBox) {
            const p = document.createElement("p");
            p.innerText = message;
            logBox.appendChild(p);
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
};

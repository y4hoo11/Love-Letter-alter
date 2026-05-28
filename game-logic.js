// game-logic.js

export const game = {
    isGameStarted: false,
    deck: [],
    players: [], 
    turnIndex: 0,
    
    cardSettings: {
        1: { name: "兵士", count: 5, desc: "指名した相手の1枚の手札を予想。当たれば脱落。" },
        2: { name: "道化", count: 2, desc: "指名した相手の手札をこっそり見る。" },
        3: { name: "騎士", count: 2, desc: "指名した相手と手札を比較。低い方が脱落。" },
        4: { name: "僧侶", count: 2, desc: "次の自分の手番まで、他者からの効果を受けない。" },
        5: { name: "魔術師", count: 2, desc: "指名した相手の手札を強制的に捨てさせ、山札から引かせる。" },
        6: { name: "将軍", count: 1, desc: "指名した相手と自分の手札をそっくり交換する。" },
        7: { name: "大臣", count: 1, desc: "手札に加わった時点で、合計値が12以上なら即脱落。" },
        8: { name: "女王", count: 1, desc: "このカードを何らかの理由で捨て札にしたら脱落。" }
    },
    
    // 👑 カスタマイズ可能なドロー初期値
    drawSettings: {
        firstTurnCount: 1,
        everyTurnCount: 1
    },

    // ラウンドの開始処理（バリデーション機能付き）
    initRound(rawPlayerList) {
        this.deck = [];
        let totalCards = 0;

        // 設定された構成枚数からデッキを再計算
        for (const [val, config] of Object.entries(this.cardSettings)) {
            const count = Math.max(0, config.count);
            totalCards += count;
            for (let i = 0; i < count; i++) {
                this.deck.push(parseInt(val));
            }
        }
        
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

        const activePlayers = this.players.filter(p => !p.spectator);
        if (activePlayers.length < 2) {
            this.log("⚠️ プレイヤーが2名以上必要です（観戦者除く）。");
            return false;
        }

        // 🔥 【検証】開始時必要枚数 = (初手枚数 × アクティブ人数) + ターン用最低1枚
        const requiredCards = activePlayers.length * this.drawSettings.firstTurnCount;
        if (totalCards < requiredCards + 1) {
            alert(`🚫 ゲームを開始できません！\n現在のカスタム設定では、初期手札として合計 ${requiredCards} 枚必要ですが、山札の総数が ${totalCards} 枚しかありません。カード枚数を増やすか設定を調整してください。`);
            this.log(`❌ エラー: カード総数不足 (${totalCards}/${requiredCards + 1}枚)。ゲームをキャンセルしました。`);
            return false;
        }
        
        // フィッシャー〜イェーツのシャッフル
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }

        // 決定された初期枚数分配布
        for (let i = 0; i < this.drawSettings.firstTurnCount; i++) {
            activePlayers.forEach(p => {
                if (this.deck.length > 0) p.hand.push(this.deck.pop());
            });
        }

        this.isGameStarted = true;
        this.turnIndex = 0;
        this.log(`🎮 ゲーム開始! [初手: ${this.drawSettings.firstTurnCount}枚 / ターンドロー: ${this.drawSettings.everyTurnCount}枚]`);
        
        // 大臣(7)の初期バースト検証
        activePlayers.forEach(p => this.checkChancellorBurst(p));

        this.startTurn();
        return true;
    },

    // 手番開始
    startTurn() {
        if (!this.isGameStarted) return;

        const currentPlayer = this.players[this.turnIndex];
        if (!currentPlayer || !currentPlayer.alive || currentPlayer.spectator) {
            this.nextTurn();
            return;
        }
        
        currentPlayer.protected = false; 
        this.log(`🎲 ${currentPlayer.name} のターンです。`);

        // 設定された毎ターンドロー枚数分引く
        for (let i = 0; i < this.drawSettings.everyTurnCount; i++) {
            if (this.deck.length > 0) {
                const drawn = this.deck.pop();
                currentPlayer.hand.push(drawn);
                
                if (this.checkChancellorBurst(currentPlayer)) return;
            }
        }
    },

    nextTurn() {
        if (this.isGameEnded()) {
            this.endRound();
            return;
        }

        let loop = 0;
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
            loop++;
        } while ((!this.players[this.turnIndex].alive || this.players[this.turnIndex].spectator) && loop < this.players.length);

        if (this.isGameEnded()) {
            this.endRound();
        } else {
            this.startTurn();
        }
    },

    playCard(playerId, cardValue, target) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;

        const cardIdx = player.hand.indexOf(cardValue);
        if (cardIdx !== -1) player.hand.splice(cardIdx, 1);
        player.history.push(cardValue);

        this.log(`🃏 ${player.name} が「${this.cardSettings[cardValue].name}(${cardValue})」を出しました。`);

        if (cardValue === 8) {
            this.log(`💥 女王を捨てたため、${player.name} は脱落しました。`);
            this.eliminatePlayer(player);
            this.nextTurn();
            return;
        }

        const targetPlayer = target && target.targetPlayerId ? this.players.find(p => p.id === target.targetPlayerId) : null;

        if (targetPlayer && targetPlayer.protected && targetPlayer.id !== player.id) {
            this.log(`🛡️ ${targetPlayer.name} は僧侶で守られているため、効果は不発に終わりました。`);
            this.nextTurn();
            return;
        }

        switch (cardValue) {
            case 1: 
                if (targetPlayer) {
                    const guessed = parseInt(target.guessCardValue);
                    const actual = targetPlayer.hand[0]; // 簡易ルール: 1枚目を対象とする
                    this.log(`[兵士] ${targetPlayer.name} の手札を「${this.cardSettings[guessed]?.name || guessed}」と予想。`);
                    if (actual === guessed) {
                        this.log(`🎯 的中！ ${targetPlayer.name} が脱落しました。`);
                        this.eliminatePlayer(targetPlayer);
                    } else {
                        this.log(`❌ ハズレました。`);
                    }
                }
                break;

            case 2: 
                if (targetPlayer) {
                    this.log(`[道化] ${player.name} は ${targetPlayer.name} の手札を確認した。`);
                    if (window.myId === player.id) {
                        alert(`【道化の効果】\n${targetPlayer.name} の手札は [ ${targetPlayer.hand.join(", ")} ] です。`);
                    }
                }
                break;

            case 3: 
                if (targetPlayer) {
                    this.log(`[騎士] ${player.name} と ${targetPlayer.name} が手札を比較。`);
                    const myCard = player.hand[0] || 0;
                    const enemyCard = targetPlayer.hand[0] || 0;
                    if (myCard > enemyCard) {
                        this.log(`💥 ${targetPlayer.name}(${enemyCard}) の脱落。`);
                        this.eliminatePlayer(targetPlayer);
                    } else if (enemyCard > myCard) {
                        this.log(`💥 ${player.name}(${myCard}) の脱落。`);
                        this.eliminatePlayer(player);
                    } else {
                        this.log(`🤝 引き分けです。`);
                    }
                }
                break;

            case 4: 
                player.protected = true;
                this.log(`🛡️ ${player.name} は次の手番まで効果を受けません。`);
                break;

            case 5: 
                if (targetPlayer) {
                    const discarded = targetPlayer.hand.pop();
                    this.log(`[魔術師] ${targetPlayer.name} は手札「${this.cardSettings[discarded]?.name || discarded}」を捨てさせられた。`);
                    if (discarded !== undefined) targetPlayer.history.push(discarded);
                    
                    if (discarded === 8) {
                        this.log(`💥 女王が捨てられたため ${targetPlayer.name} は脱落しました。`);
                        this.eliminatePlayer(targetPlayer);
                    } else {
                        if (this.deck.length > 0) {
                            targetPlayer.hand.push(this.deck.pop());
                            this.checkChancellorBurst(targetPlayer);
                        }
                    }
                }
                break;

            case 6: 
                if (targetPlayer) {
                    this.log(`[将軍] ${player.name} と ${targetPlayer.name} の手札を交換しました。`);
                    const temp = [...player.hand];
                    player.hand = [...targetPlayer.hand];
                    targetPlayer.hand = temp;

                    this.checkChancellorBurst(player);
                    this.checkChancellorBurst(targetPlayer);
                }
                break;
        }

        this.nextTurn();
    },

    checkChancellorBurst(p) {
        if (!p.alive || p.spectator) return false;
        if (p.hand.includes(7)) {
            const sum = p.hand.reduce((a, b) => a + b, 0);
            if (sum >= 12) {
                this.log(`💥 バースト!! ${p.name} は大臣(7)を含む手札合計が ${sum} になったため即脱落。`);
                p.hand.forEach(c => p.history.push(c));
                this.eliminatePlayer(p);
                this.nextTurn();
                return true;
            }
        }
        return false;
    },

    eliminatePlayer(p) {
        p.alive = false;
        p.hand = [];
    },

    isGameEnded() {
        const alive = this.players.filter(p => p.alive && !p.spectator);
        return alive.length <= 1 || this.deck.length === 0;
    },

    endRound() {
        this.isGameStarted = false;
        this.log("🏁 ラウンドが終了しました！");

        let winners = [];
        let maxVal = -1;

        this.players.forEach(p => {
            if (p.alive && !p.spectator) {
                const maxCard = Math.max(...p.hand, 0);
                if (maxCard > maxVal) {
                    maxVal = maxCard;
                    winners = [p];
                } else if (maxCard === maxVal) {
                    winners.push(p);
                }
            }
        });

        if (winners.length > 0) {
            winners.forEach(w => {
                w.score++;
                this.log(`🏆 勝者: ${w.name} (手札強さ: ${maxVal})! [現在: ${w.score}勝]`);
            });
        } else {
            this.log("生存者がいないため引き分けです。");
        }

        const startBtn = document.getElementById("start-game-btn");
        const nextBtn = document.getElementById("next-round-btn");
        if (startBtn) startBtn.style.display = "none";
        if (nextBtn && window.isHost) nextBtn.style.display = "block";
    },

    log(message) {
        const logBox = document.getElementById("log-box");
        if (logBox) {
            const div = document.createElement("div");
            div.innerText = message;
            logBox.appendChild(div);
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
};
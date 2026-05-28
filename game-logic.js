// game-logic.js

export const game = {
    isGameStarted: false,
    deck: [],
    players: [], // { id, name, hand:[], alive, spectator, score, history:[], protected }
    turnIndex: 0,
    
    // カードの初期デフォルト設定
    cardSettings: {
        1: { name: "兵士", count: 5, desc: "指名した相手の1枚の手札を予想。当たれば脱落。" },
        2: { name: "道化", count: 2, desc: "指名した相手の指定した手札をこっそり見る。" },
        3: { name: "騎士", count: 2, desc: "指名した相手と手札を比較。低い方が脱落。" },
        4: { name: "僧侶", count: 2, desc: "次の自分の手番まで、他者からの効果を受けない。" },
        5: { name: "魔術師", count: 2, desc: "指名した相手の手札を強制的に捨てさせ、山札から引かせる。" },
        6: { name: "将軍", count: 1, desc: "指名した相手と自分の手札をそっくり交換する。" },
        7: { name: "大臣", count: 1, desc: "手札に加わった時点で、合計値が12以上なら即脱落。" },
        8: { name: "女王", count: 1, desc: "このカードを何らかの理由で捨て札にしたら脱落。" }
    },
    
    // ドロー枚数のデフォルト設定
    drawSettings: {
        firstTurnCount: 1,
        everyTurnCount: 1
    },

    updateCardCount(val, count) {
        if (this.cardSettings[val]) {
            this.cardSettings[val].count = count;
        }
    },

    // ラウンドの初期化
    initRound(rawPlayerList) {
        this.deck = [];
        let totalCards = 0;
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
            this.log("⚠️ 観戦者を除くアクティブプレイヤーが2名以上必要です。");
            return false;
        }

        // バリデーション：初期配布枚数 ＋ 最低限必要な残山札(1枚)
        const requiredInitialCards = activePlayers.length * this.drawSettings.firstTurnCount;
        if (totalCards < requiredInitialCards + 1) {
            this.log(`⚠️ 設定エラー: カード総数が${totalCards}枚しかありません。初期配布に${requiredInitialCards}枚＋山札残1枚以上が必要です。`);
            return false;
        }
        
        // 山札シャッフル (フィッシャー〜イェーツ)
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }

        // 初手配布
        for (let i = 0; i < this.drawSettings.firstTurnCount; i++) {
            activePlayers.forEach(p => {
                if (this.deck.length > 0) p.hand.push(this.deck.pop());
            });
        }

        this.isGameStarted = true;
        this.turnIndex = 0;
        this.log("🎮 カスタムラウンドが開始されました！");
        
        // 大臣(7)の初期バーストチェック
        activePlayers.forEach(p => this.checkChancellorBurst(p));

        return true;
    },

    // 手番開始
    startTurn() {
        const currentPlayer = this.players[this.turnIndex];
        if (!currentPlayer || !currentPlayer.alive || currentPlayer.spectator) {
            this.nextTurn();
            return;
        }
        
        currentPlayer.protected = false; // 僧侶解除

        this.log(`🎲 ${currentPlayer.name} のターン。`);

        // ドロー
        for (let i = 0; i < this.drawSettings.everyTurnCount; i++) {
            if (this.deck.length > 0) {
                const drawnCard = this.deck.pop();
                currentPlayer.hand.push(drawnCard);
                this.log(`📥 ${currentPlayer.name} は山札からカードを1枚引きました。`);
                
                // 大臣(7)のドロー時バーストチェック
                if (this.checkChancellorBurst(currentPlayer)) return;
            }
        }
    },

    // ターンエンド判定と移行
    nextTurn() {
        if (this.isGameEnded()) {
            this.endRound();
            return;
        }

        let loopCount = 0;
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
            loopCount++;
        } while ((!this.players[this.turnIndex].alive || this.players[this.turnIndex].spectator) && loopCount < this.players.length);

        if (this.isGameEnded()) {
            this.endRound();
        } else {
            this.startTurn();
        }
    },

    // カード効果の処理（1〜8すべての実装）
    playCard(playerId, cardValue, target) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;

        // 手札から消費
        const cardIdx = player.hand.indexOf(cardValue);
        if (cardIdx !== -1) player.hand.splice(cardIdx, 1);
        player.history.push(cardValue);

        this.log(`🃏 ${player.name} が「${this.cardSettings[cardValue].name}(${cardValue})」をプレイ。`);

        // 女王(8)を自ら捨てた場合のペナルティ脱落
        if (cardValue === 8) {
            this.log(`💥 女王を捨てたため、${player.name} は呪われて脱落しました！`);
            this.eliminatePlayer(player);
            this.nextTurn();
            return;
        }

        const targetPlayer = target.targetPlayerId ? this.players.find(p => p.id === target.targetPlayerId) : null;

        // 僧侶の防御チェック
        if (targetPlayer && targetPlayer.protected && targetPlayer.id !== player.id) {
            this.log(`🛡️ ${targetPlayer.name} には僧侶のバリアが張られている！ 効果は不発に終わりました。`);
            this.nextTurn();
            return;
        }

        // 効果分岐
        switch (cardValue) {
            case 1: // 兵士
                if (targetPlayer) {
                    const idx = target.handIndex || 0;
                    const guessed = target.guessCardValue;
                    const actual = targetPlayer.hand[idx];
                    this.log(`[兵士効果] ${targetPlayer.name} の ${idx + 1}枚目の手札を「${this.cardSettings[guessed]?.name || guessed}」と予想。`);
                    if (actual === guessed) {
                        this.log(`💥 見事的中！ ${targetPlayer.name} は脱落しました。`);
                        this.eliminatePlayer(targetPlayer);
                    } else {
                        this.log(`❌ ハズレ！ 違ったようだ。`);
                    }
                }
                break;

            case 2: // 道化
                if (targetPlayer) {
                    this.log(`[道化効果] ${player.name} は ${targetPlayer.name} の手札を覗き見した。`);
                    // 実際の相手の手札開示用ログ（本人とホストのconsoleにのみ表示、または通知システムに送る）
                    if (window.myId === player.id) {
                        alert(`【道化のぞき見結果】\n${targetPlayer.name} の手札: [ ${targetPlayer.hand.join(", ")} ]`);
                    }
                }
                break;

            case 3: // 騎士
                if (targetPlayer) {
                    this.log(`[騎士効果] ${player.name} と ${targetPlayer.name} が手札の強度を競う！`);
                    const myPower = player.hand[0] || 0; 
                    const targetPower = targetPlayer.hand[0] || 0;
                    
                    if (myPower > targetPower) {
                        this.log(`💥 勝利: ${player.name} / 脱落: ${targetPlayer.name}(手札強さ:${targetPower})`);
                        this.eliminatePlayer(targetPlayer);
                    } else if (targetPower > myPower) {
                        this.log(`💥 返り討ち！ 脱落: ${player.name}(手札強さ:${myPower})`);
                        this.eliminatePlayer(player);
                    } else {
                        this.log(`🤝 引き分け！ 両者生存。`);
                    }
                }
                break;

            case 4: // 僧侶
                player.protected = true;
                this.log(`🛡️ ${player.name} に聖なる加護。次の手番開始まで効果を無効化します。`);
                break;

            case 5: // 魔術師
                if (targetPlayer) {
                    const discarded = targetPlayer.hand.pop();
                    this.log(`[魔術師効果] ${targetPlayer.name} は手札 「${this.cardSettings[discarded]?.name || discarded}」 を強制的に捨てさせられた。`);
                    if (discarded !== undefined) targetPlayer.history.push(discarded);
                    
                    if (discarded === 8) {
                        this.log(`💥 ${targetPlayer.name} は捨てさせられた女王の呪いで脱落した！`);
                        this.eliminatePlayer(targetPlayer);
                    } else {
                        if (this.deck.length > 0) {
                            targetPlayer.hand.push(this.deck.pop());
                            this.checkChancellorBurst(targetPlayer);
                        } else {
                            this.log("山札がもうないため、ドローできません！");
                        }
                    }
                }
                break;

            case 6: // 将軍
                if (targetPlayer) {
                    this.log(`[将軍効果] ${player.name} と ${targetPlayer.name} の手札がトレードされた！`);
                    const tempHand = [...player.hand];
                    player.hand = [...targetPlayer.hand];
                    targetPlayer.hand = tempHand;
                    
                    this.checkChancellorBurst(player);
                    this.checkChancellorBurst(targetPlayer);
                }
                break;

            default:
                break;
        }

        this.nextTurn();
    },

    // 大臣(7)の合計12以上バースト処理
    checkChancellorBurst(p) {
        if (!p.alive || p.spectator) return false;
        if (p.hand.includes(7)) {
            const sum = p.hand.reduce((a, b) => a + b, 0);
            if (sum >= 12) {
                this.log(`💥 バースト!! ${p.name} は手札合計が ${sum} (大臣を含む)になったため即座に自滅脱落しました！`);
                // 手札をすべて公開捨て札へ
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
        const alivePlayers = this.players.filter(p => p.alive && !p.spectator);
        return alivePlayers.length <= 1 || this.deck.length === 0;
    },

    endRound() {
        this.isGameStarted = false;
        this.log("🏁 ラウンドが終了しました！");
        
        // 生存者のうち、最も高いカードを持っているプレイヤーの勝利
        let winners = [];
        let maxVal = -1;

        this.players.forEach(p => {
            if (p.alive && !p.spectator) {
                const highestCard = Math.max(...p.hand, 0);
                if (highestCard > maxVal) {
                    maxVal = highestCard;
                    winners = [p];
                } else if (highestCard === maxVal) {
                    winners.push(p);
                }
            }
        });

        if (winners.length > 0) {
            winners.forEach(w => {
                w.score++;
                this.log(`🏆 勝者: ${w.name} (カード強さ: ${maxVal})! 現在の勝利数: ${w.score}勝`);
            });
        } else {
            this.log("生存者がおらず、勝者なしのドローです。");
        }

        // UI側の継続用ボタンなどの出し分けを動かすため、状態リセット
        document.getElementById("start-game-btn").style.display = "none";
        const nextBtn = document.getElementById("next-round-btn");
        if (nextBtn && window.isHost) nextBtn.style.display = "block";
    },

    log(message) {
        console.log(message);
        const logBox = document.getElementById("log-box");
        if (logBox) {
            const p = document.createElement("p");
            p.style.margin = "4px 0";
            p.style.fontSize = "0.85rem";
            p.innerText = message;
            logBox.appendChild(p);
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
};
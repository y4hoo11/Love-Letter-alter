// game-logic.js

class GameLogic {
    constructor() {
        this.isGameStarted = false;
        this.deck = [];
        this.players = []; // { id, name, hand:[], alive:true, protected:false, history:[], spectator:false, score:0 }
        this.turnIndex = 0;
        this.logMessages = [];

        // 課題2解決：UI側からいつでも安全にデフォルトのテキストを引っ張れるように定義
        this.defaultCardSettings = {
            1: { name: "兵士", count: 5, desc: "自分以外のプレイヤー1人とその手札（スロット）を指定し、カードの数字を予想する。当たればそのプレイヤーは脱落する。" },
            2: { name: "魔術師", count: 2, desc: "自分以外のプレイヤー1人を指定する。そのプレイヤーの選んだ手札をのぞき見ることができる。" },
            3: { name: "僧侶", count: 2, desc: "自分以外のプレイヤー1人と手札を比較する。数字が小さい方が脱落する。" },
            4: { name: "乙女", count: 2, desc: "次の自分のターンが回ってくるまで、自分に対するカードの効果をすべて無効化（保護）する。" },
            5: { name: "高官", count: 2, desc: "自分以外のプレイヤー1人を指定する。そのプレイヤーは指定された手札を強制的に捨て、山札から1枚ドローする。" },
            6: { name: "将軍", count: 1, desc: "自分以外のプレイヤー1人を指定する。お互いの手札（選択したスロット）を交換する。" },
            7: { name: "賢者", count: 1, desc: "このカードは効果を持たない。手札にあるだけで、特定の状況下で捨てなければならない場合がある。" },
            8: { name: "女王", count: 1, desc: "このカードを捨てた（あるいは捨てさせられた）プレイヤーは、その時点で即座にゲームに敗北（脱落）する。" }
        };

        // カスタム設定用（初期値はデフォルトをコピー）
        this.cardSettings = JSON.parse(JSON.stringify(this.defaultCardSettings));

        // 課題4対応：デフォルト設定の初期値
        this.drawSettings = {
            firstTurnCount: 1, // 最初の手札枚数
            everyTurnCount: 1  // 毎ターンのドロー枚数
        };
    }

    // ログ記録
    log(msg) {
        this.logMessages.push(msg);
        console.log(`[GAME LOG] ${msg}`);
        
        // 画面のログボックスがあればリアルタイム追加
        const logBox = document.getElementById("log-box");
        if (logBox) {
            const p = document.createElement("p");
            p.innerText = msg;
            logBox.appendChild(p);
            logBox.scrollTop = logBox.scrollHeight;
        }
    }

    // ラウンド初期化 (ゲーム開始)
    initRound(rawList) {
        this.logMessages = [];
        const logBox = document.getElementById("log-box");
        if (logBox) logBox.innerHTML = "";

        // 参加プレイヤーの構築
        this.players = rawList.map(p => ({
            id: p.id,
            name: p.name,
            hand: [],
            alive: true,
            protected: false,
            history: [],
            spectator: p.spectator || false,
            score: p.score || 0
        }));

        const activePlayers = this.players.filter(p => !p.spectator);
        if (activePlayers.length < 2) {
            this.log("⚠ エラー: ゲームを開始するには、観戦者以外に2人以上のプレイヤーが必要です。");
            return false;
        }

        // デッキ（山札）の作成
        this.deck = [];
        for (let i = 1; i <= 8; i++) {
            const count = this.cardSettings[i]?.count ?? this.defaultCardSettings[i].count;
            for (let c = 0; c < count; c++) {
                this.deck.push(i);
            }
        }

        // シャッフル
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }

        // 転がし（ルール上、山札から1枚ゲーム外に除外する）
        if (this.deck.length > 0) {
            this.deck.pop();
        }

        // 課題4対応：配布枚数カスタム設定に基づき最初の手札を配る
        const initialCount = this.drawSettings.firstTurnCount || 1;
        this.log(`🎮 ゲーム開始! [初手: ${initialCount}枚 / ターンドロー: ${this.drawSettings.everyTurnCount || 1}枚]`);

        activePlayers.forEach(p => {
            for (let i = 0; i < initialCount; i++) {
                if (this.deck.length > 0) {
                    p.hand.push(this.deck.pop());
                }
            }
        });

        this.isGameStarted = true;
        // ランダムに最初のターンを決定
        this.turnIndex = this.players.findIndex(p => p.id === activePlayers[Math.floor(Math.random() * activePlayers.length)].id);
        
        // 最初のプレイヤーのドロー処理
        this.startTurn();
        return true;
    }

    // ターンの開始処理
    startTurn() {
        const p = this.players[this.turnIndex];
        if (!p || !p.alive || p.spectator) {
            this.nextTurn();
            return;
        }

        p.protected = false; // 自分のターンが来たら乙女の無敵バリア解除
        
        // 課題4対応：毎ターンのドロー枚数カスタム設定に基づいてドロー
        const drawCount = this.drawSettings.everyTurnCount || 1;
        for (let i = 0; i < drawCount; i++) {
            if (this.deck.length > 0) {
                p.hand.push(this.deck.pop());
            }
        }

        this.log(`🎲 ${p.name} のターンです。`);
    }

    // 次のターンへ
    nextTurn() {
        // 生存チェック
        const alives = this.players.filter(p => p.alive && !p.spectator);
        if (alives.length <= 1 || this.deck.length === 0) {
            this.endRound();
            return;
        }

        // 次の生存者へインデックスを回す
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
        } while (!this.players[this.turnIndex].alive || this.players[this.turnIndex].spectator);

        this.startTurn();
    }

    // カードのプレイロジック
    // target = { targetPlayerId, guessCardValue, targetCardIndex }
    playCard(playerId, cardValue, target) {
        const p = this.players.find(pl => pl.id === playerId);
        if (!p) return;

        // 手札からそのカードを1枚取り除く
        const cardIdx = p.hand.indexOf(cardValue);
        if (cardIdx !== -1) {
            p.hand.splice(cardIdx, 1);
        }
        p.history.push(cardValue);

        const cardName = this.cardSettings[cardValue]?.name || `カード${cardValue}`;
        this.log(`📢 ${p.name} が「${cardValue}: ${cardName}」を発動しました。`);

        // 女王を自分から捨てたら自爆脱落
        if (cardValue === 8) {
            p.alive = false;
            p.hand = [];
            this.log(`💥 ${p.name} は女王を自ら捨てたため、呪われて脱落しました！`);
            this.nextTurn();
            return;
        }

        // 対象プレイヤーの割り出し
        const t = this.players.find(pl => pl.id === target.targetPlayerId);
        
        // 対象が保護（乙女）されている場合は効果不発
        if (t && t.protected && cardValue !== 4) {
            this.log(`🛡️ ${t.name} は乙女の効果で守られているため、効果は発動しなかった！`);
            this.nextTurn();
            return;
        }

        // 課題6対応：相手の狙う手札スロット（指定がなければ0番目）
        const targetSlot = target.targetCardIndex !== undefined ? target.targetCardIndex : 0;

        switch (cardValue) {
            case 1: // 兵士（当てたら暗殺）
                if (t) {
                    const enemyCard = t.hand[targetSlot];
                    const guessNum = target.guessCardValue;
                    const guessName = this.cardSettings[guessNum]?.name || guessNum;
                    this.log(`⚔ ${p.name} は ${t.name} の手札(${targetSlot + 1}枚目)を「${guessNum}: ${guessName}」と予想！`);
                    
                    if (enemyCard === guessNum) {
                        t.alive = false;
                        t.history.push(...t.hand);
                        t.hand = [];
                        this.log(`🎯 見事に的中！ ${t.name} は暗殺され脱落しました。`);
                    } else {
                        this.log(`❌ 予想は外れた...`);
                    }
                }
                break;

            case 2: // 魔術師（のぞき見）
                if (t) {
                    const enemyCard = t.hand[targetSlot] || t.hand[0];
                    this.log(`🔮 ${p.name} は ${t.name} の手札(${targetSlot + 1}枚目)を魔術でのぞき見した！`);
                    
                    // 課題5解決：ホスト処理中、のぞき見した本人限定でUIにシームレス表示させる命令データを仕込む
                    p.pendingSecretView = {
                        targetName: t.name,
                        cardValue: enemyCard
                    };
                }
                break;

            case 3: // 僧侶（力比べ）
                if (t) {
                    const myCard = p.hand[0]; // 僧侶発動後の自分の残り手札
                    const enemyCard = t.hand[targetSlot] || t.hand[0];
                    this.log(`⚖ ${p.name} と ${t.name} はお互いの手札の力（数字）を比べ合っている...`);

                    if (myCard === undefined || enemyCard === undefined) break;

                    if (myCard < enemyCard) {
                        p.alive = false;
                        p.history.push(...p.hand);
                        p.hand = [];
                        this.log(`💀 力負けした ${p.name} が脱落しました。`);
                    } else if (myCard > enemyCard) {
                        t.alive = false;
                        t.history.push(...t.hand);
                        t.hand = [];
                        this.log(`💀 力負けした ${t.name} が脱落しました。`);
                    } else {
                        this.log(`🤝 お互いの数字は同じだった！引き分けです。`);
                    }
                }
                break;

            case 4: // 乙女（無敵化）
                p.protected = true;
                this.log(`🛡️ ${p.name} は聖なるバリアを張り、次のターンまで無敵状態になりました。`);
                break;

            case 5: // 高官（強制撃ち落としドロー）
                if (t) {
                    const discardedCard = t.hand[targetSlot] || t.hand.pop();
                    if (discardedCard !== undefined) {
                        // 捨てさせる
                        if (t.hand.indexOf(discardedCard) !== -1) {
                            t.hand.splice(t.hand.indexOf(discardedCard), 1);
                        }
                        t.history.push(discardedCard);
                        const discName = this.cardSettings[discardedCard]?.name || discardedCard;
                        this.log(`袋叩き！ ${t.name} は手札(${targetSlot + 1}枚目)の「${discardedCard}: ${discName}」を強制的に捨てさせられた！`);

                        // 捨てさせられたのが女王なら即脱落
                        if (discardedCard === 8) {
                            t.alive = false;
                            t.hand = [];
                            this.log(`💥 ${t.name} は捨てさせられたカードが「女王」だったため、即座に敗北した！`);
                        } else {
                            // 生きていれば山札から1枚補充
                            if (this.deck.length > 0) {
                                t.hand.push(this.deck.pop());
                                this.log(`📥 ${t.name} は新しく山札から1枚ドローしました。`);
                            }
                        }
                    }
                }
                break;

            case 6: // 将軍（手札スロット入れ替え）
                if (t) {
                    const myCard = p.hand[0];
                    const enemyCard = t.hand[targetSlot];
                    if (myCard !== undefined && enemyCard !== undefined) {
                        p.hand[0] = enemyCard;
                        t.hand[targetSlot] = myCard;
                        this.log(`🔄 将軍の命令により、 ${p.name} の手札と ${t.name} の手札(${targetSlot + 1}枚目)が極秘裏に入れ替わった！`);
                    }
                }
                break;

            case 7: // 賢者（効果なし）
                this.log(`🍃 賢者は何もせず、静かに捨て札置き場へ流れていきました。`);
                break;
        }

        this.nextTurn();
    }

    // ラウンドの終了・勝者判定（全文）
    endRound() {
        this.isGameStarted = false;
        this.log(`🏁 ラウンドが終了しました！勝敗判定を行います。`);

        // 通信同期用の生リストを参照
        const currentRawList = window.rawPlayerList || [];

        const alives = this.players.filter(p => p.alive && !p.spectator);

        if (alives.length === 1) {
            const winner = alives[0];
            winner.score++;
            // 💡 表記を「ポイント」に変更
            this.log(`🏆 🎉 勝者: ${winner.name} ！！ (生き残りのため勝利) [現在: ${winner.score}ポイント]`);

            // 通信同期用の生リスト(rawPlayerList)のスコアも連動して更新
            const rawWinner = currentRawList.find(p => p.id === winner.id);
            if (rawWinner) rawWinner.score = winner.score;

        } else if (alives.length > 1) {
            this.log(`🎴 山札が尽きたため、残ったプレイヤーの手札の強さ（合計値）で勝負します！`);
            
            let maxVal = -1;
            let winners = [];

            alives.forEach(p => {
                const totalStrength = p.hand.reduce((sum, v) => sum + v, 0);
                const handText = p.hand.join(", ");
                this.log(`👤 ${p.name} の手札: [${handText}] (合計パワー: ${totalStrength})`);

                if (totalStrength > maxVal) {
                    maxVal = totalStrength;
                    winners = [p];
                } else if (totalStrength === maxVal) {
                    winners.push(p);
                }
            });

            winners.forEach(w => {
                w.score++;
                // 💡 表記を「ポイント」に変更
                this.log(`🏆 🎉 勝者: ${w.name} ！！ (手札パワー最大の勝利) [現在: ${w.score}ポイント]`);

                // 通信同期用の生リスト(rawPlayerList)のスコアも連動して更新（複数勝利対応）
                const rawWinner = currentRawList.find(p => p.id === w.id);
                if (rawWinner) rawWinner.score = w.score;
            });
        } else {
            this.log(`🤝 全員が同時に脱落したため、このラウンドは引き分けです。`);
        }

        // ホスト用UIに「次のラウンド」ボタンを出現させるトリガー
        const nextBtn = document.getElementById("next-round-btn");
        if (nextBtn && window.isHost) {
            nextBtn.style.display = "block";
        }

        // 💡 ポイントが入った瞬間に画面のプレイヤーリストをリアルタイムで強制再描画する
        if (typeof window.updateUI === "function") {
            window.updateUI();
        } else if (typeof updateUI === "function") {
            updateUI();
        }
    }
}

export const game = new GameLogic();
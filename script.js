/**
 * アークライト公式『ラブレター』ルール準拠 
 * 人数無制限＆カード枚数カスタマイズ対応 ゲーム管理クラス
 */
class LoveLetterCustomGame {
    constructor() {
        // デフォルトのカード設定（公式ルール準拠）
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

        this.deck = [];
        this.removedCard = null; // 脇に置く裏向きの1枚
        this.faceUpCards = [];   // 2〜3人プレイ時に表向きで公開されるカード
        this.players = [];       // { id, name, hand:[], alive:true, protected:false, history:[], score:0 }
        this.turnIndex = 0;
        this.isGameStarted = false;
    }

    /**
     * ホスト用：ゲーム開始前に特定のカード枚数を変更する
     * @param {number} cardValue - 1〜8のカード番号
     * @param {number} newCount - 新しい枚数 (0以上)
     */
    updateCardCount(cardValue, newCount) {
        if (this.isGameStarted) {
            console.warn("ゲーム開始後はカード枚数を変更できません。");
            return false;
        }
        if (this.cardSettings[cardValue] && newCount >= 0) {
            this.cardSettings[cardValue].count = Number(newCount);
            return true;
        }
        return false;
    }

    /**
     * ゲーム（ラウンド）の初期化
     * @param {Array} playerList - 参加プレイヤーのリスト [{id: "xxx", name: "プレイヤーA"}]
     */
    initRound(playerList) {
        if (playerList.length < 2) {
            this.log("エラー: ゲームを開始するには2人以上のプレイヤーが必要です。");
            return false;
        }

        // 1. カスタマイズされた設定からデッキを構築
        this.deck = [];
        for (const [value, config] of Object.entries(this.cardSettings)) {
            for (let i = 0; i < config.count; i++) {
                this.deck.push(Number(value));
            }
        }

        // デッキ枚数が足りるか最低限のチェック（人数 + 脇置き分など）
        const minRequired = playerList.length + (playerList.length < 4 ? 4 : 1);
        if (this.deck.length < minRequired) {
            this.log(`エラー: カードの総枚数(${this.deck.length}枚)が足りません。設定を増やしてください。`);
            return false;
        }

        // シャッフル
        this.shuffle(this.deck);

        // 2. プレイヤーの初期化（既存のスコアは引き継ぐ）
        this.players = playerList.map(p => {
            const existing = this.players.find(ep => ep.id === p.id);
            return {
                id: p.id,
                name: p.name,
                hand: [],
                alive: true,
                protected: false,
                history: [],
                score: existing ? existing.score : 0
            };
        });

        // 3. 【公式ルール】カードを除外する処理
        // 全人数共通：山札の上から1枚を裏向きのまま脇に置く
        this.removedCard = this.deck.pop();

        // 2〜3人プレイの場合、山札から3枚を「表向き」で脇に置く（4人以上は0枚）
        this.faceUpCards = [];
        if (this.players.length < 4) {
            for (let i = 0; i < 3; i++) {
                this.faceUpCards.push(this.deck.pop());
            }
        }

        // 4. 各プレイヤーに初期手札を1枚ずつ配布
        for (let player of this.players) {
            player.hand.push(this.deck.pop());
            // 初期手札での大臣(6)バーストチェック
            this.checkChancellorBurst(player);
        }

        this.turnIndex = 0;
        this.isGameStarted = true;
        this.log("=== ラブレターが開始されました ===");
        
        this.startTurn();
        return true;
    }

    /**
     * 手番開始処理
     */
    startTurn() {
        let currentPlayer = this.players[this.turnIndex];

        // 脱落しているプレイヤーならスキップして次へ
        if (!currentPlayer.alive) {
            this.nextTurn();
            return;
        }

        // 僧侶のプロテクト効果を自分のターン開始時に解除
        currentPlayer.protected = false;

        // 山札の確認
        if (this.deck.length > 0) {
            // カードを1枚ドローして手札を2枚にする
            const drawnCard = this.deck.pop();
            currentPlayer.hand.push(drawnCard);
            this.log(`${currentPlayer.name}のターン。カードを1枚引きました。`);

            // 【大臣(6)のルール】手札2枚の合計が12以上なら即座に脱落
            if (this.checkChancellorBurst(currentPlayer)) {
                this.log(`${currentPlayer.name}は【大臣】の効果（手札合計12以上）により即座に脱落した。`);
                this.checkRoundEndConditions();
                return;
            }
        } else {
            // 山札がなくなったらラウンド終了（強さ比較へ）
            this.endRound();
            return;
        }
    }

    /**
     * カードを使用する（プレイする）処理
     * @param {string} playerId - 行動したプレイヤーID
     * @param {number} cardValue - 出したカードの数値(1~8)
     * @param {Object} target - 対象指定情報 { targetPlayerId, guessCardValue }
     */
    playCard(playerId, cardValue, target = {}) {
        let player = this.players.find(p => p.id === playerId);
        if (!player || !player.alive) return;

        // 手札からカードを消費し履歴に追加
        const cardIdx = player.hand.indexOf(cardValue);
        if (cardIdx === -1) return; // 不正な選択防止
        player.hand.splice(cardIdx, 1);
        player.history.push(cardValue);

        let targetPlayer = this.players.find(p => p.id === target.targetPlayerId);

        this.log(`${player.name}が【${this.cardSettings[cardValue].name}】を場に出した。`);

        // 対象が自分以外かつ僧侶(2)で守られている場合は効果無効化
        if (targetPlayer && targetPlayer.protected && player.id !== targetPlayer.id) {
            this.log(`${targetPlayer.name}は僧侶に守られているため、効果は不発に終わった。`);
            this.checkRoundEndConditions();
            return;
        }

        // カード固有の効果処理
        switch(cardValue) {
            case 1: // 兵士
                if (!targetPlayer || target.guessCardValue === 1) {
                    this.log("対象が不正、または兵士を予測することはできません。");
                    break;
                }
                if (targetPlayer.hand[0] === target.guessCardValue) {
                    this.log(`的中！ ${targetPlayer.name}の手札は【${this.cardSettings[target.guessCardValue].name}】だった。`);
                    targetPlayer.alive = false;
                    this.handleDiscardEffects(targetPlayer, targetPlayer.hand[0]);
                } else {
                    this.log(`ハズレ！ ${targetPlayer.name}の手札は【${this.cardSettings[target.guessCardValue].name}】ではなかった。`);
                }
                break;

            case 2: // 僧侶
                player.protected = true;
                this.log(`${player.name}は次の自分の手番まで守られる。`);
                break;

            case 3: // 騎士
                if (!targetPlayer) break;
                this.log(`${player.name}と${targetPlayer.name}が手札を比較…`);
                if (player.hand[0] > targetPlayer.hand[0]) {
                    targetPlayer.alive = false;
                    this.log(`${targetPlayer.name}が脱落した。`);
                    this.handleDiscardEffects(targetPlayer, targetPlayer.hand[0]);
                } else if (player.hand[0] < targetPlayer.hand[0]) {
                    player.alive = false;
                    this.log(`${player.name}が脱落した。`);
                    this.handleDiscardEffects(player, player.hand[0]);
                } else {
                    this.log("引き分け！両者とも生存。");
                }
                break;

            case 4: // 魔術師
                if (!targetPlayer) break;
                this.log(`${targetPlayer.name}は手札を公開して捨て、引き直す。`);
                const discarded = targetPlayer.hand.pop();
                targetPlayer.history.push(discarded);

                // 【姫(8)のルール】魔術師で姫を捨てさせられた場合も即脱落
                if (discarded === 8) {
                    targetPlayer.alive = false;
                    this.log(`【姫】が捨てられたため、${targetPlayer.name}は即座に脱落した！`);
                } else {
                    // 山札があれば引き、空なら最初に除外した裏向きのカードを引く（公式ルール準拠）
                    if (this.deck.length > 0) {
                        targetPlayer.hand.push(this.deck.pop());
                    } else {
                        targetPlayer.hand.push(this.removedCard);
                        this.log("山札が空のため、脇に置かれていた裏向きのカードを引き直した。");
                    }
                    this.checkChancellorBurst(targetPlayer);
                }
                break;

            case 5: // 将軍
                if (!targetPlayer) break;
                this.log(`${player.name}と${targetPlayer.name}の手札が交換された。`);
                let temp = player.hand;
                player.hand = targetPlayer.hand;
                targetPlayer.hand = temp;

                // 交換によってお互いに大臣バーストが起きるかチェック
                this.checkChancellorBurst(player);
                this.checkChancellorBurst(targetPlayer);
                break;

            case 6: // 大臣
                this.log("大臣が安全に場に捨てられた。");
                break;

            case 7: // 公爵
                this.log("公爵が場に捨てられた。効果はない。");
                break;

            case 8: // 姫
                player.alive = false;
                this.log(`${player.name}は自ら【姫】を捨ててしまったため、脱落した！`);
                break;
        }

        this.checkRoundEndConditions();
    }

    /**
     * 大臣のバーストチェック (手札2枚の合計値が12以上なら強制脱落)
     */
    checkChancellorBurst(player) {
        if (!player.alive || player.hand.length < 2) return false;
        const sum = player.hand[0] + player.hand[1];
        if (sum >= 12) {
            player.alive = false;
            // 手札をすべて公開履歴へ落とす
            while(player.hand.length > 0) {
                player.history.push(player.hand.pop());
            }
            return true;
        }
        return false;
    }

    /**
     * 脱落したプレイヤーの手札を履歴に安全に送る処理
     */
    handleDiscardEffects(player, cardValue) {
        player.hand = [];
        player.history.push(cardValue);
        if (cardValue === 8) {
            this.log(`${player.name}の元から【姫】が去り、完全に脱落した。`);
        }
    }

    /**
     * 次の生存プレイヤーに手番を回す
     */
    nextTurn() {
        if (this.getAlivePlayers().length <= 1 || this.deck.length === 0) {
            this.endRound();
            return;
        }
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.startTurn();
    }

    /**
     * ラウンド終了条件の確認
     */
    checkRoundEndConditions() {
        if (this.getAlivePlayers().length <= 1) {
            this.endRound();
        } else {
            this.nextTurn();
        }
    }

    /**
     * ラウンド終了と勝者判定（タイブレーク対応）
     */
    endRound() {
        this.log("--- ラウンド終了。勝敗判定を行います ---");
        this.isGameStarted = false;
        let alivePlayers = this.getAlivePlayers();

        if (alivePlayers.length === 1) {
            // 生き残りが1人の場合
            alivePlayers[0].score += 1;
            this.log(`勝者: ${alivePlayers[0].name} (生き残りによる勝利)`);
            return;
        } 

        // 山札切れによる手札の強さ（数字）比較
        this.log("生存者全員の手札を比較します。");
        alivePlayers.forEach(p => {
            this.log(`${p.name} の手札: 【${this.cardSettings[p.hand[0]].name}】(強さ:${p.hand[0]})`);
        });

        let maxValue = Math.max(...alivePlayers.map(p => p.hand[0]));
        let winners = alivePlayers.filter(p => p.hand[0] === maxValue);

        if (winners.length === 1) {
            winners[0].score += 1;
            this.log(`勝者: ${winners[0].name} (カードの強さが最上位)`);
        } else {
            // 【公式タイブレーク】数字が同じ場合、これまでに出したカードの「合計値」が大きい方が勝ち
            this.log("手札の数値が同数のため、これまでの捨て札の合計値でタイブレークを行います。");
            let maxHistorySum = -1;
            let finalWinner = null;

            winners.forEach(w => {
                const sum = w.history.reduce((a, b) => a + b, 0);
                this.log(`${w.name} の捨て札合計値: ${sum}`);
                if (sum > maxHistorySum) {
                    maxHistorySum = sum;
                    finalWinner = w;
                }
            });

            if (finalWinner) {
                finalWinner.score += 1;
                this.log(`タイブレーク勝者: ${finalWinner.name}!`);
            }
        }
    }

    getAlivePlayers() {
        return this.players.filter(p => p.alive);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    log(message) {
        console.log(message);
        // フロントエンドのログUIに反映させる場合はここにDOM操作やコールバックを追加
        const logBox = document.getElementById("log-box");
        if (logBox) {
            logBox.innerHTML += `<div>${message}</div>`;
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
}

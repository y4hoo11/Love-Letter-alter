// network-manager.js
import { game } from "./game-logic.js";
import { updateUI } from "./ui-manager.js";

export let isHost = false;
export let rawPlayerList = []; 
export let guestConnections = []; // ホスト用: 接続されたconnの配列
export let connToHost = null;     // ゲスト用: ホストへのconn

export function setIsHost(val) { 
    isHost = val; 
    if (isHost) {
        // 自分自身をrawPlayerList内でホスト扱いにマーク
        const me = rawPlayerList.find(p => p.id === window.myId);
        if (me) me.isHost = true;
    }
}
export function setRawPlayerList(list) { rawPlayerList = list; }
export function setConnections(conn) { 
    if (!guestConnections.some(c => c.peer === conn.peer)) {
        guestConnections.push(conn); 
    }
}
export function setConnToHost(conn) { connToHost = conn; }

// ホストがデータを受信した時の処理
export function handleHostReceiveData(conn, data) {
    if (!isHost) return;

    switch (data.type) {
        case "JOIN":
            // 課題8: 同一プレイヤー名の接続切れ復帰チェック
            const disconnectedPlayer = rawPlayerList.find(p => p.name === data.name && p.disconnected);
            
            if (disconnectedPlayer) {
                // 既存のアカウントデータを再利用して復帰
                disconnectedPlayer.id = data.id; // 新しいPeerIDを再マッピング
                disconnectedPlayer.disconnected = false;
                game.log(`🔄 ${data.name} の接続が復帰しました。`);

                // もしゲーム中ならゲームロジック側のプレイヤーIDも更新
                if (game.isGameStarted) {
                    const gp = game.players.find(p => p.name === data.name);
                    if (gp) gp.id = data.id;
                }
            } else {
                // 新規プレイヤーの追加
                if (!rawPlayerList.some(p => p.id === data.id)) {
                    const isSpectator = game.isGameStarted;
                    rawPlayerList.push({
                        id: data.id,
                        name: data.name || "ゲスト",
                        spectator: isSpectator,
                        score: 0,
                        isHost: false,
                        disconnected: false
                    });
                    game.log(`👥 ${data.name} が入室しました。`);
                }
            }
            broadcastState();
            updateUI();
            break;

        case "ACTION":
            if (!game.isGameStarted) return;
            const currentPlayer = game.players[game.turnIndex];
            if (currentPlayer && currentPlayer.id === data.playerId) {
                game.playCard(data.playerId, data.cardValue, data.target);
                broadcastState();
                updateUI();
            }
            break;

        case "LEAVE":
            handlePlayerDisconnect(conn.peer);
            break;
    }
}

// ゲストがデータを受信した時の処理
export function handleGuestReceiveData(data) {
    if (isHost) return;

    if (data.type === "SYNC_STATE") {
        game.isGameStarted = data.gameState.isGameStarted;
        game.deck = data.gameState.deck;
        game.players = data.gameState.players;
        game.turnIndex = data.gameState.turnIndex;
        game.cardSettings = data.gameState.cardSettings;
        game.drawSettings = data.gameState.drawSettings;

        // サーバ側（ホスト側）から同期されたリストをそのまま受け取る（課題6: 全員が見れる状態を維持）
        rawPlayerList = data.rawPlayerList;

        // 自分に👑ホスト権限が移ってきたかをチェック（課題2, 3）
        const myInfo = rawPlayerList.find(p => p.id === window.myId);
        if (myInfo && myInfo.isHost) {
            isHost = true;
            game.log("👑 あなたが新しいホストになりました！");
            // 新ホストとして他の残存コネクションを引き継ぐ仕組みはP2Pの構造上フルメッシュで
            // ない場合再接続が必要ですが、UIは即座にホスト専用へと切り替わります。
        }

        updateUI();
    }
}

// プレイヤー切断時の共通処理
function handlePlayerDisconnect(peerId) {
    const leftPlayer = rawPlayerList.find(p => p.id === peerId);
    if (!leftPlayer) return;

    // 課題7: 離脱したプレイヤーは「接続切れ」としてリストに隠蔽保持
    leftPlayer.disconnected = true;
    game.log(`🚪 ${leftPlayer.name} が一時退室（接続切れ）しました。`);
    
    guestConnections = guestConnections.filter(c => c.peer !== peerId);

    // ゲーム中のプレイヤーであれば脱落処理を裏で行う
    if (game.isGameStarted) {
        const pInGame = game.players.find(p => p.id === peerId);
        if (pInGame) {
            pInGame.alive = false;
            pInGame.hand = [];
        }
        if (game.isGameEnded()) {
            game.endRound();
        }
    }

    // 課題2: ホストが切断された場合、残っている最も入室が早い（配列の先頭）プレイヤーに権限を移行
    if (leftPlayer.isHost) {
        leftPlayer.isHost = false;
        // 接続が切れていないプレイヤーの中から選出
        const nextHost = rawPlayerList.find(p => !p.disconnected);
        if (nextHost) {
            nextHost.isHost = true;
            game.log(`👑 ホストが切断されたため、${nextHost.name} が新しいホストになりました。`);
            if (nextHost.id === window.myId) {
                isHost = true;
            }
        }
    }

    broadcastState();
    updateUI();
}

// ホストから全ゲストへ状態をブロードキャスト
export function broadcastState() {
    if (!isHost) return;

    const payload = JSON.stringify({
        type: "SYNC_STATE",
        rawPlayerList: rawPlayerList, // 課題6, 7用に追加
        gameState: {
            isGameStarted: game.isGameStarted,
            deck: game.deck,
            players: game.players,
            turnIndex: game.turnIndex,
            cardSettings: game.cardSettings,
            drawSettings: game.drawSettings
        }
    });

    guestConnections.forEach(conn => {
        if (conn.open) {
            conn.send(payload);
        }
    });
}

// ホスト用：プレイヤーのキック
export function hostKickPlayer(peerId) {
    if (!isHost) return;
    const conn = guestConnections.find(c => c.peer === peerId);
    if (conn) {
        conn.close();
    }
    handlePlayerDisconnect(peerId);
}

// ホスト用：ホスト権限の譲渡
export function hostTransferAuthority(peerId) {
    if (!isHost) return;
    const target = rawPlayerList.find(p => p.id === peerId);
    if (!target || target.disconnected) return;

    // 現ホストフラグを下ろし、ターゲットをホストに設定（課題2, 3）
    const currentHost = rawPlayerList.find(p => p.id === window.myId);
    if (currentHost) currentHost.isHost = false;
    
    target.isHost = true;
    isHost = false; // 自身のホストフラグを解除
    
    game.log(`👑 ホスト権限が ${target.name} に譲渡されました。`);
    broadcastState();
    updateUI();
}

// 部屋を離脱
export function leaveRoom() {
    if (isHost) {
        // ホスト自ら離脱する場合も次のプレイヤーに権限を委ねる
        const nextHost = rawPlayerList.find(p => p.id !== window.myId && !p.disconnected);
        if (nextHost) {
            nextHost.isHost = true;
            broadcastState(); // 最後に全員に状態を送る
        }
        guestConnections.forEach(conn => {
            if (conn.open) conn.close();
        });
    } else {
        if (connToHost && connToHost.open) {
            connToHost.send(JSON.stringify({ type: "LEAVE" }));
            connToHost.close();
        }
    }
    setTimeout(() => {
        window.location.reload();
    }, 200);
}
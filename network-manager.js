// network-manager.js
import { game } from "./game-logic.js";
import { updateUI } from "./ui-manager.js";

// グローバル状態の参照・定義
export let isHost = window.isHost || false;
export let myId = window.myId || "player_me";
export let myPlayerName = window.myPlayerName || "名無しプレイヤー";
export let rawPlayerList = window.rawPlayerList || []; // 待機室用の簡易プレイヤーリスト
export let connections = window.connections || [];     // ホストが持つ全ゲストへの接続オブジェクト配列
export let connToHost = window.connToHost || null;       // ゲストが持つホストへの接続オブジェクト

// 安全なデータ送信関数
export function safeSend(conn, data) {
    if (conn && conn.open) {
        conn.send(JSON.stringify(data));
    }
}

// 状態のアニメーション、全同期（ホストから全員へ送信）
export function broadcastState() {
    if (!isHost) return;
    const statePayload = {
        type: "SYNC_STATE",
        gameStarted: game.isGameStarted,
        deckLength: game.deck.length,
        players: game.players,
        turnIndex: game.turnIndex,
        cardSettings: game.cardSettings,
        drawSettings: game.drawSettings,
        rawPlayerList: rawPlayerList
    };
    connections.forEach(c => safeSend(c, statePayload));
}

// 部屋から離脱する
export function leaveRoom() {
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

// プレイヤーをキックする（ホスト専用）
export function hostKickPlayer(playerId) {
    if (!isHost) return;
    if (confirm("本当にこのプレイヤーをキックしますか？")) {
        // 通信切断処理や通知
        connections.forEach(c => {
            if (c.peer === playerId || c.metadata?.id === playerId) {
                safeSend(c, { type: "KICKED" });
            }
        });
        // リストから除外
        rawPlayerList = rawPlayerList.filter(p => p.id !== playerId);
        game.players = game.players.filter(p => p.id !== playerId);
        broadcastState();
        updateUI();
    }
}

// ホスト権限を譲渡する（ホスト専用）
export function hostTransferAuthority(playerId) {
    if (!isHost) return;
    if (confirm("本当にこのプレイヤーにホスト権限を譲渡しますか？")) {
        connections.forEach(c => {
            safeSend(c, { type: "HOST_TRANSFER", newHostId: playerId });
        });
        // 自身のローカル状態を変更してリロード
        alert("権限を譲渡しました。再読み込みします。");
        location.reload();
    }
}

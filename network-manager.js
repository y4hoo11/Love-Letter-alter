// network-manager.js
import { game } from "./game-logic.js";
import { updateUI, syncGuestSettingsUI } from "./ui-manager.js";

// 最初期のグローバル配列・変数の安全なセットアップ
window.connections = window.connections || [];
window.rawPlayerList = window.rawPlayerList || [];

export let isHost = false;
export let myId = "";
export let myPlayerName = "";
export let rawPlayerList = [];
export let connections = [];
export let connToHost = null;

// script.jsから状態を同期するためのセッター
export function setIsHost(val) { isHost = val; window.isHost = val; }
export function setRawPlayerList(list) { rawPlayerList = list; window.rawPlayerList = list; }
export function setConnections(conn) { connections.push(conn); window.connections.push(conn); }
export function setConnToHost(conn) { connToHost = conn; window.connToHost = conn; }

export function safeSend(conn, data) {
    if (conn && conn.open) {
        conn.send(JSON.stringify(data));
    }
}

// ホストから全員へ現在のゲーム状態をブロードキャスト
export function broadcastState() {
    // 常に最新のグローバル変数を参照
    myId = window.myId;
    rawPlayerList = window.rawPlayerList;
    connections = window.connections;

    if (!window.isHost) return;

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

// ーーー 📩 データ受信ハンドラー ーーー

// 1. ホスト側がゲストからデータを受け取った時
export function handleHostReceiveData(conn, data) {
    myId = window.myId;
    rawPlayerList = window.rawPlayerList;
    connections = window.connections;

    if (data.type === "JOIN") {
        // すでに登録済みか確認
        if (!rawPlayerList.some(p => p.id === data.id)) {
            rawPlayerList.push({
                id: data.id,
                name: data.name,
                spectator: false,
                score: 0
            });
            window.rawPlayerList = rawPlayerList;
            game.log(`👥 ${data.name} が参加しました。`);
        }
        // 新しいメンバーを含めて全員に同期、UI更新
        broadcastState();
        updateUI();
    } 
    else if (data.type === "LEAVE") {
        rawPlayerList = rawPlayerList.filter(p => p.id !== data.id);
        window.rawPlayerList = rawPlayerList;
        game.players = game.players.filter(p => p.id !== data.id);
        game.log(`🚪 ${data.name} が退室しました。`);
        broadcastState();
        updateUI();
    } 
    else if (data.type === "ACTION") {
        // ゲストからのカードプレイ要求を処理
        game.playCard(data.playerId, data.cardValue, data.target);
        broadcastState();
        updateUI();
    }
}

// 2. ゲスト側がホストからデータ（状態同期）を受け取った時
export function handleGuestReceiveData(data) {
    myId = window.myId;

    if (data.type === "SYNC_STATE") {
        // ホストのゲームデータとプレイヤー名簿を自身のローカルに同期
        game.isGameStarted = data.gameStarted;
        game.deck = { length: data.deckLength }; // ゲスト側は枚数だけ見えればOK
        game.players = data.players;
        game.turnIndex = data.turnIndex;
        game.cardSettings = data.cardSettings;
        game.drawSettings = data.drawSettings;
        
        window.rawPlayerList = data.rawPlayerList;
        rawPlayerList = data.rawPlayerList;

        // 設定エリアの同期
        if (!game.isGameStarted) {
            syncGuestSettingsUI(data.cardSettings, data.drawSettings);
        }
        updateUI();
    } 
    else if (data.type === "HOST_DISCONNECT") {
        alert("ホストが離脱したため、部屋が解散されました。");
        location.reload();
    } 
    else if (data.type === "KICKED") {
        alert("ホストによってキックされました。");
        location.reload();
    } 
    else if (data.type === "HOST_TRANSFER") {
        if (myId === data.newHostId) {
            alert("あなたが新しいホストに任命されました！");
            window.isHost = true;
            isHost = true;
        } else {
            game.log(`👑 ホスト権限が交代しました。`);
        }
        updateUI();
    }
}

// 部屋から離脱する
export function leaveRoom() {
    myId = window.myId;
    myPlayerName = window.myPlayerName;
    connections = window.connections;
    connToHost = window.connToHost;

    if (confirm("本当にこの部屋から離脱しますか？")) {
        if (window.isHost) {
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

// プレイヤーをキックする
export function hostKickPlayer(playerId) {
    connections = window.connections;
    rawPlayerList = window.rawPlayerList;

    if (!window.isHost) return;
    if (confirm("本当にこのプレイヤーをキックしますか？")) {
        connections.forEach(c => {
            if (c.peer === playerId) {
                safeSend(c, { type: "KICKED" });
            }
        });
        rawPlayerList = rawPlayerList.filter(p => p.id !== playerId);
        window.rawPlayerList = rawPlayerList;
        game.players = game.players.filter(p => p.id !== playerId);
        broadcastState();
        updateUI();
    }
}

// ホスト権限を譲渡する
export function hostTransferAuthority(playerId) {
    connections = window.connections;
    if (!window.isHost) return;
    if (confirm("本当にこのプレイヤーにホスト権限を譲渡しますか？")) {
        connections.forEach(c => {
            safeSend(c, { type: "HOST_TRANSFER", newHostId: playerId });
        });
        alert("権限を譲渡しました。再読み込みします。");
        location.reload();
    }
}

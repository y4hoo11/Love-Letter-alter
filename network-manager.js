// network-manager.js
import { game } from "./game-logic.js";
import { updateUI, syncGuestSettingsUI } from "./ui-manager.js";

export let peer = null;
export let isHost = false;
export let myId = "";
export let myName = "";
export let rawPlayerList = []; // 待機室用の全接続クライアントリスト [{id, name, spectator}]
export let connToHost = null;  // ゲスト用：ホストへのデータ接続保持
export let guestConnections = {}; // ホスト用：ゲストID -> Connectionマッピング

// 初期化（ページ読み込み時に実行）
export function initNetwork(chosenName, targetPeerId = null) {
    myName = chosenName || `プレイヤー_${Math.floor(Math.random() * 1000)}`;
    
    // PeerJSなどのライブラリを想定（シグナリングサーバー経由でID生成）
    peer = new Peer(null, {
        debug: 1
    });

    peer.on('open', (id) => {
        myId = id;
        console.log(`[Network] PeerID取得成功: ${myId}`);
        
        if (targetPeerId) {
            // ゲストとしてホストに接続
            isHost = false;
            connectToHostRoom(targetPeerId);
        } else {
            // 自分がホストとしてルームを開設
            isHost = true;
            rawPlayerList.push({ id: myId, name: myName, spectator: false, score: 0 });
            updateUI();
            console.log("[Network] ホストとしてルームを作成しました。");
        }
    });

    peer.on('connection', (conn) => {
        if (!isHost) {
            conn.close();
            return; // ゲストは直接接続を受け付けない
        }
        handleHostIncomingConnection(conn);
    });
}

// ゲスト用：ホストへの接続処理
function connectToHostRoom(hostId) {
    connToHost = peer.connect(hostId);
    
    connToHost.on('open', () => {
        console.log("[Network] ホストとのデータチャネルが開通しました。");
        // 自分の名前情報をホストに送信して参加申請
        safeSend(connToHost, { type: "JOIN", name: myName });
    });

    connToHost.on('data', (data) => {
        handleGuestReceiveData(data);
    });

    connToHost.on('close', () => {
        alert("ホストとの接続が切断されました、または退室させられました。");
        window.location.reload();
    });
}

// ホスト用：新しいゲスト接続のハンドリング
function handleHostIncomingConnection(conn) {
    conn.on('data', (data) => {
        if (data.type === "JOIN") {
            // 同一IDの重複チェック
            if (guestConnections[conn.peer]) {
                conn.close();
                return;
            }

            guestConnections[conn.peer] = conn;
            // プレイヤーリストに追加 (ゲーム中なら自動的に観戦モード)
            rawPlayerList.push({
                id: conn.peer,
                name: data.name || "名無しゲスト",
                spectator: game.isGameStarted, 
                score: 0
            });

            console.log(`[Host] プレイヤーが参加しました: ${data.name} (${conn.peer})`);
            
            // 全員に最新状態を共有
            broadcastState();
            updateUI();
        }

        if (data.type === "ACTION") {
            // ゲストからのカードプレイ要求をホスト側ゲームロジックに投入
            if (!game.isGameStarted) return;
            // 手番プレイヤーからの通信か検証
            const currentPlayer = game.players[game.turnIndex];
            if (currentPlayer && currentPlayer.id === data.playerId) {
                game.playCard(data.playerId, data.cardValue, data.target);
                broadcastState();
                updateUI();
            }
        }
    });

    conn.on('close', () => {
        console.log(`[Host] ゲストが切断しました: ${conn.peer}`);
        delete guestConnections[conn.peer];
        rawPlayerList = rawPlayerList.filter(p => p.id !== conn.peer);
        
        // ゲーム中ならゲーム内のプレイヤーも脱落・または不参加処理
        const gPlayer = game.players.find(p => p.id === conn.peer);
        if (gPlayer) gPlayer.alive = false;

        if (game.isGameStarted && game.isGameEnded()) {
            game.endRound();
        }

        broadcastState();
        updateUI();
    });
}

// ゲスト用：データ受信処理
function handleGuestReceiveData(data) {
    if (data.type === "SYNC_STATE") {
        // ホストからのゲーム状態の完全同期
        game.isGameStarted = data.gameState.isGameStarted;
        game.deck = data.gameState.deck;
        game.players = data.gameState.players;
        game.turnIndex = data.gameState.turnIndex;
        game.cardSettings = data.gameState.cardSettings;
        game.drawSettings = data.gameState.drawSettings;

        // UI設定エリアの同期
        syncGuestSettingsUI(data.gameState.cardSettings, data.gameState.drawSettings);
        updateUI();
    }
}

// ホスト用：全接続ゲストへの状態一斉配信
export function broadcastState() {
    if (!isHost) return;
    
    const statePayload = {
        type: "SYNC_STATE",
        gameState: {
            isGameStarted: game.isGameStarted,
            deck: game.deck,
            players: game.players,
            turnIndex: game.turnIndex,
            cardSettings: game.cardSettings,
            drawSettings: game.drawSettings
        }
    };

    // 全データチャネルに送信
    Object.values(guestConnections).forEach(conn => {
        safeSend(conn, statePayload);
    });
}

// ホスト用：特定のプレイヤーをキック
export function hostKickPlayer(playerId) {
    if (!isHost || playerId === myId) return;
    if (guestConnections[playerId]) {
        guestConnections[playerId].close();
        delete guestConnections[playerId];
    }
    rawPlayerList = rawPlayerList.filter(p => p.id !== playerId);
    broadcastState();
    updateUI();
}

// ホスト用：部屋のホスト権限を別の人に譲渡
export function hostTransferAuthority(playerId) {
    if (!isHost || playerId === myId) return;
    alert("※この簡易実装では完全なホスト移行はルームの再作成が必要です。推奨：再入室");
    // 拡張ロジックを入れる場合はここで新規ホストの選定メッセージをブロードキャストする
}

// 共通：切断して退室
export function leaveRoom() {
    if (peer) {
        peer.destroy();
    }
    window.location.reload();
}

// 共通：データ送信セーフティ関数
export function safeSend(conn, data) {
    if (conn && conn.open) {
        conn.send(data);
    } else {
        console.warn("[Network] 送信失敗: 接続が閉じているか未確立です。");
    }
}
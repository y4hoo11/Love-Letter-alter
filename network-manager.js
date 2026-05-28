// network-manager.js
import { game } from "./game-logic.js";
import { updateUI, syncGuestSettingsUI } from "./ui-manager.js";

export let isHost = false;
export let rawPlayerList = []; 
export let guestConnections = []; 
export let connToHost = null;     

export function setIsHost(val) { isHost = val; }
export function setRawPlayerList(list) { rawPlayerList = list; }
export function setConnections(conn) { 
    if (!guestConnections.some(c => c.peer === conn.peer)) {
        guestConnections.push(conn); 
    }
}
export function setConnToHost(conn) { connToHost = conn; }

export function handleHostReceiveData(conn, data) {
    if (!isHost) return;

    switch (data.type) {
        case "JOIN":
            const isSpectator = game.isGameStarted;
            if (!rawPlayerList.some(p => p.id === data.id)) {
                rawPlayerList.push({
                    id: data.id,
                    name: data.name || "ゲスト",
                    spectator: isSpectator,
                    score: 0
                });
                game.log(`👥 ${data.name} が入室しました。`);
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

export function handleGuestReceiveData(data) {
    if (isHost) return;

    if (data.type === "SYNC_STATE") {
        game.isGameStarted = data.gameState.isGameStarted;
        game.deck = data.gameState.deck;
        game.players = data.gameState.players;
        game.turnIndex = data.gameState.turnIndex;
        game.cardSettings = data.gameState.cardSettings;
        game.drawSettings = data.gameState.drawSettings;

        rawPlayerList = game.players.map(p => ({
            id: p.id,
            name: p.name,
            spectator: p.spectator,
            score: p.score
        }));

        syncGuestSettingsUI(data.gameState.cardSettings, data.gameState.drawSettings);
        updateUI();
    }
}

function handlePlayerDisconnect(peerId) {
    const leftPlayer = rawPlayerList.find(p => p.id === peerId);
    if (leftPlayer) {
        game.log(`🚪 ${leftPlayer.name} が退室しました。`);
    }
    rawPlayerList = rawPlayerList.filter(p => p.id !== peerId);
    guestConnections = guestConnections.filter(c => c.peer !== peerId);

    if (game.isGameStarted) {
        const pInGame = game.players.find(p => p.id === peerId);
        if (pInGame) {
            pInGame.alive = false;
            pInGame.hand = [];
            game.log(`💥 ${pInGame.name} は切断されたため脱落しました。`);
        }
        if (game.isGameEnded()) {
            game.endRound();
        }
    }
    broadcastState();
    updateUI();
}

export function broadcastState() {
    if (!isHost) return;

    const payload = JSON.stringify({
        type: "SYNC_STATE",
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

export function hostKickPlayer(peerId) {
    if (!isHost) return;
    const conn = guestConnections.find(c => c.peer === peerId);
    if (conn) {
        conn.close();
    }
    handlePlayerDisconnect(peerId);
}

export function hostTransferAuthority(peerId) {
    if (!isHost) return;
    alert("ホスト権限の移行には、対象プレイヤーに新しく部屋を作成してもらい、再入室することをおすすめします。");
}

export function leaveRoom() {
    if (isHost) {
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
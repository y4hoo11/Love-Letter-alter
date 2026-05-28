// script.js
import { game } from "./game-logic.js";
import { updateUI, hostStartGame, hostNextRound, injectCustomSettingsUIIntoGame, injectAbortButton } from "./ui-manager.js";
import { leaveRoom } from "./network-manager.js";

let peer = null;

document.addEventListener("DOMContentLoaded", () => {
    const randomId = Math.floor(10000000 + Math.random() * 90000000).toString();
    peer = new Peer(randomId);

    peer.on('open', (id) => {
        window.myId = id; 
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) {
            // 強調を無くし、シンプルなプレーンテキストに変更
            idDisplay.innerText = `部屋ID: ${id} (クリックでコピー)`;
            
            // クリックでクリップボードにコピーする機能を追加
            idDisplay.onclick = () => {
                navigator.clipboard.writeText(id).then(() => {
                    const originalText = idDisplay.innerText;
                    idDisplay.innerText = "📋 コピーしました！";
                    setTimeout(() => {
                        idDisplay.innerText = originalText;
                    }, 1000);
                }).catch(err => {
                    console.error("コピーに失敗しました:", err);
                });
            };
        }
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) idDisplay.innerText = `❌ エラーが発生しました: ${err.type}`;
    });

    // 各ボタンへのイベントリスナー登録
    document.getElementById("be-host-btn")?.addEventListener("click", beHost);
    document.getElementById("join-room-btn")?.addEventListener("click", joinRoom);
    document.getElementById("leave-room-btn")?.addEventListener("click", leaveRoom);
    document.getElementById("start-game-btn")?.addEventListener("click", hostStartGame);
    document.getElementById("next-round-btn")?.addEventListener("click", hostNextRound);
});

function beHost() {
    const nameInput = document.getElementById("name-input");
    window.myPlayerName = nameInput ? nameInput.value.trim() : "ホスト";
    window.isHost = true;

    window.rawPlayerList = [{ id: window.myId, name: window.myPlayerName, spectator: false, score: 0 }];

    document.getElementById("setup-container").style.display = "none";
    document.getElementById("game-container").style.display = "block";

    injectCustomSettingsUIIntoGame();
    injectAbortButton();
    
    updateUI();
    game.log(`🏠 部屋を作成しました。ゲストの参加を待っています...`);

    peer.on('connection', (conn) => {
        window.connections.push(conn);
        
        conn.on('data', (dataStr) => {
            const data = JSON.parse(dataStr);
            game.log(`📩 ゲストからメッセージ受信: ${data.type}`);
        });
    });
}

function joinRoom() {
    const roomIdInput = document.getElementById("room-id-input");
    const targetRoomId = roomIdInput ? roomIdInput.value.trim() : "";
    
    if (targetRoomId.length !== 8) {
        alert("部屋IDは8桁の数字で入力してください。");
        return;
    }

    const nameInput = document.getElementById("name-input");
    window.myPlayerName = nameInput ? nameInput.value.trim() : "ゲスト";
    window.isHost = false;

    game.log(`🌐 部屋 [${targetRoomId}] に接続を試みています...`);

    const conn = peer.connect(targetRoomId);
    window.connToHost = conn;

    conn.on('open', () => {
        game.log(`🟢 ホストに接続しました！認証中...`);
        conn.send(JSON.stringify({
            type: "JOIN",
            id: window.myId,
            name: window.myPlayerName
        }));

        document.getElementById("setup-container").style.display = "none";
        document.getElementById("game-container").style.display = "block";
    });

    conn.on('data', (dataStr) => {
        const data = JSON.parse(dataStr);
    });
}

// script.js
import { game } from "./game-logic.js";
import { updateUI, hostStartGame, hostNextRound, injectCustomSettingsUIIntoGame, injectAbortButton } from "./ui-manager.js";
import { leaveRoom, setRawPlayerList, setConnections, setConnToHost, setIsHost, handleHostReceiveData, handleGuestReceiveData } from "./network-manager.js";

let peer = null;

document.addEventListener("DOMContentLoaded", () => {
    const randomId = Math.floor(10000000 + Math.random() * 90000000).toString();
    peer = new Peer(randomId);

    peer.on('open', (id) => {
        window.myId = id; 
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) {
            idDisplay.innerText = `部屋ID: ${id} (クリックでコピー)`;
            idDisplay.onclick = () => {
                navigator.clipboard.writeText(id).then(() => {
                    const originalText = idDisplay.innerText;
                    idDisplay.innerText = "📋 コピーしました！";
                    setTimeout(() => idDisplay.innerText = originalText, 1000);
                });
            };
        }
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) idDisplay.innerText = `❌ エラーが発生しました: ${err.type}`;
    });

    document.getElementById("be-host-btn")?.addEventListener("click", beHost);
    document.getElementById("join-room-btn")?.addEventListener("click", joinRoom);
    document.getElementById("leave-room-btn")?.addEventListener("click", leaveRoom);
    document.getElementById("start-game-btn")?.addEventListener("click", hostStartGame);
    document.getElementById("next-round-btn")?.addEventListener("click", hostNextRound);
});

function beHost() {
    const nameInput = document.getElementById("name-input");
    window.myPlayerName = nameInput ? nameInput.value.trim() : "ホスト";
    setIsHost(true);

    // ホスト自身をリストの先頭に登録
    const initialList = [{ id: window.myId, name: window.myPlayerName, spectator: false, score: 0 }];
    setRawPlayerList(initialList);

    document.getElementById("setup-container").style.display = "none";
    document.getElementById("game-container").style.display = "block";

    injectCustomSettingsUIIntoGame();
    injectAbortButton();
    
    updateUI();
    game.log(`🏠 部屋を作成しました。部屋IDを友達に共有してください。`);

    // ゲストの接続待ち受け
    peer.on('connection', (conn) => {
        setConnections(conn); // 接続を配列に保存
        
        conn.on('data', (dataStr) => {
            try {
                const data = JSON.parse(dataStr);
                handleHostReceiveData(conn, data);
            } catch (e) {
                console.error("データ解析エラー:", e);
            }
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
    setIsHost(false);

    game.log(`🌐 部屋 [${targetRoomId}] に接続を試みています...`);

    const conn = peer.connect(targetRoomId);
    setConnToHost(conn);

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

    // ホストからデータ（同期情報）が送られてきた時
    conn.on('data', (dataStr) => {
        try {
            const data = JSON.parse(dataStr);
            handleGuestReceiveData(data);
        } catch (e) {
            console.error("データ解析エラー:", e);
        }
    });
}

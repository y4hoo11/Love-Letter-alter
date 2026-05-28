// script.js
import { game } from "./game-logic.js";
import { updateUI, hostStartGame, hostNextRound, injectCustomSettingsUIIntoGame, injectAbortButton } from "./ui-manager.js";
import { leaveRoom, setRawPlayerList, setConnections, setConnToHost, setIsHost, handleHostReceiveData, handleGuestReceiveData } from "./network-manager.js";

let peer = null;

document.addEventListener("DOMContentLoaded", () => {
    // 8桁のランダムな数字でPeerIDを生成
    const randomId = Math.floor(10000000 + Math.random() * 90000000).toString();
    peer = new Peer(randomId);

    // シグナリングサーバーへの接続成功時
    peer.on('open', (id) => {
        window.myId = id; 
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) {
            idDisplay.innerText = `部屋ID: ${id} (クリックでコピー)`;
            
            // クリップボードへのコピーイベント
            idDisplay.onclick = () => {
                navigator.clipboard.writeText(id).then(() => {
                    const originalText = idDisplay.innerText;
                    idDisplay.innerText = "📋 コピーしました！";
                    setTimeout(() => idDisplay.innerText = originalText, 1000);
                }).catch(err => {
                    console.error("コピー処理に失敗しました:", err);
                });
            };
        }
    });

    // 接続エラーハンドリング
    peer.on('error', (err) => {
        console.error("PeerJS Connection Error:", err);
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) idDisplay.innerText = `❌ エラーが発生しました: ${err.type}`;
    });

    // 各ボタンへのイベント紐付け（HTMLの変更後も確実に認識されます）
    document.getElementById("be-host-btn")?.addEventListener("click", beHost);
    document.getElementById("join-room-btn")?.addEventListener("click", joinRoom);
    document.getElementById("leave-room-btn")?.addEventListener("click", leaveRoom);
    document.getElementById("start-game-btn")?.addEventListener("click", hostStartGame);
    document.getElementById("next-round-btn")?.addEventListener("click", hostNextRound);
});

// 🏠 部屋を作る (ホスト処理)
function beHost() {
    const nameInput = document.getElementById("name-input");
    window.myPlayerName = nameInput ? nameInput.value.trim() : "ホスト";
    setIsHost(true);

    // 自分自身（ホスト）をメンバー名簿に初期登録
    const initialList = [{ id: window.myId, name: window.myPlayerName, spectator: false, score: 0, isHost: true, disconnected: false }];
    setRawPlayerList(initialList);

    // 画面切り替え
    document.getElementById("setup-container").style.display = "none";
    document.getElementById("game-container").style.display = "block";

    // ホスト用のUIパーツ（カスタム設定・中断ボタン）を構築
    // ui-manager.jsで統合されたカスタムUIが実行されます
    import("./ui-manager.js").then(mod => {
        if (typeof mod.renderCustomSettingsUI === "function") {
            mod.renderCustomSettingsUI();
        } else {
            mod.injectCustomSettingsUIIntoGame();
        }
    });
    injectAbortButton();
    
    // UI反映（ホスト自身が即座にプレイヤーリストに描画される）
    updateUI();
    game.log(`🏠 部屋を作成しました。部屋IDを友達に共有してください。`);

    // ゲストからの接続を常時待ち受け
    peer.on('connection', (conn) => {
        setConnections(conn);
        
        conn.on('open', () => {
            conn.on('data', (dataStr) => {
                try {
                    const data = typeof dataStr === "string" ? JSON.parse(dataStr) : dataStr;
                    handleHostReceiveData(conn, data);
                } catch (e) {
                    console.error("ホストデータ処理エラー:", e);
                }
            });
        });
    });
}

// 🌐 部屋に入る (ゲスト処理)
function joinRoom() {
    const roomIdInput = document.getElementById("room-id-input");
    const targetRoomId = roomIdInput ? roomIdInput.value.trim() : "";
    
    if (targetRoomId.length !== 8 || isNaN(targetRoomId)) {
        alert("部屋IDは8桁の数字で入力してください。");
        return;
    }

    if (targetRoomId === window.myId) {
        alert("自分の部屋IDには入室できません。");
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
        // ホストに自身のプレイヤー情報を送信
        conn.send(JSON.stringify({
            type: "JOIN",
            id: window.myId,
            name: window.myPlayerName
        }));

        document.getElementById("setup-container").style.display = "none";
        document.getElementById("game-container").style.display = "block";
    });

    conn.on('data', (dataStr) => {
        try {
            const data = typeof dataStr === "string" ? JSON.parse(dataStr) : dataStr;
            handleGuestReceiveData(data);
        } catch (e) {
            console.error("ゲストデータ処理エラー:", e);
        }
    });

    conn.on('close', () => {
        alert("ホストとの接続が切断されました。");
        window.location.reload();
    });
}
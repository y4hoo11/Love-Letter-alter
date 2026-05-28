// script.js
import { game } from "./game-logic.js";
import { updateUI, hostStartGame, hostNextRound, injectCustomSettingsUIIntoGame, injectAbortButton } from "./ui-manager.js";
import { leaveRoom } from "./network-manager.js";

// PeerJSの初期化や入退室に関わるロジックをここに集約
let peer = null;

// ページ読み込み時の初期設定
document.addEventListener("DOMContentLoaded", () => {
    // 1. PeerJSオブジェクトの作成 (ランダムな8桁の数字をIDにする例)
    const randomId = Math.floor(10000000 + Math.random() * 90000000).toString();
    
    // PeerJSサーバーに接続 (シグナリング)
    peer = new Peer(randomId);

    // 接続が成功してIDが確定したとき
    peer.on('open', (id) => {
        window.myId = id; // グローバルに紐付け
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) {
            idDisplay.innerHTML = `あなたの部屋ID: <strong style="color:#e74c3c; font-size:1.2rem;">${id}</strong> (友達に教えてあげてください)`;
        }
    });

    // エラーハンドリング
    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const idDisplay = document.getElementById("my-peer-id");
        if (idDisplay) idDisplay.innerText = `❌ エラーが発生しました: ${err.type}`;
    });

    // 2. HTML要素へのイベントリスナー登録 (HTMLからonclickを排除したため、ここで紐付けます)
    document.getElementById("be-host-btn")?.addEventListener("click", beHost);
    document.getElementById("join-room-btn")?.addEventListener("click", joinRoom);
    document.getElementById("leave-room-btn")?.addEventListener("click", leaveRoom);
    document.getElementById("start-game-btn")?.addEventListener("click", hostStartGame);
    document.getElementById("next-round-btn")?.addEventListener("click", hostNextRound);
});

// ホストとして部屋を作る処理
function beHost() {
    const nameInput = document.getElementById("name-input");
    window.myPlayerName = nameInput ? nameInput.value.trim() : "ホスト";
    window.isHost = true;

    // 自身の情報を初期リストに追加
    window.rawPlayerList = [{ id: window.myId, name: window.myPlayerName, spectator: false, score: 0 }];

    // 画面の切り替え
    document.getElementById("setup-container").style.display = "none";
    document.getElementById("game-container").style.display = "block";

    // ホスト用UIのインジェクション
    injectCustomSettingsUIIntoGame();
    injectAbortButton();
    
    // 初期UIの描画
    updateUI();
    game.log(`🏠 部屋を作成しました。ゲストの参加を待っています...`);

    // ゲストからの接続要求を待ち受ける設定
    peer.on('connection', (conn) => {
        window.connections.push(conn);
        
        // データ受信時の処理
        conn.on('data', (dataStr) => {
            const data = JSON.parse(dataStr);
            // network-manager側で受け取るべきアクション分岐などをここに実装します
            game.log(`📩 ゲストからメッセージ受信: ${data.type}`);
        });
    });
}

// ゲストとして部屋に入る処理
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

    // ホストへの接続を開始
    const conn = peer.connect(targetRoomId);
    window.connToHost = conn;

    conn.on('open', () => {
        game.log(`🟢 ホストに接続しました！認証中...`);
        // 自身の情報をホストに送信
        conn.send(JSON.stringify({
            type: "JOIN",
            id: window.myId,
            name: window.myPlayerName
        }));

        // 画面の切り替え
        document.getElementById("setup-container").style.display = "none";
        document.getElementById("game-container").style.display = "block";
    });

    conn.on('data', (dataStr) => {
        const data = JSON.parse(dataStr);
        // ホストからの状態同期 (SYNC_STATE) などの処理をここに反映
    });
}

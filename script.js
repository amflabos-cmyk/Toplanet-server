// === SOCKET CONNECTION ===
const socket = io();

// === GLOBAL STATE ===
let myData = null;
let selectedIndices = [];
let timerInterval = null;
let soundEnabled = true;
let reconnecting = false;
let playerName = '';
let myTeam = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// === STATISTICS (LocalStorage) ===
function getStats() {
    const stats = localStorage.getItem('toplanet_stats');
    return stats ? JSON.parse(stats) : {
        gamesPlayed: 0,
        gamesWon: 0,
        totalPoints: 0,
        sweeps: 0
    };
}

function saveStats(stats) {
    localStorage.setItem('toplanet_stats', JSON.stringify(stats));
}

function updateStatsAfterGame(won, points) {
    const stats = getStats();
    stats.gamesPlayed++;
    if (won) stats.gamesWon++;
    stats.totalPoints += points;
    saveStats(stats);
}

function resetStats() {
    if (confirm('Möchtest du wirklich alle Statistiken zurücksetzen?')) {
        localStorage.removeItem('toplanet_stats');
        showStats();
        playSound('error');
    }
}

// === SOUND SYSTEM ===
const sounds = {
    click: new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1+TFeSgGHm7A7OGZSwoSVq3n7bVeGAg+ldf'),
    card: new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1+TFeSgGHm7A7OGZSwoSVq3n7bVeGAg+ldf'),
    win: new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1+TFeSgGHm7A7OGZSwoSVq3n7bVeGAg+ldf'),
    error: new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1+TFeSgGHm7A7OGZSwoSVq3n7bVeGAg+ldf')
};

function playSound(type) {
    if (soundEnabled && sounds[type]) {
        sounds[type].currentTime = 0;
        sounds[type].play().catch(() => {});
    }
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    document.getElementById('sound-toggle').innerText = soundEnabled ? '🔊' : '🔇';
    playSound('click');
}

// === CONNECTION MANAGEMENT ===
socket.on('connect', () => {
    hideConnectionStatus();
    if (reconnecting && playerName) {
        socket.emit('login', playerName);
        reconnecting = false;
    }
});

socket.on('disconnect', () => {
    showConnectionStatus('Verbindung getrennt...');
    reconnecting = true;
});

socket.on('connect_error', () => {
    showConnectionStatus('Verbindungsfehler...');
});

function showConnectionStatus(text) {
    const status = document.getElementById('connection-status');
    document.getElementById('connection-text').innerText = text;
    status.classList.remove('hidden');
}

function hideConnectionStatus() {
    document.getElementById('connection-status').classList.add('hidden');
}

// === NAVIGATION ===
function showScreen(id) {
    document.querySelectorAll('.overlay, .main-layout').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// === 1. LOGIN ===
function login() {
    const name = document.getElementById('player-name-input').value.trim();
    if (name) {
        playerName = name;
        socket.emit('login', name);
        playSound('click');
    } else {
        const input = document.getElementById('player-name-input');
        input.style.animation = 'shake 0.5s';
        setTimeout(() => input.style.animation = '', 500);
        playSound('error');
    }
}

socket.on('loginSuccess', () => {
    showScreen('screen-menu');
    document.getElementById('player-name-display').innerText = `👋 ${playerName}`;
    displayStatsPreview();
    playSound('win');
});

function displayStatsPreview() {
    const stats = getStats();
    const preview = document.getElementById('player-stats-preview');
    if (preview && stats.gamesPlayed > 0) {
        const winRate = Math.round((stats.gamesWon / stats.gamesPlayed) * 100);
        preview.innerHTML = `
            <div style="margin-top: 20px; padding: 15px; background: rgba(26, 115, 232, 0.1); border-radius: 8px;">
                <small style="color: #a0a0a0;">Deine Statistiken</small><br>
                <strong>${stats.gamesPlayed}</strong> Spiele | 
                <strong>${winRate}%</strong> Siegrate
            </div>
        `;
    }
}

// === 2. MAIN MENU ===
function showCreateGame() {
    showScreen('screen-create');
    playSound('click');
}

function backToMenu() {
    showScreen('screen-menu');
    socket.emit('getRooms');
    playSound('click');
}

function createGame() {
    const name = document.getElementById('room-name-input').value.trim();
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (name) {
        socket.emit('createRoom', { name, mode });
        playSound('card');
    } else {
        playSound('error');
    }
}

function playVsBot(difficulty = 'medium') {
    socket.emit('startBotGame', difficulty);
    playSound('card');
}

socket.on('roomList', (rooms) => {
    const ul = document.getElementById('room-list');
    ul.innerHTML = '';
    if (rooms.length === 0) {
        ul.innerHTML = '<li class="empty-state">Keine offenen Spiele. Erstelle eins! 🎮</li>';
    } else {
        rooms.forEach(r => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div>
                    <strong>${r.name}</strong>
                    <br><small style="color: #a0a0a0;">${r.mode} • ${r.playerCount} Spieler</small>
                </div>
                <button class="btn-small btn-primary" onclick="joinRoom('${r.id}')">Beitreten</button>
            `;
            ul.appendChild(li);
        });
    }
});

function joinRoom(id) {
    socket.emit('joinRoom', id);
    playSound('click');
}

// === 3. WAITING ROOM ===
socket.on('joinedRoom', (data) => {
    showScreen('screen-room');
    const modeText = data.mode === '1v1' ? '1 vs 1' : '2 vs 2';
    document.getElementById('room-title').innerText = `🎯 ${modeText} Lobby`;
    document.getElementById('room-code').innerText = `Raum-ID: ${data.roomId}`;
    
    const btn = document.getElementById('btn-start-game');
    if (data.isHost) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
    
    playSound('win');
});

function joinTeam(nr) {
    socket.emit('switchTeam', nr);
    playSound('click');
}

function startGame() {
    socket.emit('startGame');
    playSound('card');
}

function leaveRoom() {
    socket.emit('leaveRoom');
    backToMenu();
}

function confirmLeave() {
    if (confirm('Möchtest du wirklich aufgeben?')) {
        leaveRoom();
        playSound('error');
    }
}

socket.on('roomUpdate', (room) => {
    updateTeamList(1, room.players.filter(p => p.team === 1));
    updateTeamList(2, room.players.filter(p => p.team === 2));
    
    const status = `${room.players.length} Spieler im Raum`;
    document.getElementById('room-status').innerText = status;
});

function updateTeamList(nr, players) {
    const ul = document.getElementById('list-team-' + nr);
    ul.innerHTML = players.length === 0 
        ? '<li style="opacity: 0.5; text-align: center;">Leer</li>'
        : players.map(p => `<li>👤 ${p.name}</li>`).join('');
}

// === CHAT SYSTEM ===
socket.on('chatMessage', (data) => {
    addChatMessage(data, 'room-chat-messages');
    playSound('click');
});

socket.on('gameChatMessage', (data) => {
    addChatMessage(data, 'game-chat-messages');
    playSound('click');
});

socket.on('voiceMessage', (data) => {
    addVoiceMessage(data, 'room-chat-messages');
    playSound('click');
});

socket.on('gameVoiceMessage', (data) => {
    addVoiceMessage(data, 'game-chat-messages');
    playSound('click');
});

function addChatMessage(data, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const msg = document.createElement('div');
    msg.className = 'chat-message';
    msg.innerHTML = `<span class="sender">${data.sender}:</span>${data.message}`;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function addVoiceMessage(data, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const msg = document.createElement('div');
    msg.className = 'chat-message';
    msg.innerHTML = `
        <span class="sender">${data.sender}:</span>
        <div class="voice-message">
            <span>🎤</span>
            <audio controls src="${data.audioUrl}"></audio>
            <span class="voice-duration">${data.duration}s</span>
        </div>
    `;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById('room-chat-input');
    const msg = input.value.trim();
    if (msg) {
        socket.emit('chatMessage', msg);
        input.value = '';
        playSound('click');
    }
}

function sendGameChat() {
    const input = document.getElementById('game-chat-input');
    const msg = input.value.trim();
    if (msg) {
        socket.emit('gameChatMessage', msg);
        input.value = '';
        playSound('click');
    }
}

// === VOICE RECORDING ===
async function startVoiceRecording() {
    if (isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                const base64Audio = reader.result;
                const duration = Math.round(audioChunks.length / 10); // Approximation
                socket.emit('gameVoiceMessage', { audio: base64Audio, duration });
            };
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        document.getElementById('btn-voice').classList.add('recording');
        playSound('click');
    } catch (err) {
        console.error('Mikrofon-Zugriff verweigert:', err);
        alert('Bitte erlaube den Zugriff auf dein Mikrofon für Sprachnachrichten.');
    }
}

function stopVoiceRecording() {
    if (!isRecording || !mediaRecorder) return;
    
    mediaRecorder.stop();
    isRecording = false;
    document.getElementById('btn-voice').classList.remove('recording');
    playSound('card');
}

async function startVoiceRecordingRoom() {
    if (isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                const base64Audio = reader.result;
                const duration = Math.round(audioChunks.length / 10);
                socket.emit('voiceMessage', { audio: base64Audio, duration });
            };
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        document.getElementById('btn-voice-room').classList.add('recording');
        playSound('click');
    } catch (err) {
        console.error('Mikrofon-Zugriff verweigert:', err);
        alert('Bitte erlaube den Zugriff auf dein Mikrofon für Sprachnachrichten.');
    }
}

function stopVoiceRecordingRoom() {
    if (!isRecording || !mediaRecorder) return;
    
    mediaRecorder.stop();
    isRecording = false;
    document.getElementById('btn-voice-room').classList.remove('recording');
    playSound('card');
}

// === 4. GAME ===
socket.on('gameState', (data) => {
    myData = data;
    selectedIndices = [];
    
    // Bestimme mein Team
    if (data.playersView && data.playersView[0]) {
        myTeam = data.playersView[0].team;
    }
    
    showScreen('screen-game');
    
    // Update Team Headers
    updateTeamHeaders();
    
    renderTable(data.table);
    renderHand(data.myHand);
    renderOpponents(data.playersView, data.activeId, data.mode);
    updateScoreBoard(data.history, data.totals);
    
    const isMyTurn = data.playersView[0].id === data.activeId;
    updateActionHint(isMyTurn);
    
    startTimer(40);
    playSound('card');
});

socket.on('log', (msg) => {
    const ul = document.getElementById('game-log');
    const li = document.createElement('li');
    li.innerText = msg;
    ul.prepend(li);
    
    // Keep only last 20 messages
    while (ul.children.length > 20) {
        ul.removeChild(ul.lastChild);
    }
});

socket.on('gameAborted', (msg) => {
    alert(msg);
    backToMenu();
    playSound('error');
});

socket.on('matchEnded', (data) => {
    updateScoreBoard(data.history, data.totals);
    playSound('win');
});

socket.on('gameFinished', (data) => {
    const myTeam = myData.playersView[0].team || 1;
    const won = data.winner === myTeam;
    const points = data.totals[`team${myTeam}`] || 0;
    
    updateStatsAfterGame(won, points);
    
    const msg = won ? '🎉 Glückwunsch! Du hast gewonnen!' : '😔 Leider verloren. Nächstes Mal!';
    setTimeout(() => {
        alert(msg + `\n\nEndstand: Team 1: ${data.totals.team1} - Team 2: ${data.totals.team2}`);
    }, 500);
    
    playSound(won ? 'win' : 'error');
});

// === GAMEPLAY FUNCTIONS ===
function onTableClick(idx) {
    if (!myData || myData.playersView[0].id !== myData.activeId) return;
    
    if (selectedIndices.includes(idx)) {
        selectedIndices = selectedIndices.filter(i => i !== idx);
    } else {
        selectedIndices.push(idx);
    }
    renderTable(myData.table);
    playSound('click');
}

function onHandClick(idx) {
    if (!myData || myData.playersView[0].id !== myData.activeId) return;
    
    socket.emit('playCard', { cardIndex: idx, selectedIndices: selectedIndices });
    playSound('card');
}

// === RENDER FUNCTIONS ===
function renderTable(cards) {
    const div = document.getElementById('tisch-bereich');
    const hint = document.getElementById('table-empty-hint');
    
    div.innerHTML = '';
    
    if (cards.length === 0) {
        hint.classList.remove('hidden');
    } else {
        hint.classList.add('hidden');
        cards.forEach((k, i) => {
            let el = createCard(k);
            el.onclick = () => onTableClick(i);
            if (selectedIndices.includes(i)) {
                el.classList.add('selected');
            }
            div.appendChild(el);
        });
    }
}

function renderHand(cards) {
    const div = document.getElementById('hand-bottom');
    div.innerHTML = '';
    
    if (!cards || cards.length === 0) {
        div.innerHTML = '<div style="color: #a0a0a0; padding: 20px;">Keine Karten</div>';
        return;
    }
    
    cards.forEach((k, i) => {
        let el = createCard(k);
        el.onclick = () => onHandClick(i);
        el.style.cursor = 'pointer';
        div.appendChild(el);
    });
}

function renderOpponents(views, activeId, mode) {
    updateArea('area-bottom', 'name-bottom', views[0], activeId);

    if (views[1]) {
        updateArea('area-right', 'name-right', views[1], activeId, 'hand-right');
    }

    if (mode === '2v2' && views[2]) {
        updateArea('area-top', 'name-top', views[2], activeId, 'hand-top');
        document.querySelector('.top').style.visibility = 'visible';
    } else {
        document.querySelector('.top').style.visibility = 'hidden';
    }

    if (mode === '2v2' && views[3]) {
        updateArea('area-left', 'name-left', views[3], activeId, 'hand-left');
        document.querySelector('.left').style.visibility = 'visible';
    } else {
        document.querySelector('.left').style.visibility = 'hidden';
    }
}

function updateArea(areaId, nameId, player, activeId, handId) {
    const area = document.getElementById(areaId);
    const nameEl = document.getElementById(nameId);
    
    nameEl.innerText = player.name;
    
    if (player.id === activeId) {
        area.classList.add('active-turn');
        nameEl.innerText += ' 🎯';
    } else {
        area.classList.remove('active-turn');
    }

    if (handId) {
        const handDiv = document.getElementById(handId);
        handDiv.innerHTML = '';
        const count = player.handCount;
        
        for (let i = 0; i < Math.min(count, 6); i++) {
            let c = document.createElement('div');
            c.className = 'karte';
            c.style.background = 'linear-gradient(135deg, #1a73e8, #1557b0)';
            c.style.color = 'white';
            c.innerText = '🂠';
            handDiv.appendChild(c);
        }
        
        if (count > 6) {
            let more = document.createElement('div');
            more.style.color = '#a0a0a0';
            more.style.fontSize = '0.8rem';
            more.innerText = `+${count - 6}`;
            handDiv.appendChild(more);
        }
    }
}

function updateActionHint(isMyTurn) {
    const hint = document.getElementById('action-hint');
    if (isMyTurn) {
        hint.innerText = '✨ Du bist dran! Wähle eine Karte';
        hint.style.color = '#34a853';
    } else {
        hint.innerText = '⏳ Warte auf anderen Spieler...';
        hint.style.color = '#a0a0a0';
    }
}

function updateScoreBoard(history, totals) {
    const tbody = document.getElementById('sidebar-score-body');
    tbody.innerHTML = '';
    
    if (history && history.length > 0) {
        // Zeige nur die letzten 5 Runden
        const recentHistory = history.slice(-5);
        
        recentHistory.forEach(m => {
            let t1 = m.t1_tisch + m.t1_add + m.t1_pts;
            let t2 = m.t2_tisch + m.t2_add + m.t2_pts;
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${t1}</td><td>${t2}</td>`;
            tbody.appendChild(tr);
        });
        
        // Update Detail-Ansicht mit letzter Runde
        const lastMatch = history[history.length - 1];
        updateScoreDetails(lastMatch);
    }
    
    if (totals) {
        document.getElementById('sb-total-t1').innerText = totals.team1;
        document.getElementById('sb-total-t2').innerText = totals.team2;
    }
}

function updateScoreDetails(match) {
    if (!match) return;
    
    // Karten-Punkte
    document.getElementById('detail-cards-t1').innerText = match.t1_pts;
    document.getElementById('detail-cards-t2').innerText = match.t2_pts;
    
    // Meiste Karten
    document.getElementById('detail-most-t1').innerText = match.t1_add;
    document.getElementById('detail-most-t2').innerText = match.t2_add;
    
    // Sweeps
    document.getElementById('detail-sweeps-t1').innerText = match.t1_tisch;
    document.getElementById('detail-sweeps-t2').innerText = match.t2_tisch;
}

function updateTeamHeaders() {
    const t1Header = document.getElementById('team1-header');
    const t2Header = document.getElementById('team2-header');
    
    if (myTeam === 1) {
        t1Header.innerHTML = 'Mein Team ⭐';
        t1Header.classList.add('team-mine');
        t2Header.innerHTML = 'Gegner';
        t2Header.classList.remove('team-mine');
    } else if (myTeam === 2) {
        t2Header.innerHTML = 'Mein Team ⭐';
        t2Header.classList.add('team-mine');
        t1Header.innerHTML = 'Gegner';
        t1Header.classList.remove('team-mine');
    }
}

function startTimer(sec) {
    clearInterval(timerInterval);
    let t = sec;
    const display = document.getElementById('timer-display');
    const progress = document.getElementById('timer-progress');
    
    display.innerText = t;
    progress.style.width = '100%';
    
    timerInterval = setInterval(() => {
        t--;
        display.innerText = t;
        progress.style.width = ((t / sec) * 100) + '%';
        
        if (t <= 10 && t > 0) {
            playSound('click');
        }
        
        if (t <= 0) {
            clearInterval(timerInterval);
        }
    }, 1000);
}

function createCard(k) {
    let d = document.createElement('div');
    d.className = 'karte ' + (['♥', '♦'].includes(k.farbe) ? 'rot' : '');
    d.innerText = k.wert + k.farbe;
    return d;
}

// === STATISTICS ===
function showStats() {
    const stats = getStats();
    const winRate = stats.gamesPlayed > 0 
        ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) 
        : 0;
    
    document.getElementById('stat-games-played').innerText = stats.gamesPlayed;
    document.getElementById('stat-games-won').innerText = stats.gamesWon;
    document.getElementById('stat-win-rate').innerText = winRate + '%';
    document.getElementById('stat-total-points').innerText = stats.totalPoints;
    
    document.getElementById('modal-stats').classList.remove('hidden');
    playSound('click');
}

function closeStats() {
    document.getElementById('modal-stats').classList.add('hidden');
    playSound('click');
}

// === INITIALIZATION ===
window.addEventListener('load', () => {
    // Auto-focus on name input
    document.getElementById('player-name-input').focus();
    
    // Load sound preference
    const savedSound = localStorage.getItem('toplanet_sound');
    if (savedSound !== null) {
        soundEnabled = savedSound === 'true';
        document.getElementById('sound-toggle').innerText = soundEnabled ? '🔊' : '🔇';
    }
});

// Save sound preference
window.addEventListener('beforeunload', () => {
    localStorage.setItem('toplanet_sound', soundEnabled);
});
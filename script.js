// WICHTIG: Setze hier wieder deine Render-URL ein, wenn du es hochlädst!
// const SERVER_URL = 'https://dein-spiel.onrender.com';
const socket = io(); // Für localhost reicht leeres ()

let myData = null;
let selectedIndices = [];
let timerInterval = null;

// --- NAVIGATION ---
function showScreen(id) {
    document.querySelectorAll('.overlay, .main-layout').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// 1. LOGIN
function login() {
    const name = document.getElementById('player-name-input').value;
    if(name.trim()) socket.emit('login', name);
}
socket.on('loginSuccess', () => showScreen('screen-menu'));

// 2. HAUPTMENÜ
function showCreateGame() { showScreen('screen-create'); }
function backToMenu() { showScreen('screen-menu'); socket.emit('getRooms'); }

function createGame() {
    const name = document.getElementById('room-name-input').value;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if(name) socket.emit('createRoom', { name, mode });
}

function playVsBot() {
    socket.emit('startBotGame');
}

socket.on('roomList', (rooms) => {
    const ul = document.getElementById('room-list');
    ul.innerHTML = '';
    if(rooms.length === 0) {
        ul.innerHTML = '<li>Keine offenen Spiele. Erstelle eins!</li>';
    } else {
        rooms.forEach(r => {
            const li = document.createElement('li');
            li.innerHTML = `<span><b>${r.name}</b> (${r.mode}) - ${r.playerCount} Spieler</span> <button class="small-btn" onclick="joinRoom('${r.id}')">Beitreten</button>`;
            ul.appendChild(li);
        });
    }
});

function joinRoom(id) { socket.emit('joinRoom', id); }

// 3. WARTERAUM
socket.on('joinedRoom', (data) => {
    showScreen('screen-room');
    document.getElementById('room-title').innerText = (data.mode === '1v1') ? "1 vs 1 Lobby" : "2 vs 2 Lobby";
    
    // Start Button nur für Host
    const btn = document.getElementById('btn-start-game');
    if(data.isHost) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
});

function joinTeam(nr) { socket.emit('switchTeam', nr); }
function startGame() { socket.emit('startGame'); }
function leaveRoom() { socket.emit('leaveRoom'); backToMenu(); }

socket.on('roomUpdate', (room) => {
    // Teams anzeigen
    updateTeamList(1, room.players.filter(p=>p.team===1));
    updateTeamList(2, room.players.filter(p=>p.team===2));
    
    document.getElementById('room-status').innerText = `${room.players.length} Spieler anwesend`;
    
    // Prüfen ob Start möglich (für Host Visualisierung)
    // (Button ist eh nur für Host sichtbar)
});

function updateTeamList(nr, players) {
    const ul = document.getElementById('list-team-' + nr);
    ul.innerHTML = players.map(p => `<li>${p.name}</li>`).join('');
}

// 4. SPIEL
socket.on('gameState', (data) => {
    myData = data;
    selectedIndices = [];
    showScreen('screen-game');
    
    renderTable(data.table);
    renderHand(data.myHand);
    renderOpponents(data.playersView, data.activeId, data.mode);
    
    updateScoreBoard(data.history, data.totals);
    startTimer(40);
});

socket.on('log', (msg) => {
    const ul = document.getElementById('game-log');
    const li = document.createElement('li');
    li.innerText = msg;
    ul.prepend(li);
});

socket.on('gameAborted', (msg) => {
    alert(msg);
    backToMenu();
});

socket.on('matchEnded', (data) => {
    // Hier könnte man ein Overlay zeigen, wir updaten nur die Tabelle
    updateScoreBoard(data.history, data.totals);
});


// --- GAMEPLAY FUNKTIONEN ---

function onTableClick(idx) {
    if(selectedIndices.includes(idx)) selectedIndices = selectedIndices.filter(i=>i!==idx);
    else selectedIndices.push(idx);
    renderTable(myData.table);
}
function onHandClick(idx) {
    if(myData.playersView[0].id !== myData.activeId) return; // Nicht dran (Ich bin immer Index 0 in playersView)
    socket.emit('playCard', { cardIndex: idx, selectedIndices: selectedIndices });
}

// --- RENDER ---

function renderTable(cards) {
    const div = document.getElementById('tisch-bereich');
    div.innerHTML = '';
    cards.forEach((k, i) => {
        let el = createCard(k);
        el.onclick = () => onTableClick(i);
        if(selectedIndices.includes(i)) { el.style.border="3px solid #ffeb3b"; el.style.transform="translateY(-5px)"; }
        div.appendChild(el);
    });
}
function renderHand(cards) {
    const div = document.getElementById('hand-bottom');
    div.innerHTML = '';
    cards.forEach((k, i) => {
        let el = createCard(k);
        el.onclick = () => onHandClick(i);
        el.style.cursor="pointer";
        div.appendChild(el);
    });
}

function renderOpponents(views, activeId, mode) {
    // views[0] ist ICH. [1] ist Rechts. [2] ist Oben. [3] ist Links.
    
    // ICH
    updateArea('area-bottom', 'name-bottom', views[0], activeId);

    // RECHTS
    if(views[1]) updateArea('area-right', 'name-right', views[1], activeId, 'hand-right');

    if(mode === '2v2' && views[2]) {
        updateArea('area-top', 'name-top', views[2], activeId, 'hand-top');
        document.querySelector('.top').style.visibility = 'visible';
    } else {
        document.querySelector('.top').style.visibility = 'hidden';
    }

    if(mode === '2v2' && views[3]) {
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
    
    if(player.id === activeId) {
        area.classList.add('active-turn');
        nameEl.innerText += " (DRAN)";
    } else {
        area.classList.remove('active-turn');
    }

    if(handId) {
        const handDiv = document.getElementById(handId);
        handDiv.innerHTML = '';
        // Zeige Dummy Karten
        const count = player.handCount;
        for(let i=0; i<count; i++) {
             let c = document.createElement('div');
             c.className = 'karte'; c.style.background='#ddd'; c.innerText='🂠';
             if (i >= 3) c.classList.add('hidden'); // Bei vielen Karten nicht alle anzeigen um Platz zu sparen
             handDiv.appendChild(c);
        }
    }
}

function updateScoreBoard(history, totals) {
    const tbody = document.getElementById('sidebar-score-body');
    tbody.innerHTML = '';
    if(history) history.forEach(m => {
        let t1 = m.t1_tisch+m.t1_add+m.t1_pts;
        let t2 = m.t2_tisch+m.t2_add+m.t2_pts;
        let tr = document.createElement('tr');
        tr.innerHTML = `<td>${t1}</td><td>${t2}</td>`;
        tbody.appendChild(tr);
    });
    if(totals) {
        document.getElementById('sb-total-t1').innerText = totals.team1;
        document.getElementById('sb-total-t2').innerText = totals.team2;
    }
}

function startTimer(sec) {
    clearInterval(timerInterval);
    let t = sec;
    document.getElementById('timer-display').innerText = t;
    timerInterval = setInterval(() => {
        t--; document.getElementById('timer-display').innerText = t;
        if(t<=0) clearInterval(timerInterval);
    }, 1000);
}

function createCard(k) {
    let d = document.createElement('div');
    d.className = 'karte '+( ['♥','♦'].includes(k.farbe)?'rot':'schwarz');
    d.innerText = k.wert + k.farbe;
    return d;
}
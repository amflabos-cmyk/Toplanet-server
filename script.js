// WICHTIG: Ersetze die URL unten mit DEINER echten Adresse von Render!
// Das https:// muss davor stehen, aber kein Slash (/) am Ende.
const SERVER_URL = 'https://toplanet.onrender.com/'; 

const socket = io(SERVER_URL, { 
    transports: ['websocket', 'polling'] 
});
let myData = null;
let selectedIndices = [];
let timerInterval = null;

// Login
function joinGame() {
    const name = document.getElementById('player-name-input').value;
    if(name) {
        socket.emit('joinGame', name);
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
    }
}

function startGame(mode) { socket.emit('startGame', mode); }

socket.on('updateLobby', (data) => {
    const list = document.getElementById('player-list');
    list.innerHTML = data.names.map(n => `<li>${n}</li>`).join('');
    
    if(data.isHost) document.getElementById('mode-selection').classList.remove('hidden');
    else document.getElementById('mode-selection').classList.add('hidden');
});

// --- GAME ---

socket.on('log', (msg) => {
    const ul = document.getElementById('game-log');
    const li = document.createElement('li');
    li.innerText = msg;
    ul.prepend(li);
});

socket.on('gameState', (data) => {
    myData = data;
    selectedIndices = [];
    
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');

    renderTable(data.table);
    renderHand(data.myHand);
    setupOpponents(data.names, data.myPos, data.activePos, data.mode);
    
    // Tabelle in der Sidebar aktualisieren
    updateSidebarScore(data.history, data.totals);

    // Timer Neustarten
    startClientTimer(40); // 40 Sek Startwert
});

socket.on('gameAborted', (msg) => {
    alert(msg);
    location.reload();
});

// --- TIMER ---
function startClientTimer(seconds) {
    clearInterval(timerInterval);
    const display = document.getElementById('timer-display');
    let timeLeft = seconds;
    
    display.innerText = timeLeft;
    
    timerInterval = setInterval(() => {
        timeLeft--;
        display.innerText = timeLeft;
        if (timeLeft <= 0) clearInterval(timerInterval);
    }, 1000);
}

// --- INTERACTIONS ---
function onTableClick(idx) {
    if(selectedIndices.includes(idx)) selectedIndices = selectedIndices.filter(i => i!==idx);
    else selectedIndices.push(idx);
    renderTable(myData.table);
}

function onHandClick(idx) {
    if(myData.myPos !== myData.activePos) return;
    socket.emit('playCard', { cardIndex: idx, selectedIndices: selectedIndices });
}

// --- RENDERING ---
function updateSidebarScore(history, totals) {
    const tbody = document.getElementById('sidebar-score-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    if (history) {
        history.forEach((m, i) => {
            let ptsT1 = m.t1_tisch + m.t1_add + m.t1_pts;
            let ptsT2 = m.t2_tisch + m.t2_add + m.t2_pts;
            let tr = document.createElement('tr');
            tr.innerHTML = `<td>${ptsT1}</td><td>${ptsT2}</td>`;
            tbody.appendChild(tr);
        });
    }
    
    if (totals) {
        document.getElementById('sb-total-t1').innerText = totals.team1;
        document.getElementById('sb-total-t2').innerText = totals.team2;
    }
}

function renderTable(cards) {
    const div = document.getElementById('tisch-bereich');
    div.innerHTML = '';
    cards.forEach((k, i) => {
        let el = createCard(k);
        el.onclick = () => onTableClick(i);
        if(selectedIndices.includes(i)) {
            el.style.border = "3px solid #ffeb3b";
            el.style.transform = "translateY(-5px)";
        }
        div.appendChild(el);
    });
}

function renderHand(cards) {
    const div = document.getElementById('hand-bottom');
    div.innerHTML = '';
    cards.forEach((k, i) => {
        let el = createCard(k);
        el.onclick = () => onHandClick(i);
        el.style.cursor = "pointer";
        div.appendChild(el);
    });
}

function setupOpponents(names, myPos, activePos, mode) {
    const total = names.length;
    
    // Helfer für Highlighting
    const updateArea = (offset, areaId, nameId, handId) => {
        let targetIdx = (myPos + offset) % total;
        let isActive = (targetIdx === activePos);
        
        // Rahmen Leuchten
        const area = document.getElementById(areaId);
        if(isActive) area.classList.add('active-turn');
        else area.classList.remove('active-turn');

        document.getElementById(nameId).innerText = names[targetIdx];
        
        // Dummy Karten
        const handDiv = document.getElementById(handId);
        handDiv.innerHTML = '';
        let cardCount = (mode==='1v1') ? 6 : 3; // im 1v1 mehr anzeigen
        for(let i=0; i<cardCount; i++) {
            let c = document.createElement('div');
            c.className = 'karte'; c.style.background='#ddd'; c.innerText='🂠';
            handDiv.appendChild(c);
        }
    }

    // Ich selbst highlighten?
    const myArea = document.getElementById('area-bottom');
    if(myPos === activePos) myArea.classList.add('active-turn');
    else myArea.classList.remove('active-turn');

    if(mode === '1v1') {
        updateArea(1, 'area-right', 'name-right', 'hand-right'); 
        document.querySelector('.top').style.visibility = 'hidden';
        document.querySelector('.left').style.visibility = 'hidden';
    } else {
        updateArea(1, 'area-right', 'name-right', 'hand-right');
        updateArea(2, 'area-top', 'name-top', 'hand-top');
        updateArea(3, 'area-left', 'name-left', 'hand-left');
        document.querySelector('.top').style.visibility = 'visible';
        document.querySelector('.left').style.visibility = 'visible';
    }
}

function createCard(k) {
    let d = document.createElement('div');
    d.className = 'karte ' + (['♥','♦'].includes(k.farbe)?'rot':'schwarz');
    d.innerText = k.wert + k.farbe;
    return d;
}
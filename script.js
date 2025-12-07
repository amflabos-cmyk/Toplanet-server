const socket = io();
let myGameData = null;
let selectedTableIndices = [];

// --- LOGIN ---
function joinGame() {
    const name = document.getElementById('player-name-input').value;
    if (name.trim()) {
        socket.emit('joinGame', name);
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
    }
}

function startGame() { socket.emit('requestStartGame'); }

// --- SERVER EVENTS ---
socket.on('updatePlayerList', (names) => {
    const list = document.getElementById('player-list');
    if(list) {
        list.innerHTML = names.map(n => `<li>${n}</li>`).join('');
        document.getElementById('lobby-status').innerText = `${names.length} Spieler anwesend`;
    }
});

socket.on('readyToStart', () => {
    const btn = document.getElementById('start-game-btn');
    if(btn) btn.classList.remove('hidden');
});

// HIER KOMMEN DIE DATEN AN
socket.on('gameStateUpdate', (data) => {
    console.log("Daten erhalten:", data);
    myGameData = data;
    selectedTableIndices = [];

    // Screen wechseln
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');

    // Rendern mit Fehler-Check
    try {
        renderTable(data.table);
        renderMyHand(data.myHand);
        setupOpponents(data.playerNames, data.myPosition, data.activePlayerPosition);
        
        // Info wer dran ist
        const amITurn = (data.myPosition === data.activePlayerPosition);
        const turnInfo = document.getElementById('turn-info');
        if (amITurn) {
            turnInfo.innerText = "DU BIST DRAN!";
            turnInfo.style.color = "#00ff00";
            document.getElementById('name-bottom').style.color = "#00ff00";
        } else {
            const activeName = data.playerNames[data.activePlayerPosition];
            turnInfo.innerText = activeName + " ist dran...";
            turnInfo.style.color = "white";
            document.getElementById('name-bottom').style.color = "white";
        }

    } catch (e) {
        console.error("Fehler beim Anzeigen der Karten:", e);
    }
});

// --- AKTIONEN ---
function onTableCardClick(index) {
    if (selectedTableIndices.includes(index)) {
        selectedTableIndices = selectedTableIndices.filter(i => i !== index);
    } else {
        selectedTableIndices.push(index);
    }
    renderTable(myGameData.table);
}

function onHandCardClick(index) {
    if (myGameData.myPosition !== myGameData.activePlayerPosition) {
        alert("Warte bis du dran bist!");
        return;
    }
    socket.emit('playCard', { cardIndex: index, selectedTableIndices: selectedTableIndices });
}

// --- RENDERING ---
function renderTable(karten) {
    const div = document.getElementById('tisch-bereich');
    if (!div) return;
    div.innerHTML = '';
    karten.forEach((k, i) => {
        let el = createCardEl(k);
        el.onclick = () => onTableCardClick(i);
        if (selectedTableIndices.includes(i)) {
            el.style.border = "3px solid yellow";
            el.style.transform = "translateY(-5px)";
        }
        div.appendChild(el);
    });
}

function renderMyHand(karten) {
    const div = document.getElementById('hand-bottom');
    if (!div) return;
    div.innerHTML = '';
    
    if (!karten) { console.error("Keine Handkarten empfangen!"); return; }

    karten.forEach((k, i) => {
        let el = createCardEl(k);
        el.onclick = () => onHandCardClick(i);
        el.style.cursor = "pointer";
        el.onmouseover = () => el.style.transform = "translateY(-10px)";
        el.onmouseout = () => el.style.transform = "translateY(0)";
        div.appendChild(el);
    });

    const myName = myGameData.playerNames[myGameData.myPosition];
    document.getElementById('name-bottom').innerText = myName + " (ICH)";
}

function setupOpponents(names, myPos, activePos) {
    // Einfache Logik für 2 Spieler:
    if (names.length === 2) {
        const opponentIndex = (myPos + 1) % 2;
        updateOpponent('name-right', 'hand-right', names[opponentIndex], (activePos === opponentIndex));
        // Andere verstecken
        document.querySelector('.top').style.visibility = 'hidden';
        document.querySelector('.left').style.visibility = 'hidden';
    } else {
        // Logik für 4 Spieler
        let idx = (myPos + 1) % 4;
        updateOpponent('name-right', 'hand-right', names[idx], (activePos === idx));
        
        idx = (myPos + 2) % 4;
        updateOpponent('name-top', 'hand-top', names[idx], (activePos === idx));
        
        idx = (myPos + 3) % 4;
        updateOpponent('name-left', 'hand-left', names[idx], (activePos === idx));
        
        document.querySelector('.top').style.visibility = 'visible';
        document.querySelector('.left').style.visibility = 'visible';
    }
}

function updateOpponent(nameId, handId, name, isActive) {
    const el = document.getElementById(nameId);
    if(el) {
        el.innerText = name + (isActive ? " (DRAN)" : "");
        el.style.color = isActive ? "#00ff00" : "white";
    }
    const handDiv = document.getElementById(handId);
    if(handDiv) {
        handDiv.innerHTML = '';
        for(let i=0; i<3; i++) {
            let d = document.createElement('div');
            d.className = 'karte';
            d.style.background = '#ddd'; d.innerText = '🂠';
            handDiv.appendChild(d);
        }
    }
}

function createCardEl(k) {
    let div = document.createElement('div');
    div.className = 'karte ' + (['♥','♦'].includes(k.farbe) ? 'rot' : 'schwarz');
    div.innerText = k.wert + k.farbe;
    return div;
}
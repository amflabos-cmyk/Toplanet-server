const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname));

// --- DATEN ---
let players = {}; 
let playerIds = []; 
let gameMode = '1v1'; 
let gameActive = false;

// Spiel-Status
let deck = [];
let tableCards = [];
let hands = {}; 
let scores = {}; 
let activeIndex = 0; 
let lastCapturer = null;

// Turnier & Timer
let matchHistory = [];
let teamScores = { team1: 0, team2: 0 };
let turnTimer = null; // Variable für den Timeout
const TURN_TIME_LIMIT = 40; // Sekunden

const farben = ['♥', '♦', '♣', '♠'];
const werte = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if(gameActive) { socket.emit('log', "Spiel läuft bereits!"); return; }
        players[socket.id] = name;
        if(!playerIds.includes(socket.id)) playerIds.push(socket.id);
        io.emit('updateLobby', { names: Object.values(players), isHost: (playerIds[0] === socket.id) });
    });

    socket.on('startGame', (mode) => {
        if(playerIds[0] !== socket.id) return;
        if(mode === '1v1' && playerIds.length !== 2) return; 
        if(mode === '2v2' && playerIds.length !== 4) return; 

        gameMode = mode;
        playerIds = playerIds.slice(0, (mode==='1v1'?2:4));
        matchHistory = [];
        teamScores = { team1: 0, team2: 0 };
        startMatch();
    });

    socket.on('playCard', (data) => {
        if (!gameActive) return;
        handleMove(socket.id, data.cardIndex, data.selectedIndices);
    });
    
    socket.on('disconnect', () => {
        delete players[socket.id];
        playerIds = playerIds.filter(id => id !== socket.id);
        io.emit('updateLobby', { names: Object.values(players), isHost: (playerIds.length > 0) });

        if(gameActive) { 
            gameActive = false; 
            clearTimeout(turnTimer); // Timer stoppen
            hands = {}; tableCards = []; deck = [];
            io.emit('gameAborted', "Ein Spieler hat die Verbindung verloren."); 
        }
    });
});

// --- LOGIK ---

function startMatch() {
    gameActive = true;
    lastCapturer = null;
    activeIndex = Math.floor(Math.random() * playerIds.length);
    
    deckErstellen(); deckMischen();
    
    tableCards = []; hands = {}; scores = {};
    playerIds.forEach(id => scores[id] = { karten: [], sweeps: 0 });

    for(let i=0; i<4; i++) tableCards.push(deck.pop());
    dealHands();

    io.emit('log', `--- NEUES SPIEL ---`);
    broadcastState();
    startTurnTimer(); // Timer starten
}

function startTurnTimer() {
    clearTimeout(turnTimer); // Alten Timer löschen
    
    // Timer für den aktuellen Spieler starten
    turnTimer = setTimeout(() => {
        // ZEIT ABGELAUFEN!
        const currentPlayerId = playerIds[activeIndex];
        const playerName = players[currentPlayerId];
        console.log(`Zeit abgelaufen für ${playerName}`);
        
        // Automatischen Zug ausführen (Kleinste Karte abwerfen)
        autoPlayLowestCard(currentPlayerId);
        
    }, TURN_TIME_LIMIT * 1000);
}

function autoPlayLowestCard(socketId) {
    const hand = hands[socketId];
    if (!hand || hand.length === 0) return;

    // Suche Karte mit kleinster 'zahl' (1-14)
    let minIndex = 0;
    let minVal = 99;
    
    hand.forEach((k, idx) => {
        if (k.zahl < minVal) {
            minVal = k.zahl;
            minIndex = idx;
        }
    });

    // Nachricht an alle
    io.emit('log', `Zeit abgelaufen! ${players[socketId]} wirft kleinste Karte.`);
    
    // Zug ausführen (Abwerfen = leere selectedIndices)
    handleMove(socketId, minIndex, []);
}

function dealHands() {
    if (!gameActive) return;
    if(deck.length === 0) { endMatch(); return; }
    
    // Check disconnects
    if (playerIds.length < (gameMode === '1v1' ? 2 : 4)) return;
    
    playerIds.forEach(id => {
        hands[id] = [];
        for(let i=0; i<6; i++) if(deck.length>0) hands[id].push(deck.pop());
    });
    io.emit('log', 'Neue Karten.');
}

function handleMove(socketId, cardIdx, tableIndices) {
    if (!gameActive) return;
    if (playerIds[activeIndex] !== socketId) return;

    const hand = hands[socketId];
    if (!hand) return;
    const card = hand[cardIdx];
    const playerName = players[socketId];

    let isValid = false;
    let isCapture = false;

    if(!tableIndices || tableIndices.length === 0) {
        isValid = true; 
    } else {
        const chosen = tableIndices.map(i => tableCards[i]);
        if(istZugGueltig(card, chosen)) { isValid = true; isCapture = true; }
    }

    if(!isValid) return; 

    // Timer stoppen da Zug gemacht wurde
    clearTimeout(turnTimer);

    hand.splice(cardIdx, 1);
    
    if(isCapture) {
        const chosen = tableIndices.map(i => tableCards[i]);
        const idsToRemove = chosen.map(c => c.id);
        tableCards = tableCards.filter(c => !idsToRemove.includes(c.id));
        scores[socketId].karten.push(...chosen, card);
        lastCapturer = socketId;
        
        let msg = `${playerName} fängt ${chosen.length}.`;
        if(tableCards.length === 0) { scores[socketId].sweeps++; msg += " (SWEEP!)"; }
        io.emit('log', msg);
    } else {
        tableCards.push(card);
        io.emit('log', `${playerName} wirft ab.`);
    }

    activeIndex = (activeIndex + 1) % playerIds.length;

    const allEmpty = playerIds.every(id => hands[id] && hands[id].length === 0);
    if(allEmpty) {
        if(deck.length === 0 && lastCapturer && tableCards.length > 0) {
            scores[lastCapturer].karten.push(...tableCards);
            io.emit('log', `Rest an ${players[lastCapturer]}.`);
            tableCards = [];
        }
        dealHands(); 
    }
    
    broadcastState();
    
    // Neuen Timer für nächsten Spieler starten (außer Spiel ist vorbei)
    if (gameActive) startTurnTimer();
}

function endMatch() {
    if (!gameActive) return;
    clearTimeout(turnTimer); // Timer aus

    let stats = { t1_tisch:0, t1_add:0, t1_pts:0, t2_tisch:0, t2_add:0, t2_pts:0 };
    let t1_cards = [], t2_cards = [];
    let t1_sweeps = 0, t2_sweeps = 0;

    playerIds.forEach((id, idx) => {
        let isTeam1 = (gameMode==='1v1' && idx===0) || (gameMode==='2v2' && (idx===0 || idx===2));
        if (scores[id]) {
            if(isTeam1) { t1_cards.push(...scores[id].karten); t1_sweeps += scores[id].sweeps; } 
            else { t2_cards.push(...scores[id].karten); t2_sweeps += scores[id].sweeps; }
        }
    });

    stats.t1_tisch = t1_sweeps; stats.t2_tisch = t2_sweeps;
    stats.t1_pts = berechnePunkte(t1_cards); stats.t2_pts = berechnePunkte(t2_cards);
    if(t1_cards.length > t2_cards.length) stats.t1_add = 3; else if(t2_cards.length > t1_cards.length) stats.t2_add = 3;

    matchHistory.push(stats);
    teamScores.team1 += (stats.t1_tisch + stats.t1_add + stats.t1_pts);
    teamScores.team2 += (stats.t2_tisch + stats.t2_add + stats.t2_pts);

    io.emit('matchEnded', { history: matchHistory, totals: teamScores });

    if(teamScores.team1 >= 101 || teamScores.team2 >= 101) {
        let winner = teamScores.team1 >= 101 ? "Team 1" : "Team 2";
        io.emit('log', `ENDE! ${winner} gewinnt!`);
        gameActive = false; 
    } else {
        io.emit('log', "Nächstes Spiel in 10s...");
        setTimeout(() => { if (gameActive) startMatch(); }, 10000);
    }
}

function broadcastState() {
    if (!gameActive) return;
    playerIds.forEach((socketId, idx) => {
        if (hands[socketId]) {
            const viewData = {
                myHand: hands[socketId],
                table: tableCards,
                myPos: idx,
                activePos: activeIndex,
                names: playerIds.map(pid => players[pid]),
                mode: gameMode,
                history: matchHistory, // Sende Tabelle mit jedem Update für Sidebar
                totals: teamScores,
                timeLeft: TURN_TIME_LIMIT // Sende Zeitlimit für Client Visualisierung
            };
            io.to(socketId).emit('gameState', viewData);
        }
    });
}

function berechnePunkte(karten) {
    let p = 0;
    karten.forEach(k => {
        if(['10','J','Q','K','A'].includes(k.wert)) p++;
        if(k.wert==='10' && k.farbe==='♦') p++;
        if(k.wert==='2' && k.farbe==='♣') p++;
    });
    return p;
}
function istZugGueltig(k, tisch) { let z=[k.zahl]; if(k.wert==='A')z.push(11); return z.some(v=>canSum(v,tisch)); }
function canSum(t,p) { if(p.length===0)return true; let s=findeSubs(t,p); for(let sub of s){let ids=sub.map(x=>x.id); if(canSum(t,p.filter(x=>!ids.includes(x.id))))return true;} return false; }
function findeSubs(z,k) { let r=[]; function s(i,c,sum){if(sum===z){r.push(c);return;} if(sum>z||i>=k.length)return; let x=k[i],v=[x.zahl]; if(x.wert==='A')v.push(11); v.forEach(val=>s(i+1,[...c,x],sum+val)); s(i+1,c,sum);} s(0,[],0); return r; }
function deckErstellen() { deck=[]; for(let f of farben)for(let w of werte){let z=parseInt(w); if(w==="J")z=12;if(w==="Q")z=13;if(w==="K")z=14;if(w==="A")z=1; deck.push({farbe:f, wert:w, zahl:z, id:Math.random().toString(36).substr(2,9)});}}
function deckMischen() { for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}}

server.listen(3000, () => console.log('Server läuft.'));
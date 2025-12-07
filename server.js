const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname));

// --- DATEN & ZUSTAND ---
let players = {}; 
let playerOrder = []; 
let gameActive = false;

// Spiel-Daten
let deck = [];
let tableCards = [];
let hands = {}; 
let scores = {}; // Aktuelles Spiel: { socketId: { stapel: [], sweeps: 0 } }
let activePlayerIndex = 0; 
let lastCapturer = null; 

// Turnier-Daten (Punkte über mehrere Spiele hinweg)
let totalScores = {}; // { socketId: 14 }
let matchHistory = []; // Für die Tabelle
let roundNumber = 0; // 1 bis 4 (innerhalb eines Spiels)

const farben = ['♥', '♦', '♣', '♠'];
const werte = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

io.on('connection', (socket) => {
    console.log('Verbunden:', socket.id);

    socket.on('joinGame', (playerName) => {
        if (gameActive) return;
        players[socket.id] = playerName;
        if (!playerOrder.includes(socket.id)) playerOrder.push(socket.id);
        
        // Initiale Punkte 0 setzen
        if (!totalScores[socket.id]) totalScores[socket.id] = 0;

        io.emit('updatePlayerList', Object.values(players));
        if (playerOrder.length >= 2) io.emit('readyToStart', true);
    });

    socket.on('requestStartGame', () => {
        if (!gameActive && playerOrder.length >= 2) startNewGame();
    });

    socket.on('playCard', (data) => {
        handleMove(socket.id, data.cardIndex, data.selectedTableIndices);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        playerOrder = playerOrder.filter(id => id !== socket.id);
        io.emit('updatePlayerList', Object.values(players));
        if (gameActive) {
            gameActive = false;
            io.emit('gameAborted'); 
        }
    });
});

// --- SPIEL ABLAUF ---

function startNewGame() {
    gameActive = true;
    roundNumber = 0;
    
    // Zufälliger Startspieler rotiert normalerweise, hier einfachheitshalber Random
    activePlayerIndex = Math.floor(Math.random() * playerOrder.length);
    lastCapturer = null;
    
    deckErstellen();
    deckMischen();

    hands = {};
    scores = {};
    tableCards = [];

    // Reset Scores für dieses eine Spiel
    playerOrder.forEach(id => {
        scores[id] = { stapel: [], sweeps: 0 };
    });

    // Tisch austeilen
    for (let i = 0; i < 4; i++) tableCards.push(deck.pop());
    
    // Hände austeilen (Startet Runde 1)
    dealCardsToHands();
    
    broadcastGameState();
}

function dealCardsToHands() {
    roundNumber++;
    console.log(`Starte Runde ${roundNumber}`);
    
    playerOrder.forEach(id => {
        hands[id] = [];
        for (let i = 0; i < 6; i++) {
            if (deck.length > 0) hands[id].push(deck.pop());
        }
    });
}

function handleMove(socketId, cardIndex, selectedTableIndices) {
    const currentPlayerId = playerOrder[activePlayerIndex];
    if (socketId !== currentPlayerId) return; 

    const hand = hands[socketId];
    const playedCard = hand[cardIndex];

    // Validierung
    let moveValid = false;
    let capture = false;

    if (!selectedTableIndices || selectedTableIndices.length === 0) {
        moveValid = true; // Abwerfen
        capture = false;
    } else {
        const selectedCards = selectedTableIndices.map(i => tableCards[i]);
        if (istZugGueltig(playedCard, selectedCards)) {
            moveValid = true;
            capture = true;
        }
    }

    if (!moveValid) { broadcastGameState(); return; }

    // Ausführen
    hand.splice(cardIndex, 1);

    if (capture) {
        const selectedCards = selectedTableIndices.map(i => tableCards[i]);
        const selectedIds = selectedCards.map(k => k.id);
        tableCards = tableCards.filter(k => !selectedIds.includes(k.id));
        
        scores[socketId].stapel.push(...selectedCards, playedCard);
        lastCapturer = socketId;

        if (tableCards.length === 0) {
            scores[socketId].sweeps++; // Punkt für Sweep
        }
    } else {
        tableCards.push(playedCard);
    }

    // Nächster Spieler
    activePlayerIndex = (activePlayerIndex + 1) % playerOrder.length;

    // CHECK: Sind alle Hände leer?
    checkRoundEnd();
    
    broadcastGameState();
}

function checkRoundEnd() {
    // Prüfen ob JEDE Hand leer ist
    const allHandsEmpty = playerOrder.every(id => hands[id].length === 0);
    
    if (allHandsEmpty) {
        // Runde vorbei!
        
        // Muss abgeräumt werden? (Regel: Runde 2 oder Deck leer)
        // Vereinfachung: Wir räumen immer ab, wenn das Deck leer ist (Ende des Spiels)
        if (deck.length === 0) {
            if (lastCapturer && tableCards.length > 0) {
                scores[lastCapturer].stapel.push(...tableCards);
                tableCards = [];
            }
            endCurrentGame(); // Spiel zu Ende, Punkte zählen
        } else {
            // Neue Karten austeilen
            dealCardsToHands();
        }
    }
}

function endCurrentGame() {
    // Punkte berechnen
    let gameResult = {};
    let winnerId = null;
    let maxCards = 0;

    // 1. Karten zählen (Mehrheit)
    playerOrder.forEach(id => {
        if (scores[id].stapel.length > maxCards) maxCards = scores[id].stapel.length;
    });

    playerOrder.forEach(id => {
        let points = scores[id].sweeps; // Sweeps
        points += berechneKartenPunkte(scores[id].stapel); // Sonderkarten
        
        // Mehrheit? (+3 Punkte) - Achtung: Bei Gleichstand kriegt keiner Punkte
        // Hier vereinfacht: Wer die meisten hat kriegt sie.
        if (scores[id].stapel.length === maxCards) {
            // (Hier müsste man eigentlich Tie-Breaker prüfen)
            points += 3;
        }

        totalScores[id] += points; // Gesamttabelle updaten
    });

    // 101 Punkte Check
    let grandWinner = null;
    playerOrder.forEach(id => {
        if (totalScores[id] >= 101) grandWinner = players[id];
    });

    if (grandWinner) {
        io.emit('tournamentOver', grandWinner);
        gameActive = false;
    } else {
        // Nächstes Spiel starten (nach kurzer Pause)
        setTimeout(() => {
            startNewGame();
        }, 5000); // 5 Sekunden Zeit um Ergebnis zu sehen
    }
}

function broadcastGameState() {
    playerOrder.forEach((socketId, index) => {
        // Wir senden auch die Punkte mit, damit man sie anzeigen kann
        let currentPoints = 0;
        if(scores[socketId]) {
             currentPoints = scores[socketId].sweeps + berechneKartenPunkte(scores[socketId].stapel);
        }

        const data = {
            myHand: hands[socketId],
            table: tableCards,
            myPosition: index,
            activePlayerPosition: activePlayerIndex,
            playerNames: playerOrder.map(id => players[id]),
            myCurrentScore: currentPoints, // Live Punkte (ohne Mehrheit)
            myTotalScore: totalScores[socketId]
        };
        io.to(socketId).emit('gameStateUpdate', data);
    });
}

// --- HELPER ---

function berechneKartenPunkte(stapel) {
    let p = 0;
    stapel.forEach(k => {
        if(['10','J','Q','K','A'].includes(k.wert)) p++;
        if(k.wert==='10' && k.farbe==='♦') p++; 
        if(k.wert==='2' && k.farbe==='♣') p++;
    });
    return p;
}

function deckErstellen() {
    deck = [];
    for (let f of farben) {
        for (let w of werte) {
            let z = parseInt(w);
            if (w === "J") z = 12; else if (w === "Q") z = 13; else if (w === "K") z = 14; else if (w === "A") z = 1;
            deck.push({ farbe: f, wert: w, zahl: z, id: Math.random().toString(36).substr(2, 9) });
        }
    }
}

function deckMischen() {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

function istZugGueltig(karte, gewaehlteKarten) {
    let ziele = [karte.zahl];
    if (karte.wert === 'A') ziele.push(11);
    return ziele.some(ziel => kannAllesVerbrauchen(ziel, gewaehlteKarten));
}

function kannAllesVerbrauchen(ziel, pool) {
    if (pool.length === 0) return true;
    let subsets = findeAlleTeilmengenSumme(ziel, pool);
    for (let sub of subsets) {
        let subIds = sub.map(k => k.id);
        if (kannAllesVerbrauchen(ziel, pool.filter(k => !subIds.includes(k.id)))) return true;
    }
    return false;
}

function findeAlleTeilmengenSumme(ziel, karten) {
    let res = [];
    function s(i, curr, sum) {
        if (sum === ziel) { res.push(curr); return; }
        if (sum > ziel || i >= karten.length) return;
        let k = karten[i], vals = [k.zahl]; if (k.wert === 'A') vals.push(11);
        vals.forEach(v => s(i + 1, [...curr, k], sum + v));
        s(i + 1, curr, sum);
    }
    s(0, [], 0); return res;
}

server.listen(3000, () => console.log('SERVER LÄUFT!'));
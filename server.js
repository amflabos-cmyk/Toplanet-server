const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname));

// --- GLOBALE DATEN ---
// rooms[roomId] = { ...GameState ... }
let rooms = {}; 

const farben = ['♥', '♦', '♣', '♠'];
const werte = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// --- SERVER EVENTS ---

io.on('connection', (socket) => {
    
    // 1. Spieler Login (nur Name speichern am Socket)
    socket.on('login', (name) => {
        socket.playerName = name;
        socket.emit('loginSuccess');
        sendRoomList(socket); // Zeige ihm die Liste
    });

    // 2. Liste der Spiele anfordern
    socket.on('getRooms', () => sendRoomList(socket));

    // 3. Spiel erstellen
    socket.on('createRoom', (data) => {
        const roomId = "room_" + Math.random().toString(36).substr(2, 6);
        
        rooms[roomId] = createNewRoomState(roomId, data.name, data.mode, socket.id);
        
        joinRoomLogic(socket, roomId);
    });

    // 4. Spiel beitreten
    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) return;
        joinRoomLogic(socket, roomId);
    });

    // 5. Bot Spiel starten (Erstellt privaten Raum mit Computer)
    socket.on('startBotGame', () => {
        const roomId = "bot_" + socket.id;
        // Erstelle Raum (Privat)
        rooms[roomId] = createNewRoomState(roomId, "Training", "1v1", socket.id);
        rooms[roomId].isBotGame = true;
        
        joinRoomLogic(socket, roomId);
        
        // Füge Bot hinzu (Team 2)
        rooms[roomId].players.push({ id: "BOT", name: "Computer 🤖", team: 2 });
        
        // Starte direkt
        startGameLogic(roomId);
    });

    // 6. Team wechseln (im Warteraum)
    socket.on('switchTeam', (teamNr) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        const p = room.players.find(p => p.id === socket.id);
        if (p) {
            // Prüfen ob Team voll
            const countInTeam = room.players.filter(pl => pl.team === teamNr).length;
            const limit = (room.mode === '1v1') ? 1 : 2;
            
            if (countInTeam < limit) {
                p.team = teamNr;
                io.to(roomId).emit('roomUpdate', getRoomPublicData(room));
            }
        }
    });

    // 7. Spiel starten (Host)
    socket.on('startGame', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (rooms[roomId].host !== socket.id) return;
        
        // Check Spielerzahl
        const room = rooms[roomId];
        const t1 = room.players.filter(p => p.team === 1).length;
        const t2 = room.players.filter(p => p.team === 2).length;
        
        let ready = false;
        if (room.mode === '1v1' && t1===1 && t2===1) ready = true;
        if (room.mode === '2v2' && t1===2 && t2===2) ready = true;
        
        if (ready) startGameLogic(roomId);
    });

    // 8. Karte spielen
    socket.on('playCard', (data) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            handleMove(roomId, socket.id, data.cardIndex, data.selectedIndices);
        }
    });

    // 9. Raum verlassen / Disconnect
    socket.on('leaveRoom', () => leaveRoomLogic(socket));
    socket.on('disconnect', () => leaveRoomLogic(socket));
});

// --- RAUM VERWALTUNG ---

function createNewRoomState(id, name, mode, hostId) {
    return {
        id: id,
        name: name,
        mode: mode,
        host: hostId,
        players: [], // { id, name, team }
        gameActive: false,
        // Game State
        deck: [],
        tableCards: [],
        hands: {},
        scores: {},
        turnOrder: [],
        activeIndex: 0,
        lastCapturer: null,
        matchHistory: [],
        teamScores: { team1: 0, team2: 0 },
        turnTimer: null
    };
}

function joinRoomLogic(socket, roomId) {
    const room = rooms[roomId];
    if (room.gameActive) { socket.emit('log', "Spiel läuft schon!"); return; }
    
    socket.join(roomId);
    socket.roomId = roomId;

    // Team zuweisen (Auto-Fill)
    const t1 = room.players.filter(p => p.team === 1).length;
    const t2 = room.players.filter(p => p.team === 2).length;
    const limit = (room.mode === '1v1') ? 1 : 2;
    
    let team = 0;
    if (t1 < limit) team = 1;
    else if (t2 < limit) team = 2;

    room.players.push({ id: socket.id, name: socket.playerName, team: team });
    
    socket.emit('joinedRoom', { roomId: roomId, mode: room.mode, isHost: (room.host === socket.id) });
    io.to(roomId).emit('roomUpdate', getRoomPublicData(room));
    
    // Broadcast Liste an alle in Lobby aktualisieren
    broadcastRoomList();
}

function leaveRoomLogic(socket) {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    
    // Spieler entfernen
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomId);
    socket.roomId = null;

    if (room.players.length === 0 && !room.isBotGame) {
        // Raum löschen wenn leer
        delete rooms[roomId];
    } else {
        // Wenn Host geht -> neuer Host
        if (room.host === socket.id && room.players.length > 0) {
            room.host = room.players[0].id;
        }
        
        if (room.gameActive) {
            // Spiel abbrechen
            room.gameActive = false;
            clearTimeout(room.turnTimer);
            io.to(roomId).emit('gameAborted', "Ein Spieler hat den Raum verlassen.");
            // Reset Game State
            room.hands = {}; room.tableCards = []; room.deck = [];
        }
        
        io.to(roomId).emit('roomUpdate', getRoomPublicData(room));
    }
    broadcastRoomList();
}

function sendRoomList(socket) {
    // Filtere private Bot-Games und laufende Spiele raus
    const list = Object.values(rooms)
        .filter(r => !r.isBotGame && !r.gameActive)
        .map(r => ({ id: r.id, name: r.name, mode: r.mode, playerCount: r.players.length }));
    socket.emit('roomList', list);
}

function broadcastRoomList() {
    const list = Object.values(rooms)
        .filter(r => !r.isBotGame && !r.gameActive)
        .map(r => ({ id: r.id, name: r.name, mode: r.mode, playerCount: r.players.length }));
    io.emit('roomList', list);
}

function getRoomPublicData(room) {
    return {
        name: room.name,
        players: room.players,
        host: room.host,
        mode: room.mode
    };
}

// --- SPIEL LOGIK (Multi-Instanz fähig) ---

function startGameLogic(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameActive = true;
    room.matchHistory = [];
    room.teamScores = { team1: 0, team2: 0 };
    room.lastCapturer = null;

    // Reihenfolge festlegen (Team 1 Spieler A, Team 2 Spieler A, T1 B, T2 B)
    const t1p = room.players.filter(p => p.team === 1);
    const t2p = room.players.filter(p => p.team === 2);
    
    room.turnOrder = [];
    if (room.mode === '1v1') {
        room.turnOrder = [t1p[0].id, t2p[0].id];
    } else {
        room.turnOrder = [t1p[0].id, t2p[0].id, t1p[1].id, t2p[1].id];
    }
    
    // Zufälliger Startspieler
    room.activeIndex = Math.floor(Math.random() * room.turnOrder.length);
    
    startMatch(room);
}

function startMatch(room) {
    // Deck & Init
    deckErstellen(room);
    deckMischen(room);
    room.tableCards = [];
    room.hands = {};
    room.scores = {};
    room.players.forEach(p => room.scores[p.id] = { karten: [], sweeps: 0 });

    for(let i=0; i<4; i++) room.tableCards.push(room.deck.pop());
    dealHands(room);

    io.to(room.id).emit('log', `--- NEUES SPIEL ---`);
    broadcastGameState(room);
    startTurnTimer(room);
    
    // Falls Bot anfängt
    checkBotTurn(room);
}

function dealHands(room) {
    if (!room.gameActive) return;
    if (room.deck.length === 0) { endMatch(room); return; }
    
    room.turnOrder.forEach(id => {
        room.hands[id] = [];
        for(let i=0; i<6; i++) if(room.deck.length>0) room.hands[id].push(room.deck.pop());
    });
    io.to(room.id).emit('log', 'Neue Karten ausgeteilt.');
}

function handleMove(roomId, socketId, cardIdx, tableIndices) {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    
    const currentId = room.turnOrder[room.activeIndex];
    if (currentId !== socketId) return;

    const hand = room.hands[socketId];
    if (!hand) return;
    const card = hand[cardIdx];
    const player = room.players.find(p => p.id === socketId);
    
    // Validieren
    let isValid = false;
    let isCapture = false;
    
    if (!tableIndices || tableIndices.length === 0) {
        isValid = true;
    } else {
        const chosen = tableIndices.map(i => room.tableCards[i]);
        if (istZugGueltig(card, chosen)) { isValid = true; isCapture = true; }
    }

    if (!isValid) return;

    // Timer Reset
    clearTimeout(room.turnTimer);

    // Execute
    hand.splice(cardIdx, 1);
    if (isCapture) {
        const chosen = tableIndices.map(i => room.tableCards[i]);
        const idsToRemove = chosen.map(c => c.id);
        room.tableCards = room.tableCards.filter(c => !idsToRemove.includes(c.id));
        
        room.scores[socketId].karten.push(...chosen, card);
        room.lastCapturer = socketId;
        
        let msg = `${player.name} fängt ${chosen.length}.`;
        if (room.tableCards.length === 0) {
            room.scores[socketId].sweeps++;
            msg += " (SWEEP!)";
        }
        io.to(room.id).emit('log', msg);
    } else {
        room.tableCards.push(card);
        io.to(room.id).emit('log', `${player.name} wirft ab.`);
    }

    // Nächster
    room.activeIndex = (room.activeIndex + 1) % room.turnOrder.length;

    // Check Runde Ende
    const allEmpty = room.turnOrder.every(id => room.hands[id] && room.hands[id].length === 0);
    if (allEmpty) {
        if (room.deck.length === 0 && room.lastCapturer && room.tableCards.length > 0) {
            room.scores[room.lastCapturer].karten.push(...room.tableCards);
            const pName = room.players.find(p=>p.id===room.lastCapturer).name;
            io.to(room.id).emit('log', `Rest an ${pName}.`);
            room.tableCards = [];
        }
        dealHands(room);
    }

    broadcastGameState(room);
    
    if (room.gameActive) {
        startTurnTimer(room);
        checkBotTurn(room);
    }
}

// --- BOT LOGIK ---
function checkBotTurn(room) {
    if (!room.isBotGame) return;
    
    const currentId = room.turnOrder[room.activeIndex];
    if (currentId === "BOT") {
        // Simuliere Denkzeit
        setTimeout(() => {
            if (!room.gameActive) return;
            executeBotMove(room);
        }, 1500);
    }
}

function executeBotMove(room) {
    const hand = room.hands["BOT"];
    if (!hand || hand.length === 0) return;

    // Einfache KI: Suche ersten gültigen Fang, sonst kleinste Karte werfen
    let bestMove = { idx: 0, tableIndices: [] };
    let foundCapture = false;

    // 1. Suche Fang
    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        // Teste alle Teilmengen (einfache Version: Einzelne Karten + Summen Logik)
        // Um CPU zu sparen, prüfen wir hier nur einfache Matches
        // Für eine perfekte KI müssten wir den gleichen Teilmengen-Algorithmus nutzen.
        // Hier nutzen wir die Hilfsfunktion 'findeSubs'
        
        let ziel = [card.zahl]; if(card.wert==='A') ziel.push(11);
        
        // Prüfe ob irgendein Ziel erreichbar ist
        for (let z of ziel) {
            const subs = findeSubs(z, room.tableCards);
            if (subs.length > 0) {
                // Nimm den größten Sub (meiste Karten)
                const bestSub = subs.sort((a,b) => b.length - a.length)[0];
                const indices = bestSub.map(c => room.tableCards.indexOf(c));
                bestMove = { idx: i, tableIndices: indices };
                foundCapture = true;
                break;
            }
        }
        if (foundCapture) break;
    }

    // 2. Wenn kein Fang, kleinste Karte abwerfen
    if (!foundCapture) {
        let minVal = 99;
        hand.forEach((c, i) => {
            if (c.zahl < minVal) { minVal = c.zahl; bestMove.idx = i; }
        });
        bestMove.tableIndices = [];
    }

    handleMove(room.id, "BOT", bestMove.idx, bestMove.tableIndices);
}

// --- ENDE & HELFER ---

function endMatch(room) {
    clearTimeout(room.turnTimer);
    
    let stats = { t1_tisch:0, t1_add:0, t1_pts:0, t2_tisch:0, t2_add:0, t2_pts:0 };
    let t1_cards=[], t2_cards=[], t1_sweeps=0, t2_sweeps=0;

    room.players.forEach(p => {
        const sc = room.scores[p.id];
        if (sc) {
            if (p.team === 1) { t1_cards.push(...sc.karten); t1_sweeps += sc.sweeps; }
            else { t2_cards.push(...sc.karten); t2_sweeps += sc.sweeps; }
        }
    });

    stats.t1_tisch = t1_sweeps; stats.t2_tisch = t2_sweeps;
    stats.t1_pts = berechnePunkte(t1_cards); stats.t2_pts = berechnePunkte(t2_cards);
    if(t1_cards.length > t2_cards.length) stats.t1_add = 3; else if(t2_cards.length > t1_cards.length) stats.t2_add = 3;

    room.matchHistory.push(stats);
    room.teamScores.team1 += (stats.t1_tisch + stats.t1_add + stats.t1_pts);
    room.teamScores.team2 += (stats.t2_tisch + stats.t2_add + stats.t2_pts);

    io.to(room.id).emit('matchEnded', { history: room.matchHistory, totals: room.teamScores });

    if(room.teamScores.team1 >= 101 || room.teamScores.team2 >= 101) {
        let w = room.teamScores.team1 >= 101 ? "Team 1" : "Team 2";
        io.to(room.id).emit('log', `ENDE! ${w} gewinnt!`);
        room.gameActive = false;
    } else {
        io.to(room.id).emit('log', "Nächstes Spiel in 10s...");
        setTimeout(() => { if(room.gameActive) startMatch(room); }, 10000);
    }
}

function startTurnTimer(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = setTimeout(() => {
        const currentId = room.turnOrder[room.activeIndex];
        if (currentId === "BOT") return; // Bot hat eigenen Timer
        
        const player = room.players.find(p=>p.id===currentId);
        io.to(room.id).emit('log', `Zeit um! ${player.name} wirft ab.`);
        
        // Auto-Play
        const hand = room.hands[currentId];
        let minIdx=0, minVal=99;
        if(hand) hand.forEach((c,i)=>{ if(c.zahl<minVal){minVal=c.zahl; minIdx=i;} });
        handleMove(room.id, currentId, minIdx, []);
        
    }, 40000);
}

function broadcastGameState(room) {
    room.players.forEach(p => {
        if (p.id === "BOT") return;
        
        // Positionen relativ berechnen
        // Ich (p.id) bin immer Index 0 in meiner Ansicht.
        // Wir müssen herausfinden, wo die anderen relativ zu mir sitzen.
        
        const myIndexInOrder = room.turnOrder.indexOf(p.id);
        const myViewPos = [];
        
        // Wir bauen eine Liste [Ich, SpielerRechts, Partner, SpielerLinks]
        // basierend auf der turnOrder
        for(let i=0; i<room.turnOrder.length; i++) {
            let offset = (myIndexInOrder + i) % room.turnOrder.length;
            myViewPos.push(room.turnOrder[offset]);
        }
        
        // myViewPos[0] = Ich, [1] = Rechts, [2] = Oben, [3] = Links
        
        const viewData = {
            myHand: room.hands[p.id],
            table: room.tableCards,
            // Sende Infos wer wo sitzt (Namen und Kartenanzahl)
            playersView: myViewPos.map(pid => {
                const pl = room.players.find(x=>x.id===pid);
                return { 
                    name: pl ? pl.name : "Computer", 
                    handCount: room.hands[pid] ? room.hands[pid].length : 0,
                    id: pid
                };
            }),
            activeId: room.turnOrder[room.activeIndex],
            mode: room.mode,
            history: room.matchHistory,
            totals: room.teamScores
        };
        io.to(p.id).emit('gameState', viewData);
    });
}

// --- MATH --- (Identisch wie zuvor, nur angepasst auf Parameter)
function deckErstellen(room) { room.deck=[]; for(let f of farben)for(let w of werte){let z=parseInt(w);if(w==="J")z=12;if(w==="Q")z=13;if(w==="K")z=14;if(w==="A")z=1; room.deck.push({farbe:f,wert:w,zahl:z,id:Math.random().toString(36).substr(2,9)});}}
function deckMischen(room) { for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}}
function berechnePunkte(k){let p=0;k.forEach(x=>{if(['10','J','Q','K','A'].includes(x.wert))p++;if(x.wert==='10'&&x.farbe==='♦')p++;if(x.wert==='2'&&x.farbe==='♣')p++;});return p;}
function istZugGueltig(k,t){let z=[k.zahl];if(k.wert==='A')z.push(11);return z.some(v=>canSum(v,t));}
function canSum(t,p){if(p.length===0)return true;let s=findeSubs(t,p);for(let sub of s){let i=sub.map(x=>x.id);if(canSum(t,p.filter(x=>!i.includes(x.id))))return true;}return false;}
function findeSubs(z,k){let r=[];function s(i,c,u){if(u===z){r.push(c);return;}if(u>z||i>=k.length)return;let x=k[i],v=[x.zahl];if(x.wert==='A')v.push(11);v.forEach(val=>s(i+1,[...c,x],u+val));s(i+1,c,u);}s(0,[],0);return r;}

server.listen(3000, () => console.log('Server läuft.'));
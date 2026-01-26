const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname));

// === CONFIGURATION ===
const PORT = process.env.PORT || 3000;
const farben = ['♥', '♦', '♣', '♠'];
const werte = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// === GLOBAL STATE ===
let rooms = {};
let connectedPlayers = {}; // socketId -> { name, lastRoom }

// === SOCKET CONNECTION ===
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // === 1. LOGIN ===
    socket.on('login', (name) => {
        socket.playerName = name;
        connectedPlayers[socket.id] = { name, lastRoom: null };
        socket.emit('loginSuccess');
        sendRoomList(socket);
        console.log(`${name} logged in`);
    });

    // === 2. ROOM MANAGEMENT ===
    socket.on('getRooms', () => sendRoomList(socket));

    socket.on('createRoom', (data) => {
        const roomId = "room_" + Math.random().toString(36).substr(2, 6);
        rooms[roomId] = createNewRoomState(roomId, data.name, data.mode, socket.id);
        joinRoomLogic(socket, roomId);
        broadcastRoomList();
        console.log(`${socket.playerName} created room: ${roomId}`);
    });

    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            socket.emit('log', 'Raum nicht gefunden!');
            return;
        }
        joinRoomLogic(socket, roomId);
    });

    socket.on('startBotGame', (difficulty = 'medium') => {
        const roomId = "bot_" + socket.id;
        rooms[roomId] = createNewRoomState(roomId, "Training", "1v1", socket.id);
        rooms[roomId].isBotGame = true;
        rooms[roomId].botDifficulty = difficulty;
        
        joinRoomLogic(socket, roomId);
        
        // Add bot to team 2
        rooms[roomId].players.push({ 
            id: "BOT", 
            name: `🤖 Bot (${difficulty})`, 
            team: 2 
        });
        
        startGameLogic(roomId);
        console.log(`${socket.playerName} started bot game (${difficulty})`);
    });

    // === 3. TEAM MANAGEMENT ===
    socket.on('switchTeam', (teamNr) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        const p = room.players.find(p => p.id === socket.id);
        if (!p) return;
        
        const countInTeam = room.players.filter(pl => pl.team === teamNr).length;
        const limit = room.mode === '1v1' ? 1 : 2;
        
        if (countInTeam < limit) {
            p.team = teamNr;
            io.to(roomId).emit('roomUpdate', getRoomPublicData(room));
        }
    });

    // === 4. GAME START ===
    socket.on('startGame', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        if (rooms[roomId].host !== socket.id) return;
        
        const room = rooms[roomId];
        const t1 = room.players.filter(p => p.team === 1).length;
        const t2 = room.players.filter(p => p.team === 2).length;
        
        let ready = false;
        if (room.mode === '1v1' && t1 === 1 && t2 === 1) ready = true;
        if (room.mode === '2v2' && t1 === 2 && t2 === 2) ready = true;
        
        if (ready) {
            startGameLogic(roomId);
        } else {
            socket.emit('log', 'Teams nicht vollständig!');
        }
    });

    // === 5. GAMEPLAY ===
    socket.on('playCard', (data) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            handleMove(roomId, socket.id, data.cardIndex, data.selectedIndices);
        }
    });

    // === 6. CHAT ===
    socket.on('chatMessage', (msg) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            io.to(roomId).emit('chatMessage', {
                sender: socket.playerName,
                message: msg,
                timestamp: Date.now()
            });
        }
    });

    socket.on('gameChatMessage', (msg) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].gameActive) {
            io.to(roomId).emit('gameChatMessage', {
                sender: socket.playerName,
                message: msg,
                timestamp: Date.now()
            });
        }
    });

    socket.on('voiceMessage', (data) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            io.to(roomId).emit('voiceMessage', {
                sender: socket.playerName,
                audioUrl: data.audio,
                duration: data.duration,
                timestamp: Date.now()
            });
        }
    });

    socket.on('gameVoiceMessage', (data) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].gameActive) {
            io.to(roomId).emit('gameVoiceMessage', {
                sender: socket.playerName,
                audioUrl: data.audio,
                duration: data.duration,
                timestamp: Date.now()
            });
        }
    });

    // === 7. DISCONNECT ===
    socket.on('leaveRoom', () => leaveRoomLogic(socket));
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        leaveRoomLogic(socket);
        delete connectedPlayers[socket.id];
    });
});

// === ROOM FUNCTIONS ===
function createNewRoomState(id, name, mode, hostId) {
    return {
        id,
        name,
        mode,
        host: hostId,
        players: [],
        gameActive: false,
        isBotGame: false,
        botDifficulty: 'medium',
        deck: [],
        tableCards: [],
        hands: {},
        scores: {},
        turnOrder: [],
        activeIndex: 0,
        lastCapturer: null,
        matchHistory: [],
        teamScores: { team1: 0, team2: 0 },
        turnTimer: null,
        createdAt: Date.now()
    };
}

function joinRoomLogic(socket, roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    if (room.gameActive) {
        socket.emit('log', 'Spiel läuft bereits!');
        return;
    }
    
    socket.join(roomId);
    socket.roomId = roomId;
    
    if (connectedPlayers[socket.id]) {
        connectedPlayers[socket.id].lastRoom = roomId;
    }
    
    const t1 = room.players.filter(p => p.team === 1).length;
    const t2 = room.players.filter(p => p.team === 2).length;
    const limit = room.mode === '1v1' ? 1 : 2;
    
    let team = 0;
    if (t1 < limit) team = 1;
    else if (t2 < limit) team = 2;

    room.players.push({ 
        id: socket.id, 
        name: socket.playerName, 
        team: team 
    });
    
    socket.emit('joinedRoom', { 
        roomId, 
        mode: room.mode, 
        isHost: room.host === socket.id 
    });
    
    io.to(roomId).emit('roomUpdate', getRoomPublicData(room));
    io.to(roomId).emit('chatMessage', {
        sender: 'System',
        message: `${socket.playerName} ist beigetreten! 👋`,
        timestamp: Date.now()
    });
    
    broadcastRoomList();
}

function leaveRoomLogic(socket) {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const playerName = socket.playerName;
    
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomId);
    socket.roomId = null;

    if (room.players.length === 0 && !room.isBotGame) {
        delete rooms[roomId];
        console.log(`Room deleted: ${roomId}`);
    } else {
        if (room.host === socket.id && room.players.length > 0) {
            room.host = room.players[0].id;
        }
        
        if (room.gameActive) {
            room.gameActive = false;
            clearTimeout(room.turnTimer);
            io.to(roomId).emit('gameAborted', `${playerName} hat das Spiel verlassen.`);
            resetGameState(room);
        }
        
        io.to(roomId).emit('roomUpdate', getRoomPublicData(room));
        io.to(roomId).emit('chatMessage', {
            sender: 'System',
            message: `${playerName} hat den Raum verlassen. 👋`,
            timestamp: Date.now()
        });
    }
    
    broadcastRoomList();
}

function sendRoomList(socket) {
    const list = Object.values(rooms)
        .filter(r => !r.isBotGame && !r.gameActive)
        .map(r => ({ 
            id: r.id, 
            name: r.name, 
            mode: r.mode, 
            playerCount: r.players.length 
        }));
    socket.emit('roomList', list);
}

function broadcastRoomList() {
    const list = Object.values(rooms)
        .filter(r => !r.isBotGame && !r.gameActive)
        .map(r => ({ 
            id: r.id, 
            name: r.name, 
            mode: r.mode, 
            playerCount: r.players.length 
        }));
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

function resetGameState(room) {
    room.deck = [];
    room.tableCards = [];
    room.hands = {};
    room.scores = {};
    room.turnOrder = [];
    room.activeIndex = 0;
    room.matchHistory = [];
    room.teamScores = { team1: 0, team2: 0 };
}

// === GAME LOGIC ===
function startGameLogic(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameActive = true;
    room.matchHistory = [];
    room.teamScores = { team1: 0, team2: 0 };
    room.lastCapturer = null;

    const t1p = room.players.filter(p => p.team === 1);
    const t2p = room.players.filter(p => p.team === 2);
    
    room.turnOrder = [];
    if (room.mode === '1v1') {
        room.turnOrder = [t1p[0].id, t2p[0].id];
    } else {
        room.turnOrder = [t1p[0].id, t2p[0].id, t1p[1].id, t2p[1].id];
    }
    
    room.activeIndex = Math.floor(Math.random() * room.turnOrder.length);
    
    startMatch(room);
    console.log(`Game started in room: ${roomId}`);
}

function startMatch(room) {
    deckErstellen(room);
    deckMischen(room);
    
    room.tableCards = [];
    room.hands = {};
    room.scores = {};
    
    room.players.forEach(p => {
        room.scores[p.id] = { karten: [], sweeps: 0 };
    });

    for (let i = 0; i < 4; i++) {
        room.tableCards.push(room.deck.pop());
    }
    
    dealHands(room);
    
    io.to(room.id).emit('log', `🎮 Neues Match gestartet!`);
    broadcastGameState(room);
    startTurnTimer(room);
    
    checkBotTurn(room);
}

function dealHands(room) {
    if (!room.gameActive) return;
    
    if (room.deck.length === 0) {
        endMatch(room);
        return;
    }
    
    room.turnOrder.forEach(id => {
        room.hands[id] = [];
        for (let i = 0; i < 6; i++) {
            if (room.deck.length > 0) {
                room.hands[id].push(room.deck.pop());
            }
        }
    });
    
    io.to(room.id).emit('log', '🎴 Neue Karten ausgeteilt.');
}

function handleMove(roomId, socketId, cardIdx, tableIndices) {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    
    const currentId = room.turnOrder[room.activeIndex];
    if (currentId !== socketId) return;

    const hand = room.hands[socketId];
    if (!hand || cardIdx >= hand.length) return;
    
    const card = hand[cardIdx];
    const player = room.players.find(p => p.id === socketId);
    
    let isValid = false;
    let isCapture = false;
    
    if (!tableIndices || tableIndices.length === 0) {
        isValid = true;
    } else {
        const chosen = tableIndices.map(i => room.tableCards[i]).filter(c => c);
        if (chosen.length > 0 && istZugGueltig(card, chosen)) {
            isValid = true;
            isCapture = true;
        }
    }

    if (!isValid) return;

    clearTimeout(room.turnTimer);

    hand.splice(cardIdx, 1);
    
    if (isCapture) {
        const chosen = tableIndices.map(i => room.tableCards[i]).filter(c => c);
        const idsToRemove = chosen.map(c => c.id);
        room.tableCards = room.tableCards.filter(c => !idsToRemove.includes(c.id));
        
        room.scores[socketId].karten.push(...chosen, card);
        room.lastCapturer = socketId;
        
        let msg = `${player.name} fängt ${chosen.length + 1} Karte(n)`;
        if (room.tableCards.length === 0) {
            room.scores[socketId].sweeps++;
            msg += " 🌟 SWEEP!";
        }
        io.to(room.id).emit('log', msg);
    } else {
        room.tableCards.push(card);
        io.to(room.id).emit('log', `${player.name} wirft ${card.wert}${card.farbe} ab.`);
    }

    room.activeIndex = (room.activeIndex + 1) % room.turnOrder.length;

    const allEmpty = room.turnOrder.every(id => 
        room.hands[id] && room.hands[id].length === 0
    );
    
    if (allEmpty) {
        if (room.deck.length === 0 && room.lastCapturer && room.tableCards.length > 0) {
            room.scores[room.lastCapturer].karten.push(...room.tableCards);
            const pName = room.players.find(p => p.id === room.lastCapturer).name;
            io.to(room.id).emit('log', `Restkarten gehen an ${pName}.`);
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

// === BOT AI ===
function checkBotTurn(room) {
    if (!room.isBotGame) return;
    
    const currentId = room.turnOrder[room.activeIndex];
    if (currentId === "BOT" && room.gameActive) {
        const delay = room.botDifficulty === 'easy' ? 2000 : 
                      room.botDifficulty === 'hard' ? 1000 : 1500;
        
        setTimeout(() => {
            if (!room.gameActive) return;
            executeBotMove(room);
        }, delay);
    }
}

function executeBotMove(room) {
    const hand = room.hands["BOT"];
    if (!hand || hand.length === 0) return;

    let bestMove = { idx: 0, tableIndices: [] };
    
    if (room.botDifficulty === 'easy') {
        bestMove = getBotMoveEasy(hand, room.tableCards);
    } else if (room.botDifficulty === 'hard') {
        bestMove = getBotMoveHard(hand, room.tableCards);
    } else {
        bestMove = getBotMoveMedium(hand, room.tableCards);
    }

    handleMove(room.id, "BOT", bestMove.idx, bestMove.tableIndices);
}

function getBotMoveEasy(hand, tableCards) {
    // Easy: Random valid move
    const randomIdx = Math.floor(Math.random() * hand.length);
    const card = hand[randomIdx];
    
    const ziel = [card.zahl];
    if (card.wert === 'A') ziel.push(11);
    
    for (let z of ziel) {
        const subs = findeSubs(z, tableCards);
        if (subs.length > 0) {
            const sub = subs[0];
            const indices = sub.map(c => tableCards.indexOf(c));
            return { idx: randomIdx, tableIndices: indices };
        }
    }
    
    return { idx: randomIdx, tableIndices: [] };
}

function getBotMoveMedium(hand, tableCards) {
    // Medium: Find any capture, prefer more cards
    let bestCapture = null;
    let maxCards = 0;
    
    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        const ziel = [card.zahl];
        if (card.wert === 'A') ziel.push(11);
        
        for (let z of ziel) {
            const subs = findeSubs(z, tableCards);
            for (let sub of subs) {
                if (sub.length > maxCards) {
                    maxCards = sub.length;
                    const indices = sub.map(c => tableCards.indexOf(c));
                    bestCapture = { idx: i, tableIndices: indices };
                }
            }
        }
    }
    
    if (bestCapture) return bestCapture;
    
    // No capture: play lowest card
    let minVal = 99;
    let minIdx = 0;
    hand.forEach((c, i) => {
        if (c.zahl < minVal) {
            minVal = c.zahl;
            minIdx = i;
        }
    });
    
    return { idx: minIdx, tableIndices: [] };
}

function getBotMoveHard(hand, tableCards) {
    // Hard: Strategic play
    // 1. Look for sweep opportunities
    // 2. Capture maximum points
    // 3. Consider value of cards
    
    let bestMove = null;
    let bestScore = -1;
    
    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        const ziel = [card.zahl];
        if (card.wert === 'A') ziel.push(11);
        
        for (let z of ziel) {
            const subs = findeSubs(z, tableCards);
            for (let sub of subs) {
                const indices = sub.map(c => tableCards.indexOf(c));
                
                // Calculate move score
                let score = sub.length * 10; // More cards = better
                
                // Bonus for sweep
                if (sub.length === tableCards.length) {
                    score += 100;
                }
                
                // Bonus for high-value cards
                const allCards = [...sub, card];
                allCards.forEach(c => {
                    if (['10', 'J', 'Q', 'K', 'A'].includes(c.wert)) score += 5;
                    if (c.wert === '10' && c.farbe === '♦') score += 10;
                    if (c.wert === '2' && c.farbe === '♣') score += 10;
                });
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = { idx: i, tableIndices: indices };
                }
            }
        }
    }
    
    if (bestMove) return bestMove;
    
    // No capture: play lowest non-point card
    let minVal = 99;
    let minIdx = 0;
    hand.forEach((c, i) => {
        const isPoint = ['10', 'J', 'Q', 'K', 'A'].includes(c.wert) ||
                       (c.wert === '2' && c.farbe === '♣');
        if (!isPoint && c.zahl < minVal) {
            minVal = c.zahl;
            minIdx = i;
        }
    });
    
    return { idx: minIdx, tableIndices: [] };
}

// === MATCH END ===
function endMatch(room) {
    clearTimeout(room.turnTimer);
    
    let stats = { 
        t1_tisch: 0, t1_add: 0, t1_pts: 0, 
        t2_tisch: 0, t2_add: 0, t2_pts: 0 
    };
    
    let t1_cards = [], t2_cards = [], t1_sweeps = 0, t2_sweeps = 0;

    room.players.forEach(p => {
        const sc = room.scores[p.id];
        if (sc) {
            if (p.team === 1) {
                t1_cards.push(...sc.karten);
                t1_sweeps += sc.sweeps;
            } else {
                t2_cards.push(...sc.karten);
                t2_sweeps += sc.sweeps;
            }
        }
    });

    stats.t1_tisch = t1_sweeps;
    stats.t2_tisch = t2_sweeps;
    stats.t1_pts = berechnePunkte(t1_cards);
    stats.t2_pts = berechnePunkte(t2_cards);
    
    if (t1_cards.length > t2_cards.length) stats.t1_add = 3;
    else if (t2_cards.length > t1_cards.length) stats.t2_add = 3;

    room.matchHistory.push(stats);
    room.teamScores.team1 += (stats.t1_tisch + stats.t1_add + stats.t1_pts);
    room.teamScores.team2 += (stats.t2_tisch + stats.t2_add + stats.t2_pts);

    io.to(room.id).emit('matchEnded', { 
        history: room.matchHistory, 
        totals: room.teamScores 
    });

    if (room.teamScores.team1 >= 101 || room.teamScores.team2 >= 101) {
        const winner = room.teamScores.team1 >= 101 ? 1 : 2;
        io.to(room.id).emit('log', `🏆 SPIEL ENDE! Team ${winner} gewinnt!`);
        io.to(room.id).emit('gameFinished', { 
            winner, 
            totals: room.teamScores 
        });
        room.gameActive = false;
    } else {
        io.to(room.id).emit('log', "⏳ Nächstes Match in 10s...");
        setTimeout(() => {
            if (room.gameActive) startMatch(room);
        }, 10000);
    }
}

function startTurnTimer(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = setTimeout(() => {
        const currentId = room.turnOrder[room.activeIndex];
        if (currentId === "BOT") return;
        
        const player = room.players.find(p => p.id === currentId);
        const hand = room.hands[currentId];
        
        if (!hand || hand.length === 0) return;
        
        io.to(room.id).emit('log', `⏰ Zeit abgelaufen! ${player.name} wirft kleinste Karte ab.`);
        
        let minIdx = 0;
        let minVal = 99;
        hand.forEach((c, i) => {
            if (c.zahl < minVal) {
                minVal = c.zahl;
                minIdx = i;
            }
        });
        
        handleMove(room.id, currentId, minIdx, []);
    }, 40000);
}

function broadcastGameState(room) {
    room.players.forEach(p => {
        if (p.id === "BOT") return;
        
        const myIndexInOrder = room.turnOrder.indexOf(p.id);
        const myViewPos = [];
        
        for (let i = 0; i < room.turnOrder.length; i++) {
            let offset = (myIndexInOrder + i) % room.turnOrder.length;
            myViewPos.push(room.turnOrder[offset]);
        }
        
        const viewData = {
            myHand: room.hands[p.id],
            table: room.tableCards,
            playersView: myViewPos.map(pid => {
                const pl = room.players.find(x => x.id === pid);
                return {
                    name: pl ? pl.name : "Bot",
                    handCount: room.hands[pid] ? room.hands[pid].length : 0,
                    id: pid,
                    team: pl ? pl.team : 2
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

// === CARD FUNCTIONS ===
function deckErstellen(room) {
    room.deck = [];
    for (let f of farben) {
        for (let w of werte) {
            let z = parseInt(w);
            if (w === "J") z = 12;
            if (w === "Q") z = 13;
            if (w === "K") z = 14;
            if (w === "A") z = 1;
            
            room.deck.push({
                farbe: f,
                wert: w,
                zahl: z,
                id: Math.random().toString(36).substr(2, 9)
            });
        }
    }
}

function deckMischen(room) {
    for (let i = room.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
    }
}

function berechnePunkte(k) {
    let p = 0;
    k.forEach(x => {
        if (['10', 'J', 'Q', 'K', 'A'].includes(x.wert)) p++;
        if (x.wert === '10' && x.farbe === '♦') p++;
        if (x.wert === '2' && x.farbe === '♣') p++;
    });
    return p;
}

function istZugGueltig(k, t) {
    let z = [k.zahl];
    if (k.wert === 'A') z.push(11);
    return z.some(v => canSum(v, t));
}

function canSum(t, p) {
    if (p.length === 0) return true;
    let s = findeSubs(t, p);
    for (let sub of s) {
        let i = sub.map(x => x.id);
        if (canSum(t, p.filter(x => !i.includes(x.id)))) return true;
    }
    return false;
}

function findeSubs(z, k) {
    let r = [];
    function s(i, c, u) {
        if (u === z) {
            r.push(c);
            return;
        }
        if (u > z || i >= k.length) return;
        let x = k[i];
        let v = [x.zahl];
        if (x.wert === 'A') v.push(11);
        v.forEach(val => s(i + 1, [...c, x], u + val));
        s(i + 1, c, u);
    }
    s(0, [], 0);
    return r;
}

// === CLEANUP ===
// Clean up old inactive rooms every hour
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    Object.keys(rooms).forEach(roomId => {
        const room = rooms[roomId];
        if (!room.gameActive && (now - room.createdAt) > oneHour) {
            delete rooms[roomId];
            console.log(`Cleaned up inactive room: ${roomId}`);
        }
    });
}, 60 * 60 * 1000);

// === START SERVER ===
server.listen(PORT, () => {
    console.log(`🎮 TopLanet Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
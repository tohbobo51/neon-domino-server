const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const botNames = ["Bot_Joko", "Bot_Siti", "Bot_Budi", "ProPlayer99"];

function generateCards() {
    // Generate 4 random cards (0-6) for Domino QiuQiu
    return [
        [Math.floor(Math.random()*7), Math.floor(Math.random()*7)],
        [Math.floor(Math.random()*7), Math.floor(Math.random()*7)],
        [Math.floor(Math.random()*7), Math.floor(Math.random()*7)],
        [Math.floor(Math.random()*7), Math.floor(Math.random()*7)]
    ];
}

function createBot() {
    return {
        id: 'bot_' + Math.random().toString(36).substr(2, 9),
        username: botNames[Math.floor(Math.random() * botNames.length)],
        chips: Math.floor(Math.random() * 500) + 100 + "M",
        isBot: true,
        isFolded: false,
        cards: generateCards()
    };
}

const defaultRooms = ['QIUQIU_BEGINNER', 'QIUQIU_PRO', 'GAPLE_VIP'];
defaultRooms.forEach(id => {
    rooms[id] = {
        id: id,
        state: 'WAITING', // WAITING, COUNTDOWN, PLAYING, FINISHED
        pot: 0,
        turnIndex: -1,
        seats: [createBot(), null, createBot(), null], // 4 Seats
        spectators: [],
        winner: null,
        countdown: 0
    };
});

// Game Loop
setInterval(() => {
    Object.values(rooms).forEach(room => {
        const activePlayers = room.seats.filter(p => p !== null);
        const playingPlayers = activePlayers.filter(p => !p.isFolded);
        
        if (room.state === 'WAITING' && activePlayers.length >= 2) {
            room.state = 'COUNTDOWN';
            room.countdown = 10;
            io.to(room.id).emit('room_update', JSON.stringify(room));
            io.to(room.id).emit('game_message', "Game dimulai dalam 10 detik...");
        }
        else if (room.state === 'COUNTDOWN') {
            room.countdown--;
            if (room.countdown <= 0) {
                room.state = 'PLAYING';
                room.pot = activePlayers.length * 10; // Ante
                room.winner = null;
                
                // Reset fold status & bagikan kartu baru
                room.seats.forEach(seat => {
                    if (seat) {
                        seat.isFolded = false;
                        seat.cards = generateCards();
                    }
                });
                
                let firstTurn = 0;
                while(room.seats[firstTurn] === null || room.seats[firstTurn].isFolded) { firstTurn = (firstTurn + 1) % 4; }
                room.turnIndex = firstTurn;
                
                io.to(room.id).emit('room_update', JSON.stringify(room));
                io.to(room.id).emit('game_message', "Taruhan Dimulai!");
            } else {
                io.to(room.id).emit('room_update', JSON.stringify(room));
            }
        }
        else if (room.state === 'PLAYING') {
            // Cek jika semua fold kecuali 1
            if (playingPlayers.length === 1) {
                room.state = 'FINISHED';
                room.turnIndex = -1;
                room.winner = playingPlayers[0].username;
                io.to(room.id).emit('game_message', `${room.winner} Menang (Semua Fold) ${room.pot}M!`);
                io.to(room.id).emit('room_update', JSON.stringify(room));
                
                setTimeout(() => {
                    room.pot = 0;
                    room.state = 'WAITING';
                    room.winner = null;
                    io.to(room.id).emit('room_update', JSON.stringify(room));
                }, 5000);
                return;
            }

            const currentPlayer = room.seats[room.turnIndex];
            
            if (currentPlayer && currentPlayer.isBot && !currentPlayer.isFolded) {
                const actions = ['CHECK', 'CALL', 'RAISE', 'FOLD'];
                // Bot lebih jarang fold
                const action = Math.random() > 0.85 ? 'FOLD' : actions[Math.floor(Math.random() * 3)];
                const amount = action === 'RAISE' ? Math.floor(Math.random() * 20) + 5 : 0;
                
                if (action === 'FOLD') {
                    currentPlayer.isFolded = true;
                } else if (action === 'RAISE' || action === 'CALL') {
                    room.pot += (amount || 5);
                }

                io.to(room.id).emit('action_broadcast', JSON.stringify({
                    username: currentPlayer.username,
                    action: action,
                    amount: amount
                }));
                
                // Next turn
                do {
                    room.turnIndex = (room.turnIndex + 1) % 4;
                } while (room.seats[room.turnIndex] === null || room.seats[room.turnIndex].isFolded);
                
                io.to(room.id).emit('room_update', JSON.stringify(room));
            }

            // Cek Win Condition (Showdown)
            if (room.pot > 150) {
                room.state = 'FINISHED';
                room.turnIndex = -1;
                const winner = playingPlayers[Math.floor(Math.random() * playingPlayers.length)];
                room.winner = winner.username;
                
                io.to(room.id).emit('game_message', `${winner.username} Menang Showdown ${room.pot}M!`);
                io.to(room.id).emit('room_update', JSON.stringify(room));
                
                setTimeout(() => {
                    room.pot = 0;
                    room.state = 'WAITING';
                    room.winner = null;
                    io.to(room.id).emit('room_update', JSON.stringify(room));
                }, 5000);
            }
        }
    });
}, 3000);

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        try {
            const { roomId, username } = JSON.parse(data);
            socket.join(roomId);
            socket.roomId = roomId;
            socket.username = username || `Guest_${Math.floor(Math.random()*1000)}`;
            
            if (!rooms[roomId]) {
                rooms[roomId] = { id: roomId, state: 'WAITING', pot: 0, turnIndex: -1, seats: Array(4).fill(null), spectators: [], winner: null, countdown: 0 };
            }
            
            rooms[roomId].spectators.push({ id: socket.id, username: socket.username });
            io.to(roomId).emit('room_update', JSON.stringify(rooms[roomId]));
        } catch(e) {}
    });

    socket.on('sit_down', (data) => {
        try {
            const { seatIndex, chips } = JSON.parse(data);
            const room = rooms[socket.roomId];
            
            if (room && seatIndex >= 0 && seatIndex < 4 && room.seats[seatIndex] === null) {
                room.spectators = room.spectators.filter(p => p.id !== socket.id);
                room.seats[seatIndex] = {
                    id: socket.id,
                    username: socket.username,
                    chips: chips,
                    isBot: false,
                    isFolded: false,
                    cards: generateCards()
                };
                io.to(socket.roomId).emit('room_update', JSON.stringify(room));
            }
        } catch(e) {}
    });

    socket.on('stand_up', () => {
        const room = rooms[socket.roomId];
        if (room) {
            for (let i = 0; i < 4; i++) {
                if (room.seats[i] && room.seats[i].id === socket.id) {
                    room.seats[i] = null;
                    room.spectators.push({ id: socket.id, username: socket.username });
                    
                    // Jika giliran dia, pindah giliran
                    if (room.turnIndex === i && room.state === 'PLAYING') {
                        do { room.turnIndex = (room.turnIndex + 1) % 4; } 
                        while (room.seats[room.turnIndex] === null || room.seats[room.turnIndex].isFolded);
                    }
                    break;
                }
            }
            io.to(socket.roomId).emit('room_update', JSON.stringify(room));
        }
    });

    socket.on('player_action', (data) => {
        try {
            const { action, amount } = JSON.parse(data);
            const room = rooms[socket.roomId];
            
            const currentPlayer = room.seats[room.turnIndex];
            if (room && room.state === 'PLAYING' && currentPlayer && currentPlayer.id === socket.id) {
                
                if (action === 'FOLD') {
                    currentPlayer.isFolded = true;
                } else if (action === 'RAISE' || action === 'CALL') {
                    room.pot += parseInt(amount || 0);
                }
                
                io.to(socket.roomId).emit('action_broadcast', JSON.stringify({
                    username: socket.username,
                    action: action,
                    amount: amount
                }));
                
                // Pindah giliran ke pemain yang tidak null dan tidak fold
                do { 
                    room.turnIndex = (room.turnIndex + 1) % 4; 
                } while (room.seats[room.turnIndex] === null || room.seats[room.turnIndex].isFolded);
                
                io.to(socket.roomId).emit('room_update', JSON.stringify(room));
            }
        } catch(e) {}
    });

    socket.on('disconnect', () => {
        const room = rooms[socket.roomId];
        if (room) {
            room.spectators = room.spectators.filter(p => p.id !== socket.id);
            for (let i = 0; i < 4; i++) {
                if (room.seats[i] && room.seats[i].id === socket.id) {
                    room.seats[i] = null;
                    if (room.turnIndex === i && room.state === 'PLAYING') {
                        do { room.turnIndex = (room.turnIndex + 1) % 4; } 
                        while (room.seats[room.turnIndex] === null || room.seats[room.turnIndex].isFolded);
                    }
                }
            }
            io.to(socket.roomId).emit('room_update', JSON.stringify(room));
        }
    });
});

app.get('/', (req, res) => res.send('Neon Domino Advanced Server V3 is Running! 🚀'));
server.listen(process.env.PORT || 3000, () => console.log(`SERVER RUNNING`));

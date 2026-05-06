const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const botNames = ["Bot_Joko", "Bot_Siti", "Bot_Budi", "Bot_Ayu", "ProPlayer99", "LuckyStrike"];

function createBot() {
    return {
        id: 'bot_' + Math.random().toString(36).substr(2, 9),
        username: botNames[Math.floor(Math.random() * botNames.length)],
        chips: Math.floor(Math.random() * 500) + 100 + "M",
        isBot: true,
        cards: [Math.floor(Math.random()*6), Math.floor(Math.random()*6)] // Dummy cards
    };
}

const defaultRooms = ['QIUQIU_BEGINNER', 'QIUQIU_PRO', 'GAPLE_VIP'];
defaultRooms.forEach(id => {
    rooms[id] = {
        id: id,
        state: 'WAITING', 
        pot: 0,
        turnIndex: -1,
        seats: [createBot(), null, createBot(), null, createBot(), null], // 6 Seats
        spectators: [],
        winner: null
    };
});

// Game Loop
setInterval(() => {
    Object.values(rooms).forEach(room => {
        const activePlayers = room.seats.filter(p => p !== null);
        
        if (room.state === 'WAITING' && activePlayers.length >= 2) {
            room.state = 'PLAYING';
            room.pot = activePlayers.length * 10;
            room.winner = null;
            
            // Tentukan giliran pertama
            let firstTurn = 0;
            while(room.seats[firstTurn] === null) { firstTurn++; }
            room.turnIndex = firstTurn;
            
            io.to(room.id).emit('room_update', JSON.stringify(room));
            io.to(room.id).emit('game_message', "Game Dimulai!");
        } 
        else if (room.state === 'PLAYING') {
            const currentPlayer = room.seats[room.turnIndex];
            
            if (currentPlayer && currentPlayer.isBot) {
                const actions = ['CHECK', 'CALL', 'RAISE'];
                const action = actions[Math.floor(Math.random() * actions.length)];
                const amount = action === 'RAISE' ? Math.floor(Math.random() * 20) + 5 : 0;
                
                if (action === 'RAISE' || action === 'CALL') room.pot += (amount || 5);

                io.to(room.id).emit('action_broadcast', JSON.stringify({
                    username: currentPlayer.username,
                    action: action,
                    amount: amount
                }));
                
                // Next turn
                do {
                    room.turnIndex = (room.turnIndex + 1) % 6;
                } while (room.seats[room.turnIndex] === null);
                
                io.to(room.id).emit('room_update', JSON.stringify(room));
            }

            // Cek Win Condition
            if (room.pot > 200) {
                room.state = 'FINISHED';
                room.turnIndex = -1; // Hentikan giliran
                const winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
                room.winner = winner.username;
                
                io.to(room.id).emit('game_message', `${winner.username} Menang ${room.pot}M!`);
                io.to(room.id).emit('room_update', JSON.stringify(room));
                
                setTimeout(() => {
                    room.pot = 0;
                    room.state = 'WAITING';
                    room.winner = null;
                    io.to(room.id).emit('room_update', JSON.stringify(room));
                }, 6000);
            }
        }
    });
}, 4000); // Diperlambat sedikit agar animasi UI terlihat

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        try {
            const { roomId, username } = JSON.parse(data);
            socket.join(roomId);
            socket.roomId = roomId;
            socket.username = username || `Guest_${Math.floor(Math.random()*1000)}`;
            
            if (!rooms[roomId]) {
                rooms[roomId] = { id: roomId, state: 'WAITING', pot: 0, turnIndex: -1, seats: Array(6).fill(null), spectators: [], winner: null };
            }
            
            rooms[roomId].spectators.push({ id: socket.id, username: socket.username });
            io.to(roomId).emit('room_update', JSON.stringify(rooms[roomId]));
        } catch(e) {}
    });

    socket.on('sit_down', (data) => {
        try {
            const { seatIndex, chips } = JSON.parse(data);
            const room = rooms[socket.roomId];
            
            if (room && seatIndex >= 0 && seatIndex < 6 && room.seats[seatIndex] === null) {
                room.spectators = room.spectators.filter(p => p.id !== socket.id);
                room.seats[seatIndex] = {
                    id: socket.id,
                    username: socket.username,
                    chips: chips,
                    isBot: false,
                    cards: [Math.floor(Math.random()*6), Math.floor(Math.random()*6)]
                };
                io.to(socket.roomId).emit('room_update', JSON.stringify(room));
                io.to(socket.roomId).emit('game_message', `${socket.username} duduk.`);
            }
        } catch(e) {}
    });

    socket.on('player_action', (data) => {
        try {
            const { action, amount } = JSON.parse(data);
            const room = rooms[socket.roomId];
            
            // Validasi apakah benar gilirannya
            const currentPlayer = room.seats[room.turnIndex];
            if (room && room.state === 'PLAYING' && currentPlayer && currentPlayer.id === socket.id) {
                if (action === 'RAISE' || action === 'CALL') room.pot += parseInt(amount || 0);
                
                io.to(socket.roomId).emit('action_broadcast', JSON.stringify({
                    username: socket.username,
                    action: action,
                    amount: amount
                }));
                
                do { room.turnIndex = (room.turnIndex + 1) % 6; } while (room.seats[room.turnIndex] === null);
                
                io.to(socket.roomId).emit('room_update', JSON.stringify(room));
            }
        } catch(e) {}
    });

    socket.on('disconnect', () => {
        const room = rooms[socket.roomId];
        if (room) {
            room.spectators = room.spectators.filter(p => p.id !== socket.id);
            for (let i = 0; i < 6; i++) {
                if (room.seats[i] && room.seats[i].id === socket.id) {
                    room.seats[i] = null;
                }
            }
            io.to(socket.roomId).emit('room_update', JSON.stringify(room));
        }
    });
});

app.get('/', (req, res) => res.send('Neon Domino Advanced Server V2 is Running! 🚀'));
server.listen(process.env.PORT || 3000, () => console.log(`SERVER RUNNING`));

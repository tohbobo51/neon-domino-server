const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Database Rooms
const rooms = {};

// Helper: Generate Bots
const botNames = ["Bot_Joko", "Bot_Siti", "Bot_Budi", "Bot_Ayu", "ProPlayer99", "LuckyStrike"];
function createBot() {
    return {
        id: 'bot_' + Math.random().toString(36).substr(2, 9),
        username: botNames[Math.floor(Math.random() * botNames.length)],
        chips: Math.floor(Math.random() * 500) + 100 + "M",
        isBot: true,
        cards: []
    };
}

// Inisialisasi beberapa room default
const defaultRooms = ['QIUQIU_BEGINNER', 'QIUQIU_PRO', 'GAPLE_VIP'];
defaultRooms.forEach(id => {
    rooms[id] = {
        id: id,
        state: 'WAITING', // WAITING, PLAYING, FINISHED
        pot: 0,
        turnIndex: 0,
        seats: [createBot(), createBot(), createBot(), null], // 3 Bot, 1 Kosong
        spectators: []
    };
});

// Game Loop (Berjalan setiap 3 detik untuk menggerakkan Bot)
setInterval(() => {
    Object.values(rooms).forEach(room => {
        const activePlayers = room.seats.filter(p => p !== null);
        
        if (room.state === 'WAITING' && activePlayers.length >= 2) {
            room.state = 'PLAYING';
            room.pot = activePlayers.length * 5; // Ante/Taruhan awal
            room.turnIndex = 0;
            io.to(room.id).emit('room_update', JSON.stringify(room));
            io.to(room.id).emit('game_message', "Game Dimulai!");
        } 
        else if (room.state === 'PLAYING') {
            // Cari giliran siapa sekarang
            const currentPlayer = room.seats[room.turnIndex];
            
            if (currentPlayer && currentPlayer.isBot) {
                // Logika Bot Bermain
                const actions = ['CHECK', 'CALL', 'RAISE'];
                const action = actions[Math.floor(Math.random() * actions.length)];
                const amount = action === 'RAISE' ? Math.floor(Math.random() * 20) + 5 : 0;
                
                if (action === 'RAISE' || action === 'CALL') room.pot += (amount || 5);

                io.to(room.id).emit('action_broadcast', JSON.stringify({
                    username: currentPlayer.username,
                    action: action,
                    amount: amount
                }));
                io.to(room.id).emit('room_update', JSON.stringify(room));
            }

            // Pindah giliran ke kursi berikutnya yang ada orangnya
            do {
                room.turnIndex = (room.turnIndex + 1) % 4;
            } while (room.seats[room.turnIndex] === null);

            // Simulasi game selesai setelah pot mencapai jumlah tertentu
            if (room.pot > 150) {
                room.state = 'FINISHED';
                const winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
                io.to(room.id).emit('game_message', `${winner.username} Menang ${room.pot}M!`);
                io.to(room.id).emit('room_update', JSON.stringify(room));
                
                // Reset game setelah 5 detik
                setTimeout(() => {
                    room.pot = 0;
                    room.state = 'WAITING';
                    io.to(room.id).emit('room_update', JSON.stringify(room));
                }, 5000);
            }
        }
    });
}, 3000);

io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    socket.on('join_room', (data) => {
        const { roomId, username } = JSON.parse(data);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username || `Guest_${Math.floor(Math.random()*1000)}`;
        
        if (!rooms[roomId]) {
            rooms[roomId] = { id: roomId, state: 'WAITING', pot: 0, turnIndex: 0, seats: [null, null, null, null], spectators: [] };
        }
        
        // Masuk sebagai penonton dulu
        rooms[roomId].spectators.push({ id: socket.id, username: socket.username });
        io.to(roomId).emit('room_update', JSON.stringify(rooms[roomId]));
        io.to(roomId).emit('game_message', `${socket.username} masuk sebagai penonton.`);
    });

    socket.on('sit_down', (data) => {
        const { seatIndex, chips } = JSON.parse(data);
        const room = rooms[socket.roomId];
        if (room && room.seats[seatIndex] === null) {
            // Hapus dari penonton
            room.spectators = room.spectators.filter(p => p.id !== socket.id);
            // Duduk di kursi
            room.seats[seatIndex] = {
                id: socket.id,
                username: socket.username,
                chips: chips,
                isBot: false
            };
            io.to(socket.roomId).emit('room_update', JSON.stringify(room));
            io.to(socket.roomId).emit('game_message', `${socket.username} duduk di kursi ${seatIndex + 1}.`);
        }
    });

    socket.on('player_action', (data) => {
        const { action, amount } = JSON.parse(data);
        const room = rooms[socket.roomId];
        if (room && room.state === 'PLAYING') {
            if (action === 'RAISE' || action === 'CALL') room.pot += parseInt(amount || 0);
            
            io.to(socket.roomId).emit('action_broadcast', JSON.stringify({
                username: socket.username,
                action: action,
                amount: amount
            }));
            
            // Pindah giliran
            do { room.turnIndex = (room.turnIndex + 1) % 4; } while (room.seats[room.turnIndex] === null);
            
            io.to(socket.roomId).emit('room_update', JSON.stringify(room));
        }
    });

    socket.on('disconnect', () => {
        const room = rooms[socket.roomId];
        if (room) {
            room.spectators = room.spectators.filter(p => p.id !== socket.id);
            for (let i = 0; i < 4; i++) {
                if (room.seats[i] && room.seats[i].id === socket.id) {
                    room.seats[i] = null; // Kosongkan kursi
                }
            }
            io.to(socket.roomId).emit('room_update', JSON.stringify(room));
        }
    });
});

app.get('/', (req, res) => res.send('Neon Domino Advanced Server is Running! 🚀'));
server.listen(process.env.PORT || 3000, () => console.log(`SERVER RUNNING`));

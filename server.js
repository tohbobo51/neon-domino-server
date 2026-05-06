const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Database sementara di memory (RAM)
const rooms = {};

io.on('connection', (socket) => {
    console.log(`[+] Player Connected: ${socket.id}`);

    // Pemain bergabung ke meja/room
    socket.on('join_room', (data) => {
        try {
            // Data bisa berupa string JSON dari Android
            const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { roomId, username, avatar, chips } = parsedData;

            socket.join(roomId);
            
            // Inisialisasi room jika belum ada
            if (!rooms[roomId]) {
                rooms[roomId] = {
                    id: roomId,
                    pot: 0,
                    status: 'WAITING', // WAITING, PLAYING
                    players: []
                };
            }

            // Tambahkan pemain ke room
            const newPlayer = {
                id: socket.id,
                username: username || `Guest_${Math.floor(Math.random() * 1000)}`,
                chips: chips || "100M",
                avatar: avatar || "default",
                isReady: false
            };
            
            rooms[roomId].players.push(newPlayer);
            socket.roomId = roomId; // Simpan roomId di object socket

            console.log(`[ROOM ${roomId}] ${newPlayer.username} joined.`);

            // Kirim update data meja ke SEMUA pemain di room tersebut
            io.to(roomId).emit('room_update', JSON.stringify(rooms[roomId]));
        } catch (e) {
            console.error("Error joining room:", e);
        }
    });

    // Pemain melakukan aksi (Fold, Call, Raise)
    socket.on('player_action', (data) => {
        try {
            const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { action, amount } = parsedData;
            const roomId = socket.roomId;
            
            if (roomId && rooms[roomId]) {
                console.log(`[ROOM ${roomId}] Player ${socket.id} did ${action} with amount ${amount}`);
                
                // Broadcast aksi pemain ke yang lain
                io.to(roomId).emit('action_broadcast', JSON.stringify({
                    playerId: socket.id,
                    action: action,
                    amount: amount
                }));
            }
        } catch (e) {
            console.error("Error player action:", e);
        }
    });

    // Pemain terputus (Disconnect / Keluar Aplikasi)
    socket.on('disconnect', () => {
        console.log(`[-] Player Disconnected: ${socket.id}`);
        const roomId = socket.roomId;
        
        if (roomId && rooms[roomId]) {
            // Hapus pemain dari room
            rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
            
            // Jika room kosong, hapus room
            if (rooms[roomId].players.length === 0) {
                delete rooms[roomId];
                console.log(`[ROOM ${roomId}] Deleted (Empty).`);
            } else {
                // Beritahu pemain lain bahwa ada yang keluar
                io.to(roomId).emit('room_update', JSON.stringify(rooms[roomId]));
            }
        }
    });
});

// Cek status server
app.get('/', (req, res) => {
    res.send('Neon Domino Server is Running! 🚀');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
    console.log(`=================================`);
});
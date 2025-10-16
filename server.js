const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Game rooms storage
const rooms = {};
const players = {};

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Store player info
    players[socket.id] = {
        id: socket.id,
        name: '',
        room: null,
        ready: false
    };

    // Handle player joining a room
    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;

        players[socket.id].name = playerName;
        players[socket.id].room = roomCode;

        // Create room if it doesn't exist
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: [],
                gameState: null,
                currentTurn: 0
            };
        }

        // Add player to room
        if (rooms[roomCode].players.length < 2) {
            rooms[roomCode].players.push(socket.id);
            socket.join(roomCode);

            // Notify room about new player
            io.to(roomCode).emit('playerJoined', {
                playerId: socket.id,
                playerName: playerName,
                totalPlayers: rooms[roomCode].players.length
            });

            // Start game if room is full
            if (rooms[roomCode].players.length === 2) {
                setTimeout(() => {
                    io.to(roomCode).emit('gameReady', {
                        players: rooms[roomCode].players.map(id => ({
                            id: id,
                            name: players[id].name
                        }))
                    });
                }, 1000);
            }
        } else {
            socket.emit('roomFull');
        }
    });

    // Handle game start
    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].players.includes(socket.id)) {
            // Initialize game state
            rooms[roomCode].gameState = {
                started: true,
                currentTurn: 0,
                playerStates: {}
            };

            // Notify all players in room
            io.to(roomCode).emit('gameStarted', {
                currentPlayer: rooms[roomCode].players[0]
            });
        }
    });

    // Handle card play
    socket.on('playCard', (data) => {
        const { roomCode, cardData } = data;

        if (rooms[roomCode]) {
            // Switch turn
            rooms[roomCode].currentTurn = 1 - rooms[roomCode].currentTurn;

            // Broadcast card play to all players in room
            socket.to(roomCode).emit('opponentPlayedCard', {
                playerId: socket.id,
                cardData: cardData,
                nextPlayer: rooms[roomCode].players[rooms[roomCode].currentTurn]
            });
        }
    });

    // Handle game update
    socket.on('gameUpdate', (data) => {
        const { roomCode, gameState } = data;

        if (rooms[roomCode]) {
            rooms[roomCode].gameState = { ...rooms[roomCode].gameState, ...gameState };
            socket.to(roomCode).emit('gameStateUpdate', gameState);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        const player = players[socket.id];
        if (player && player.room) {
            const roomCode = player.room;

            if (rooms[roomCode]) {
                // Remove player from room
                rooms[roomCode].players = rooms[roomCode].players.filter(id => id !== socket.id);

                // Notify other players
                socket.to(roomCode).emit('playerDisconnected', {
                    playerId: socket.id,
                    playerName: player.name
                });

                // Clean up empty rooms
                if (rooms[roomCode].players.length === 0) {
                    delete rooms[roomCode];
                }
            }
        }

        delete players[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

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

// Static files serve करने के लिए
app.use(express.static(path.join(__dirname)));

// Root route for serving the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'maths-nerds.html'));
});

// Game rooms को manage करने के लिए
const rooms = {};
const playerNames = {};

io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);

    // Room create करने के लिए
    socket.on('createRoom', (data) => {
        const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        const playerName = data.playerName || 'Player1';
        
        socket.join(roomCode);
        rooms[roomCode] = { 
            players: [{ id: socket.id, name: playerName }],
            gameState: null,
            isGameStarted: false
        };
        playerNames[socket.id] = playerName;
        
        socket.emit('roomCreated', { roomCode, playerName });
        console.log(`Room ${roomCode} created by ${playerName} (${socket.id})`);
    });

    // Room join करने के लिए
    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;
        
        if (rooms[roomCode] && rooms[roomCode].players.length < 2) {
            socket.join(roomCode);
            rooms[roomCode].players.push({ id: socket.id, name: playerName || 'Player2' });
            playerNames[socket.id] = playerName || 'Player2';
            
            socket.emit('joinedRoom', { roomCode, playerName: playerName || 'Player2' });
            
            // दूसरे player को notify करें
            socket.to(roomCode).emit('opponentJoined', { 
                playerId: socket.id, 
                playerName: playerName || 'Player2' 
            });
            
            console.log(`${playerName || 'Player2'} joined room: ${roomCode}`);

            // अगर room full हो गया तो game ready signal भेजें
            if (rooms[roomCode].players.length === 2) {
                const playersData = rooms[roomCode].players.map((player, index) => ({
                    id: player.id,
                    name: player.name,
                    playerNumber: index === 0 ? 'player1' : 'player2'
                }));
                
                io.to(roomCode).emit('gameReady', { players: playersData });
                console.log(`Game ready in room ${roomCode}`);
            }
        } else if (!rooms[roomCode]) {
            socket.emit('error', { message: 'Room does not exist' });
        } else {
            socket.emit('error', { message: 'Room is full' });
        }
    });

    // Game start करने के लिए
    socket.on('startGame', (data) => {
        const { roomCode, branches } = data;
        
        if (rooms[roomCode] && rooms[roomCode].players.length === 2) {
            rooms[roomCode].isGameStarted = true;
            rooms[roomCode].gameState = {
                currentPlayer: 'player1',
                branches: branches,
                gamePhase: 'draw'
            };
            
            io.to(roomCode).emit('gameStarted', {
                players: rooms[roomCode].players,
                gameState: rooms[roomCode].gameState
            });
            
            console.log(`Game started in room ${roomCode}`);
        }
    });

    // Game actions handle करने के लिए
    socket.on('gameAction', (data) => {
        const { roomCode, action, playerId } = data;
        
        if (rooms[roomCode] && rooms[roomCode].isGameStarted) {
            // Action को opponent को forward करें
            socket.to(roomCode).emit('opponentAction', {
                action: action,
                playerId: playerId
            });
            
            // Game state update करें if needed
            if (rooms[roomCode].gameState && action.type === 'TURN_END') {
                rooms[roomCode].gameState.currentPlayer = 
                    rooms[roomCode].gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
                
                io.to(roomCode).emit('turnChanged', {
                    currentPlayer: rooms[roomCode].gameState.currentPlayer
                });
            }
            
            console.log(`Action in room ${roomCode}:`, action.type);
        }
    });

    // Game state sync करने के लिए
    socket.on('syncGameState', (data) => {
        const { roomCode, gameState } = data;
        
        if (rooms[roomCode]) {
            rooms[roomCode].gameState = gameState;
            socket.to(roomCode).emit('gameStateUpdate', gameState);
        }
    });

    // Chat messages के लिए
    socket.on('chatMessage', (data) => {
        const { roomCode, message, playerName } = data;
        
        if (rooms[roomCode]) {
            io.to(roomCode).emit('chatMessage', {
                message: message,
                playerName: playerName,
                timestamp: Date.now()
            });
        }
    });

    // Player disconnect होने पर
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // सभी rooms check करें और player को remove करें
        for (let roomCode in rooms) {
            const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const playerName = rooms[roomCode].players[playerIndex].name;
                rooms[roomCode].players.splice(playerIndex, 1);
                
                // अगर room empty हो गया तो delete करें
                if (rooms[roomCode].players.length === 0) {
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} deleted (empty)`);
                } else {
                    // बाकी players को notify करें
                    socket.to(roomCode).emit('opponentDisconnected', {
                        playerName: playerName
                    });
                    console.log(`${playerName} left room ${roomCode}`);
                }
                break;
            }
        }
        
        delete playerNames[socket.id];
    });

    // Room की information के लिए
    socket.on('getRoomInfo', (roomCode) => {
        if (rooms[roomCode]) {
            socket.emit('roomInfo', {
                players: rooms[roomCode].players,
                isGameStarted: rooms[roomCode].isGameStarted
            });
        } else {
            socket.emit('error', { message: 'Room not found' });
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        rooms: Object.keys(rooms).length,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Maths Nerds Multiplayer Server running on port ${PORT}`);
    console.log(`🌐 Server ready to accept connections`);
});

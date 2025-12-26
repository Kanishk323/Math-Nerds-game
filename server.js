const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config(); // Load API key from .env file

// ============================================
// 🤖 GOOGLE GENERATIVE AI (GEMINI) SETUP
// ============================================
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'maths-nerds.html'));
});

const rooms = {};
const playerNames = {};

const branchEffects = {
  "Algebra": {
    pros: "Game start pe +5 Tokens milenge. Aapke Number cards +1 extra value denge.",
    cons: "Opponent ka base damage +2 zyada hoga."
  },
  "Geometry": {
    pros: "Game start pe +15 Player IP milega. Aapko pehle 3 turns ke liye +5 Block milega.",
    cons: "Aapke cards ki cost +1 token zyada hogi."
  },
  "Calculus": {
    pros: "Aapke 'Damage over Time' aur 'Heal over Time' effects 1 turn zyada chalenge.",
    cons: "Aapke starting hand mein 1 card kam hoga."
  },
  "Number Theory": {
    pros: "Aapko har turn +1 extra Token milta hai.",
    cons: "Aapke Number cards ka 10% chance hai ki woh 0 damage karein."
  },
  "Probability": {
    pros: "Sab random effects (jaise random damage) ki range 50% badh jayegi.",
    cons: "Har turn 1 IP lose karne ka 15% chance hai."
  },
  "Complex Analysis": {
    pros: "Invert aur Swap effects se aapko 10 IP heal hoga.",
    cons: "Invert ya Swap effects wale Theorem cards ki cost +2 tokens zyada hogi."
  },
  "Trigonometry": {
    pros: "Aapke paas ek Angle Slider hoga. Angle ko strategically set karke apne cards ko boost karo.",
    cons: "Opponent ke IP ko multiply/divide karne wale cards ka asar 25% zyada hoga."
  }
};

const allCards = [
  // Number Cards
  { name: 'Plus 5', icon: '➕5️⃣', type: 'Number', cost: 1, effect: 'direct_value_change', value: 5, target: 'opponent', description: 'Opponent ke IP ko 5 se kam karta hai.', summary: 'IP -5' },
  { name: 'Heal 10', icon: '❤️🩹', type: 'Number', cost: 2, effect: 'direct_value_change', value: 10, target: 'self', description: 'Apne IP ko 10 se badhata hai.', summary: 'Apna IP +10' },
  { name: 'Add 10', icon: '➕🔟', type: 'Number', cost: 2, effect: 'direct_value_change', value: 10, target: 'opponent', description: 'Opponent ke IP ko 10 se kam karta hai.', summary: 'IP -10' },
  
  // Action Cards
  { name: 'Multiply by 2', icon: '✖️2️⃣', type: 'Action', cost: 3, effect: 'multiply_ip', value: 2, target: 'opponent', description: 'Opponent ke IP ko 2 se multiply karta hai.', summary: 'Opponent IP x2' },
  { name: 'Divide by 2', icon: '➗2️⃣', type: 'Action', cost: 3, effect: 'divide_ip', value: 2, target: 'opponent', description: 'Opponent ke IP ko 2 se divide karta hai.', summary: 'Opponent IP /2' },
  { name: 'Square IP', icon: '²️⃣', type: 'Action', cost: 4, effect: 'square_ip', target: 'self', description: 'Apne IP ka square karta hai (e.g., 10 -> 100). High-risk self-buff.', summary: 'Self IP²' },
  { name: 'Draw Card', icon: '🃏', type: 'Action', cost: 1, effect: 'draw_card', value: 1, description: 'Ek extra card draw karta hai.', summary: '+1 Card' },
  { name: 'Token Chori', icon: '💸', type: 'Action', cost: 2, effect: 'steal_token', value: 2, target: 'opponent', description: 'Opponent se 2 tokens chori karta hai.', summary: 'Tokens -2 (Opponent)' },
  
  // Theorem Cards
  { name: 'Invert IP Sign', icon: '➖➕', type: 'Theorem', cost: 6, effect: 'invert_sign_ip', target: 'opponent', description: 'Opponent ke IP ka sign change karta hai (e.g., 80 -> -80).', summary: 'Opponent IP -> -IP' },
  { name: 'Swap IPs', icon: '🔄', type: 'Theorem', cost: 4, effect: 'swap_ips', branch: 'Complex Analysis', description: 'Apne IP ko opponent ke IP se swap karta hai.', summary: 'Swap IPs' },
  { name: 'Triangle Inequality', icon: '🔺', type: 'Theorem', cost: 5, effect: 'block_damage', branch: 'Geometry', value: 10, target: 'self', description: 'Apne next 10 damage ko block karta hai.', summary: 'Block 10 Damage' }
];

// ============================================
// 🤖 HYBRID CHATBOT FUNCTION
// ============================================

// Local rule-based response
function getBotResponse(message) {
  const normalize = (str) => str.toLowerCase()
    .replace(/['\".,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
    .replace(/\s+/g, ' ').trim();

  const normalizedMessage = normalize(message);

  // Search for card names
  for (const card of allCards) {
    const lowerCardName = card.name.toLowerCase();
    const searchTerms = [lowerCardName, lowerCardName.split('(')[0].trim()];
    const parenMatch = lowerCardName.match(/\((.*)\)/);
    if (parenMatch && parenMatch[1]) {
      searchTerms.push(parenMatch[1].replace(/\$/g, '').trim());
    }
    for (const term of searchTerms) {
      const normalizedTerm = normalize(term);
      if (normalizedTerm.length > 1 && normalizedMessage.includes(normalizedTerm)) {
        return `📋 ${card.name} (${card.type}): ${card.description} | Cost: ${card.cost} tokens`;
      }
    }
  }

  // Search for branch names
  for (const branchName in branchEffects) {
    const normalizedBranchName = normalize(branchName);
    if (normalizedMessage.includes(normalizedBranchName)) {
      const branch = branchEffects[branchName];
      return `🌳 ${branchName} Branch:\n✅ Pros: ${branch.pros}\n❌ Cons: ${branch.cons}`;
    }
  }

  // Keywords
  if (normalizedMessage.includes('rule') || normalizedMessage.includes('niyam')) {
    return "🎮 Game Objective: Apne opponent ke IP ko 0 tak kam karo! Har turn cards draw karo, tokens use karke play karo!";
  }
  if (normalizedMessage.includes('card type')) {
    return "🎴 Teen tarah ke cards: 1️⃣ Number 2️⃣ Action 3️⃣ Theorem";
  }
  if (normalizedMessage.includes('hello') || normalizedMessage.includes('hi') || normalizedMessage.includes('namaste')) {
    return "👋 Namaste! Main Math Bot hoon. Game ke rules, cards, ya branches ke baare mein kuch bhi pocho!";
  }

  // Return null if no local match found
  return null;
}

// ============================================
// 🤖 GOOGLE GENERATIVE AI FUNCTION
// ============================================
async function getGeminiResponse(message, gameContext = "") {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Tu ek smart in-game Math chatbot ho jo "Mathematical Card Battle Game - Maths Nerds" mein players ko help karta hai.

Game Context:
- IP (Intellectual Power) = player ki health like value
- Cards: Number (direct IP changes), Action (math transformations), Theorem (powerful effects)
- Branches: Algebra, Geometry, Calculus, Number Theory, Probability, Complex Analysis, Trigonometry
- Players apne opponent ke IP ko 0 tak kam karne ki koshish karte hain
${gameContext}

Player ka message: "${message}"

Guidelines:
✅ Hinglish mein friendly aur helpful jawab do (simple Hindi + English)
✅ Game context se relevant information use karo
✅ Agar card, branch ya rule ka sawaal hai to short explanation do
✅ General chat par bhi friendly reply do
✅ ONLY GAME CONTENT, real-world stuff mat lao
✅ Response 2-3 lines tak rakhna (concise hona)
❌ External websites ya real-world unrelated stuff mat suggest karna

Jawab directly do, koi "Bot says:" jaise prefix mat lagana.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    console.log(`✅ Gemini Response for "${message}": ${text.substring(0, 50)}...`);
    return text || null;
  } catch (err) {
    console.error("❌ Gemini Error:", err.message);
    return null;
  }
}

// ============================================
// SOCKET.IO CONNECTION
// ============================================
io.on('connection', (socket) => {
  console.log('✅ New user connected:', socket.id);

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
    console.log(`📍 Room ${roomCode} created by ${playerName}`);
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, playerName } = data;
    if (rooms[roomCode] && rooms[roomCode].players.length < 2) {
      socket.join(roomCode);
      rooms[roomCode].players.push({ id: socket.id, name: playerName || 'Player2' });
      playerNames[socket.id] = playerName || 'Player2';
      socket.emit('joinedRoom', { roomCode, playerName: playerName || 'Player2' });
      socket.to(roomCode).emit('opponentJoined', {
        playerId: socket.id,
        playerName: playerName || 'Player2'
      });
      console.log(`👥 ${playerName} joined room: ${roomCode}`);

      if (rooms[roomCode].players.length === 2) {
        const playersData = rooms[roomCode].players.map((player, index) => ({
          id: player.id,
          name: player.name,
          playerNumber: index === 0 ? 'player1' : 'player2'
        }));
        io.to(roomCode).emit('gameReady', { players: playersData });
        console.log(`🎮 Game ready in room ${roomCode}`);
      }
    } else if (!rooms[roomCode]) {
      socket.emit('error', { message: 'Room does not exist' });
    } else {
      socket.emit('error', { message: 'Room is full' });
    }
  });

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
      console.log(`▶️ Game started in room ${roomCode}`);
    }
  });

  socket.on('gameAction', (data) => {
    const { roomCode, action, playerId } = data;
    if (rooms[roomCode] && rooms[roomCode].isGameStarted) {
      socket.to(roomCode).emit('opponentAction', {
        action: action,
        playerId: playerId
      });
      if (rooms[roomCode].gameState && action.type === 'TURN_END') {
        rooms[roomCode].gameState.currentPlayer =
          rooms[roomCode].gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
        io.to(roomCode).emit('turnChanged', {
          currentPlayer: rooms[roomCode].gameState.currentPlayer
        });
      }
      console.log(`🎯 Action in room ${roomCode}:`, action.type);
    }
  });

  socket.on('syncGameState', (data) => {
    const { roomCode, gameState } = data;
    if (rooms[roomCode]) {
      rooms[roomCode].gameState = gameState;
      socket.to(roomCode).emit('gameStateUpdate', gameState);
    }
  });

  // ============================================
  // 🤖 HYBRID CHATBOT - LOCAL + GEMINI
  // ============================================
  socket.on('chatMessage', async (data) => {
    const { roomCode, message, playerName } = data;
    
    console.log(`💬 Chat from ${playerName}: "${message}"`);
    
    const target = roomCode && rooms[roomCode] ? io.to(roomCode) : io;
    
    // Broadcast player's message
    target.emit('chatMessage', {
      message: message,
      playerName: playerName,
      timestamp: Date.now(),
      isBot: false
    });

    // Step 1: Try local rule-based response first (fast!)
    let botResponse = getBotResponse(message);
    
    // Step 2: If no local match or response is default, use Gemini AI
    const needsGemini = !botResponse || 
                        botResponse.includes("Mujhe samajh nahi aaya") ||
                        botResponse.length < 20;

    if (needsGemini) {
      console.log(`🤖 Trying Gemini for: "${message}"`);
      const gameContextText = `Current branches: ${Object.keys(branchEffects).join(', ')}`;
      const geminiResponse = await getGeminiResponse(message, gameContextText);
      if (geminiResponse) {
        botResponse = geminiResponse;
      }
    }

    // Step 3: Final fallback
    if (!botResponse) {
      botResponse = "Abhi thoda confusion ho gaya. Card names (Plus 5, Multiply), branches (Algebra, Geometry) ya 'rule' se related sawaal pucho!";
    }

    // Send bot response after delay
    setTimeout(() => {
      target.emit('chatMessage', {
        message: botResponse,
        playerName: 'Math Bot 🤖',
        timestamp: Date.now(),
        isBot: true
      });
    }, 800);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    for (let roomCode in rooms) {
      const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = rooms[roomCode].players[playerIndex].name;
        rooms[roomCode].players.splice(playerIndex, 1);
        if (rooms[roomCode].players.length === 0) {
          delete rooms[roomCode];
          console.log(`🗑️ Room ${roomCode} deleted (empty)`);
        } else {
          socket.to(roomCode).emit('opponentDisconnected', {
            playerName: playerName
          });
          console.log(`👋 ${playerName} left room ${roomCode}`);
        }
        break;
      }
    }
    delete playerNames[socket.id];
  });

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

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    rooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString(),
    ai: process.env.GEMINI_API_KEY ? '🤖 GEMINI ENABLED' : '❌ NO API KEY'
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n🎮 ═══════════════════════════════════');
  console.log('🎮 Maths Nerds Server Running!');
  console.log(`🌐 Port: ${PORT}`);
  console.log('✅ Chatbot: HYBRID MODE (Rules + AI)');
  console.log(`🤖 Gemini AI: ${process.env.GEMINI_API_KEY ? '✅ ENABLED' : '⚠️ NO API KEY'}`);
  console.log('🎮 ═══════════════════════════════════\n');
});

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

// Static files serve करने के लिए
app.use(express.static(path.join(__dirname)));

// Root route for serving the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'maths-nerds.html'));
});

// Game rooms को manage करने के लिए
const rooms = {};
const playerNames = {};

// Chatbot Knowledge Base
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
    { name: 'Heal 10', icon: '❤️‍🩹', type: 'Number', cost: 2, effect: 'direct_value_change', value: 10, target: 'self', description: 'Apne IP ko 10 se badhata hai.', summary: 'Apna IP +10' },
    { name: 'Add 10', icon: '➕🔟', type: 'Number', cost: 2, effect: 'direct_value_change', value: 10, target: 'opponent', description: 'Opponent ke IP ko 10 se kam karta hai.', summary: 'IP -10' },

    // Action Cards
    { name: 'Multiply by 2', icon: '✖️2️⃣', type: 'Action', cost: 3, effect: 'multiply_ip', value: 2, target: 'opponent', description: 'Opponent ke IP ko 2 se multiply karta hai.', summary: 'Opponent IP x2' },
    { name: 'Divide by 2', icon: '➗2️⃣', type: 'Action', cost: 3, effect: 'divide_ip', value: 2, target: 'opponent', description: 'Opponent ke IP ko 2 se divide karta hai.', summary: 'Opponent IP /2' },
    { name: 'Square IP', icon: '²️⃣', type: 'Action', cost: 4, effect: 'square_ip', target: 'self', description: 'Apne IP ka square karta hai (e.g., 10 -> 100). High-risk self-buff.', summary: 'Self IP²' },
    { name: 'Square Root IP', icon: '√', type: 'Action', cost: 3, effect: 'square_root_ip', target: 'opponent', description: 'Opponent ke IP ka square root leta hai (e.g., 100 -> 10).', summary: '√Opponent IP' },
    { name: 'Absolute Value', icon: '📏', type: 'Action', cost: 2, effect: 'absolute_value_ip', target: 'self', description: 'Apne negative ya imaginary IP ko positive real banata hai.', summary: '|Self IP|' },
    { name: 'Derivative ($d/dx$)', icon: '📈', type: 'Action', cost: 4, effect: 'derivative_effect', branch: 'Calculus', target: 'opponent', description: 'Opponent ke IP ko 0 kar deta hai (constant ka derivative 0 hota hai).', summary: 'Opponent IP = 0' },
    { name: 'Logarithm ($\\ln(x)$)', icon: '🌳', type: 'Action', cost: 3, effect: 'logarithm_effect', branch: 'Algebra', target: 'opponent', description: 'Opponent ke IP ka natural logarithm leta hai. Positive IP par hi kaam karta hai.', summary: 'ln(Opponent IP)' },
    { name: 'Draw Card', icon: '🃏', type: 'Action', cost: 1, effect: 'draw_card', value: 1, description: 'Ek extra card draw karta hai.', summary: '+1 Card' },
    { name: 'Random Damage (1-10)', icon: '❓', type: 'Action', cost: 2, effect: 'random_damage', value: { min: 1, max: 10 }, target: 'opponent', description: 'Opponent ko 1 se 10 tak random damage deta hai.', summary: 'IP -Rand(1-10)' },
    { name: 'Reciprocal', icon: '1️⃣/x', type: 'Action', cost: 3, effect: 'reciprocal_ip', target: 'opponent', description: 'Opponent ke IP ka reciprocal leta hai (1/IP). 100 ko 0.01 bana deta hai!', summary: '1/Opponent IP' },
    { name: 'Power of 0', icon: '⁰', type: 'Action', cost: 1, effect: 'power_of_zero', target: 'opponent', description: 'Opponent ke IP ko 1 kar deta hai (agar IP 0 na ho).', summary: 'Opponent IP = 1' },
    { name: 'Copy IP', icon: '📋', type: 'Action', cost: 3, effect: 'copy_ip', target: 'self', description: 'Apne IP ko Opponent ke current IP ke barabar karta hai.', summary: 'Self IP = Opponent IP' },
    { name: 'Token Chori', icon: '💸', type: 'Action', cost: 2, effect: 'steal_token', value: 2, target: 'opponent', description: 'Opponent se 2 tokens chori karta hai.', summary: 'Tokens -2 (Opponent)' },
    { name: 'Prime Decomposition', icon: '🧩', type: 'Action', cost: 3, effect: 'prime_factor_damage', branch: 'Number Theory', target: 'opponent', description: 'Opponent ke IP ke sabse bade prime factor ke barabar damage deta hai (IP ko integer banaya jayega).', summary: 'Dmg = LPF(IP)' },
    { name: 'Negative Imaginary Square', icon: '(i)²', type: 'Action', cost: 3, effect: 'negative_imaginary_square', target: 'opponent', branch: 'Complex Analysis', description: "Agar opponent ka IP imaginary hai, to uska square karke usse ek negative real number bana deta hai (i*x -> -x²).", summary: 'If i*IP, IP -> -IP²' },

    // Theorem Cards
    { name: 'Invert IP Sign', icon: '➖➕', type: 'Theorem', cost: 6, effect: 'invert_sign_ip', target: 'opponent', description: 'Opponent ke IP ka sign change karta hai (e.g., 80 -> -80).', summary: 'Opponent IP -> -IP' },
    { name: 'Factorial (!)', icon: '🔢!', type: 'Theorem', cost: 5, effect: 'factorial_ip', branch: 'Number Theory', target: 'self', description: 'Apne IP ko uske factorial se replace karta hai. Sirf 0-12 ke beech ke integers par kaam karta hai. High-risk self-buff.', summary: 'Self IP -> IP!' },
    { name: 'Gamma Function ($\\Gamma$)', icon: 'Γ', type: 'Theorem', cost: 6, effect: 'gamma_function_ip', branch: 'Calculus', target: 'self', description: 'Apne IP par Gamma function (factorial ka generalization) apply karta hai. High-risk self-buff.', summary: 'Self IP -> Γ(IP)' },
    { name: 'Pi ($\\pi$)', icon: '🥧', type: 'Theorem', cost: 2, effect: 'divide_by_pi', branch: 'Geometry', target: 'opponent', description: 'Opponent ke IP ko $\\pi$ se divide karta hai, making it irrational.', summary: 'IP / $\\pi$ (Irrational)' },
    { name: 'Swap IPs', icon: '🔄', type: 'Theorem', cost: 4, effect: 'swap_ips', branch: 'Complex Analysis', description: 'Apne IP ko opponent ke IP se swap karta hai.', summary: 'Swap IPs' },
    { name: 'Triangle Inequality', icon: '🔺', type: 'Theorem', cost: 5, effect: 'block_damage', branch: 'Geometry', value: 10, target: 'self', description: 'Apne next 10 damage ko block karta hai.', summary: 'Block 10 Damage' },
    { name: "Euler's Identity", icon: '✨', type: 'Theorem', cost: 10, effect: 'one_hit_ko_chance', branch: 'Complex Analysis', target: 'opponent', description: 'Opponent IP ko 1 tak kam karne ka 50% chance.', summary: '50% Chance IP=1' },
    { name: 'Fibonacci Sequence', icon: '🐚', type: 'Theorem', cost: 3, effect: 'heal_over_time', value: 3, turns: 2, branch: 'Number Theory', target: 'self', description: 'Aapko 2 turns ke liye 3 IP heal karta hai.', summary: 'Heal 3/Turn (2T)' },
    { name: 'Matrix Inversion', icon: '🔲', type: 'Theorem', cost: 5, effect: 'double_damage_next_turn', branch: 'Algebra', target: 'self', description: 'Aapka next damage card double damage karega.', summary: 'Next Damage x2' },
    { name: 'Natural Number Set', icon: 'ℕ', type: 'Theorem', cost: 5, effect: 'natural_number_set_effect', branch: 'Number Theory', target: 'opponent', description: 'Agar Opponent ka IP irrational hai, toh usko 0 par set karta hai.', summary: 'Irrational IP = 0' },
    { name: 'Riemann Hypothesis', icon: '❓', type: 'Theorem', cost: 12, effect: 'ultimate_damage', value: 30, branch: 'Number Theory', target: 'opponent', description: 'Massive 30 damage deta hai, but cost bahut zyada hai.', summary: 'IP -30 (High Cost)' },
    { name: 'Shunya Hastak', icon: '✋', type: 'Theorem', cost: 4, effect: 'discard_hand', target: 'opponent', description: 'Opponent ko apna poora hand discard karne par majboor karta hai.', summary: 'Opponent Discard Hand' },
    { name: 'Pratibimbit Kshati', icon: '🪞', type: 'Theorem', cost: 6, effect: 'reflect_damage', value: 0.5, turns: 1, target: 'self', description: 'Next turn mein opponent se aane wale damage ka 50% wapas opponent ko deta hai.', summary: 'Reflect 50% Damage (1T)' },
    { name: 'Complex Rotation (×i)', icon: '🔄i', type: 'Theorem', cost: 5, effect: 'rotate_to_imaginary', branch: 'Complex Analysis', target: 'opponent', description: 'Opponent ke IP ko imaginary banata hai. Isse normal damage se bachaya ja sakta hai, lekin Square IP jaise card se khatra hai.', summary: 'IP -> i * IP' },
    { name: 'Real Projection (Re(z))', icon: 'Re(z)', type: 'Theorem', cost: 3, effect: 'real_projection', branch: 'Complex Analysis', target: 'opponent', description: 'Agar opponent ka IP imaginary hai, toh usse 0 kar deta hai.', summary: 'If i*IP, IP=0' },
    { name: 'Imaginary Annihilation (×i)', icon: '💥i', type: 'Theorem', cost: 4, effect: 'imaginary_annihilation', target: 'opponent', branch: 'Complex Analysis', description: "Opponent ke imaginary IP ko 'i' se multiply karta hai, jisse woh ek negative real number ban jaata hai (i*x -> -x).", summary: 'If i*IP, IP -> -IP' },
    { name: "Euler's Transformation", icon: 'e^ix', type: 'Theorem', cost: 5, effect: 'eulers_transformation', target: 'opponent', branch: 'Complex Analysis', description: "Opponent ke IP ko e^(i*IP) ke real part (cos(IP)) mein badal deta hai. Unka IP -1 aur 1 ke beech mein aa jaayega.", summary: 'IP -> cos(IP)' },
    { name: "De Moivre's Gambit", icon: '(cosθ+isinθ)ⁿ', type: 'Theorem', cost: 4, effect: 'de_moivres_gambit', target: 'opponent', branch: 'Complex Analysis', description: "Agar opponent ka IP imaginary hai, to usse ek random power (2 se 5) tak raise karta hai. Result unpredictable ho sakta hai!", summary: 'If i*IP, IP -> (i*IP)^n' },

    // Trigonometry Cards
    { name: 'Sine Wave', icon: '🌊', type: 'Action', cost: 3, effect: 'sine_wave_damage', value: 15, target: 'opponent', branch: 'Trigonometry', description: 'Opponent ko (15 * sin(angle)) damage deta hai. 90° par sabse zyada effective.', summary: 'Dmg = 15*sin(θ)' },
    { name: 'Cosine Shield', icon: '🛡️', type: 'Action', cost: 3, effect: 'cosine_shield', value: 20, target: 'self', branch: 'Trigonometry', description: 'Agle attack se (20 * cos(angle)) damage block karta hai. 0° par sabse zyada effective.', summary: 'Block = 20*cos(θ)' },
    { name: 'Law of Cosines', icon: '📐', type: 'Theorem', cost: 5, effect: 'deal_damage_based_on_ip_diff', target: 'opponent', branch: 'Trigonometry', description: 'Aapke aur opponent ke IP ke difference ke (50% + 20% * cos(angle)) ke barabar damage deta hai.', summary: 'Dmg by IP diff & angle' },
    { name: 'Secant Strike', icon: '⚡', type: 'Theorem', cost: 6, effect: 'secant_strike', value: 10, target: 'opponent', branch: 'Trigonometry', description: 'Opponent ko (10 * sec(angle)) damage deta hai. High-risk, high-reward! 90° ke paas bahut powerful.', summary: 'Dmg = 10*sec(θ)' },

    // **NEW** Probability Cards
    { name: 'Coin Flip', icon: '🪙', type: 'Action', cost: 2, effect: 'coin_flip', target: 'opponent', branch: 'Probability', description: '50% chance hai ki opponent ko 20 damage ho, 50% chance hai ki opponent 5 IP heal ho.', summary: '50/50: Dmg 20 / Heal 5' },
    { name: 'Dice Roll', icon: '🎲', type: 'Action', cost: 3, effect: 'dice_roll_damage', target: 'opponent', branch: 'Probability', description: 'Opponent ko (1 se 6 tak random number) * 3 damage deta hai.', summary: 'Dmg = (1d6) * 3' },
    { name: 'Statistical Anomaly', icon: '📊', type: 'Theorem', cost: 5, effect: 'statistical_anomaly', target: 'opponent', branch: 'Probability', description: '10% chance hai ki opponent ka IP 1 aur 100 ke beech ek random value par set ho jaye.', summary: '10% Chance: IP -> Rand(1-100)' }
,

    // NEW TRIGONOMETRIC CARDS (as requested)
    { name: 'Positive Tan', icon: '📐+', type: 'Action', cost: 3, effect: 'positive_tan', target: 'self', branch: 'Trigonometry', description: 'Apne IP ko tan(angle) se multiply karta hai. Angle slider use karke boost control karo.', summary: 'IP × tan(θ)' },
    { name: 'Positive Cot', icon: '📏+', type: 'Action', cost: 3, effect: 'positive_cot', target: 'self', branch: 'Trigonometry', description: 'Apne IP ko cot(angle) se multiply karta hai.', summary: 'IP × cot(θ)' },
    { name: 'Positive Cosec', icon: '🛡️+', type: 'Action', cost: 4, effect: 'positive_cosec', target: 'self', branch: 'Trigonometry', description: 'Apne IP ko cosec(angle) se multiply karta hai.', summary: 'IP × cosec(θ)' },
    { name: 'Negative Tan Avatar', icon: '⚡-', type: 'Avatar', cost: 2, effect: 'negative_tan_avatar', target: 'self', branch: 'Trigonometry', description: 'Negative IP ko -tan(angle) se multiply karke positive recovery.', summary: '-IP × -tan(θ)' },
    { name: 'Negative Cot Avatar', icon: '🔄-', type: 'Avatar', cost: 2, effect: 'negative_cot_avatar', target: 'self', branch: 'Trigonometry', description: 'Negative IP ko -cot(angle) se multiply karke recovery.', summary: '-IP × -cot(θ)' },
    { name: 'Negative Cosec Avatar', icon: '💚-', type: 'Avatar', cost: 3, effect: 'negative_cosec_avatar', target: 'self', branch: 'Trigonometry', description: 'Negative IP ko -cosec(angle) se multiply karke strong recovery.', summary: '-IP × -cosec(θ)' },

    // 5 NUMBER THEORY CARDS
    { name: 'Prime Check', icon: '🔍', type: 'Action', cost: 3, effect: 'prime_check', target: 'opponent', branch: 'Number Theory', description: 'Check if opponent IP is prime. Prime hai to double damage, nahi to half damage.', summary: 'Prime check damage' },
    { name: 'GCD Attack', icon: '🔗', type: 'Action', cost: 4, effect: 'gcd_attack', target: 'opponent', branch: 'Number Theory', description: 'Dono players ke IP ka GCD calculate karke damage deta hai.', summary: 'Dmg = GCD(IPs)' },
    { name: 'Modular Power', icon: '🔄', type: 'Action', cost: 5, effect: 'modular_power', target: 'opponent', branch: 'Number Theory', description: 'Opponent IP ko IP mod 17 kar deta hai.', summary: 'IP = IP mod 17' },
    { name: 'Fibonacci Heal', icon: '🌀', type: 'Action', cost: 4, effect: 'fibonacci_heal', target: 'self', branch: 'Number Theory', description: 'Next 4 turns tak Fibonacci numbers se heal hota hai (1,1,2,3).', summary: 'Fib healing 4 turns' },
    { name: 'Perfect Square', icon: '□', type: 'Theorem', cost: 6, effect: 'perfect_square', target: 'self', branch: 'Number Theory', description: 'Agar IP perfect square ke paas hai to massive boost milta hai.', summary: 'Perfect square boost' },

    // 5 PROBABILITY CARDS
    { name: 'Random Walk', icon: '👣', type: 'Action', cost: 3, effect: 'random_walk', target: 'opponent', branch: 'Probability', description: '5 random steps. Har step +5 ya -5 damage ka chance.', summary: '5 steps: ±5 each' },
    { name: 'Bell Curve', icon: '🔔', type: 'Action', cost: 4, effect: 'bell_curve', target: 'opponent', branch: 'Probability', description: 'Normal distribution: 70% chance 12 damage, 30% chance 25 damage.', summary: '70%:12dmg|30%:25dmg' },
    { name: 'Probability Boost', icon: '🎲', type: 'Action', cost: 5, effect: 'probability_boost', target: 'self', branch: 'Probability', description: 'Next 3 turns ke liye har card ka 40% chance hai extra effect ka.', summary: '3 turns: 40% extra' },
    { name: 'Monte Carlo', icon: '🎰', type: 'Theorem', cost: 6, effect: 'monte_carlo', target: 'opponent', branch: 'Probability', description: '100 random simulations run karke average damage deta hai.', summary: '100 sims damage' },
    { name: 'Chaos Theory', icon: '🌪️', type: 'Theorem', cost: 7, effect: 'chaos_theory', target: 'opponent', branch: 'Probability', description: 'Completely random effect: 20% massive damage, 80% small effect.', summary: '20% massive | 80% small' }
];


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
    socket.on('chatMessage', async (data) => {
        const { roomCode, message, playerName } = data;

        // For single player mode, broadcast to all. For multiplayer, to the room.
        const target = roomCode && rooms[roomCode] ? io.to(roomCode) : io;

        // Player's message broadcast
        target.emit('chatMessage', {
            message: message,
            playerName: playerName,
            timestamp: Date.now()
        });

        // Bot's response logic
        try {
            const botResponse = await getBotResponse(message);
            if (botResponse) {
                target.emit('chatMessage', {
                    message: botResponse,
                    playerName: 'Math Bot',
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error("Error getting bot response:", error);
            target.emit('chatMessage', {
                message: "Sorry, I'm having trouble connecting to my brain right now. Please try again later.",
                playerName: 'Math Bot',
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

async function getBotResponse(message) {
    const knowledgeBase = `
        You are Math Bot, an expert guide for the card game "Maths Nerds".
        Your role is to answer player questions in a friendly, helpful, and concise manner.
        **Crucially, you must match the depth of your answer to the user's question.** If a user asks a simple question (e.g., 'What does the Plus 5 card do?'), give a simple, direct answer. If they ask a complex or strategic question (e.g., 'What is the best strategy for the Calculus branch against a Geometry player?'), provide a more detailed, strategic explanation.
        You must always respond in Hindi.

        **Game Objective:** Reduce your opponent's Intellectual Power (IP) to 0.

        **Math Branches:**
        ${Object.entries(branchEffects).map(([name, data]) => `- ${name}: Pros: ${data.pros} Cons: ${data.cons}`).join('\n')}

        **Card Details:**
        ${allCards.map(card => `- ${card.name} (${card.type}, Cost: ${card.cost}): ${card.description}`).join('\n')}
    `;

    try {
        const prompt = `${knowledgeBase}\n\nA player asks: "${message}".\n\nYour response (in Hindi):`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        return text;
    } catch (error) {
        console.error('Error generating content from Gemini:', error);
        return "माफ़ कीजिए, मुझे इस समय सोचने में कठिनाई हो रही है। कृपया बाद में दोबारा प्रयास करें।";
    }
}

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

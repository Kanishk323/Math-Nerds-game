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
    { name: 'Chaos Theory', icon: '🌪️', type: 'Theorem', cost: 7, effect: 'chaos_theory', target: 'opponent', branch: 'Probability', description: 'Completely random effect: 20% massive damage, 80% small effect.', summary: '20% massive | 80% small' }];

// ============================================
// 🤖 HYBRID CHATBOT FUNCTION
// ============================================

const getGameKnowledgeBase = () => {
    let knowledge = "### GAME KNOWLEDGE BASE ###\n\n";

    knowledge += "--- CORE MECHANICS ---\n";
    knowledge += "- Grace Period: If IP is <= 0, you get 3 turns to heal. If still <= 0 after 3 turns, you lose.\n";
    knowledge += "- Imaginary IP: Immune to standard damage/heal (like Number cards). Vulnerable to special cards like 'Square IP' or 'Real Projection'.\n";
    knowledge += "- Irrational IP: Vulnerable to cards like 'Natural Number Set'.\n";
    knowledge += "- Angle Slider (Trigonometry Branch): Controls angle from 0-90 degrees. Drastically affects Trigonometry card power. 45 degrees is balanced, 0 and 90 are extreme and can be high-risk/high-reward.\n\n";

    knowledge += "--- MATHEMATICAL BRANCHES ---\n";
    for (const [name, data] of Object.entries(branchEffects)) {
        knowledge += `- Branch: ${name}\n`;
        knowledge += `  - Pros: ${data.pros}\n`;
        knowledge += `  - Cons: ${data.cons}\n`;
        let strategicFit = '';
        // TOKEN FIX: Updated strategic fit for Number Theory
        if (name === 'Algebra') strategicFit = 'Good for early aggression with buffed Number cards.';
        if (name === 'Geometry') strategicFit = 'Excellent for defensive, survival-focused play.';
        if (name === 'Calculus') strategicFit = 'Strong for control strategies using heal/damage over time effects.';
        if (name === 'Number Theory') strategicFit = 'Strong resource generation with consistent extra tokens, balanced by a bit of unpredictability in attacks.';
        if (name === 'Probability') strategicFit = 'High-risk, high-reward style. Relies on luck but can have huge payoffs.';
        if (name === 'Complex Analysis') strategicFit = 'Great for tricky, unpredictable plays and countering opponent strategies.';
        if (name === 'Trigonometry') strategicFit = 'Requires active management of the Angle slider for maximum impact. Very versatile.';
        knowledge += `  - Strategic Fit: ${strategicFit}\n\n`;
    }

    knowledge += "--- COMPLETE CARD LIST ---\n";
    allCards.forEach(card => {
        knowledge += `- Card: ${card.name}\n`;
        knowledge += `  - Type: ${card.type}, Cost: ${card.cost}\n`;
        knowledge += `  - Description: ${card.description}\n`;
        let strategicNote = '';
        // Add strategic notes for key cards
        if (card.name === 'Derivative ($d/dx$)') strategicNote = "Ultimate finisher. Save it for when the opponent has high IP. Avoid using on low IP.";
        else if (card.name === 'Swap IPs') strategicNote = "Game-changer. Use it when your IP is critically low and the opponent's is high. A top-tier comeback card.";
        else if (card.name === 'Probability Boost') strategicNote = "Powerful setup card. Best used when you have a large hand and enough tokens to play multiple cards next turn.";
        else if (card.name === 'Chaos Theory') strategicNote = "A final gambit. High risk, but the 20% chance for massive damage can win you the game when you have no other options.";
        else if (card.name === 'Sine Wave') strategicNote = "Your main damage source in Trigonometry. For max damage (15), set your angle to 90°. At 45°, it's 10.6. At 30°, it's only 7.5.";
        else if (card.name === 'Cosine Shield') strategicNote = "Your main defense in Trigonometry. For max block (20), set your angle to 0°. At 45°, it's 14.1. At 60°, it's 10.";
        else if (card.name === 'Negative Cosec Avatar') strategicNote = "The strongest emergency recovery card for Trigonometry players. Use when your IP is negative. It multiplies your negative IP by a negative number, resulting in a positive IP. Set angle near 90° for a massive heal (e.g., at 85°, cosec is ~11.5).";
        else if (card.name === 'Monte Carlo') strategicNote = "Very reliable high-damage card for Probability players. Provides consistent damage unlike other luck-based cards.";
        else if (card.name === 'Shunya Hastak') strategicNote = "Extremely powerful control card. Use it when you suspect the opponent has a strong hand or key combo pieces saved up.";
         else if (card.name === 'Natural Number Set') strategicNote = "A hard counter to 'Pi'. If the opponent makes their IP irrational, this card instantly sets it to 0. A crucial tech card.";

        if(strategicNote) knowledge += `  - Strategic Note: ${strategicNote}\n`;
        knowledge += "\n";
    });

    return knowledge;
}

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

function formatGameStateForAI(gameState) {
  if (!gameState) return "";

  // Safety checks in case data is missing
  const p1 = gameState.me || {};
  const p2 = gameState.opponent || {};
  const turnInfo = `Turn: ${gameState.turn || '?'}, Phase: ${gameState.phase || '?'}, Active: ${gameState.activePlayer || '?'}`;
  const handInfo = (p1.hand && Array.isArray(p1.hand)) ? p1.hand.join(', ') : 'Empty';

  return `
  ### CURRENT GAME STATE ###
  ${turnInfo}
  - YOUR STATE (Player 1):
    - Branch: ${p1.branch || 'Unknown'}
    - IP: ${p1.ip || 0}
    - Tokens: ${p1.tokens || 0}
    - Angle: ${p1.angle || 45}°
    - Status: ${p1.status || 'Normal'}
    - Hand Cards: [${handInfo}]

  - OPPONENT STATE (Player 2):
    - Branch: ${p2.branch || 'Unknown'}
    - IP: ${p2.ip || 0}
    - Tokens: ${p2.tokens || 0}
    - Angle: ${p2.angle || 45}°
    - Status: ${p2.status || 'Normal'}
  `;
}

async function getGeminiResponse(message, gameContext = "") {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemPrompt = `You are 'Math Bot', a super-intelligent, pro-level e-sports strategist and commentator for the card game 'Mathematical Card Battle'. Your analysis is sharp, insightful, and always focused on winning. You are enthusiastic and use a mix of Hindi and English (Hinglish).

Your Core Directives:
1.  **Analyze First:** Before answering, deeply analyze the provided '[CURRENT GAME STATE]' and cross-reference it with the '[GAME KNOWLEDGE BASE]'.
2.  **Give Actionable Strategy:** Don't just describe cabrds. Tell the player *what* to play, *why* it's a good move, and what combos to look for. Suggest specific card plays from their hand.
3.  **Think Ahead:** Suggest not just the current turn's best move, but also how to set up for future turns.
4.  **Be Context-Aware:** Your advice must change based on the player's IP, tokens, and opponent's state. If the player's IP is low, prioritize survival. If tokens are high, suggest powerful combos.
5.  **Maintain Persona:** Be the ultimate hype-man and strategic genius. Phrases like "Okay, let's break it down!", "Sahi move ye hoga...", "This is a high-IQ play!" are perfect.`;

    const prompt = `
${gameContext}

Based on all the knowledge and the current game state, give a pro-level strategic answer to the player's question.

### PLAYER'S QUESTION ###
"${message}"
`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });
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
    const { roomCode, message, playerName, gameState } = data;
    
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
    // If gameState is present, we prefer Gemini for context-aware advice
    const needsGemini = !botResponse || 
                        botResponse.includes("Mujhe samajh nahi aaya") ||
                        botResponse.length < 20 ||
                        (gameState && message.length > 5); // Use AI if we have game state and a real question

    if (needsGemini) {
      console.log(`🤖 Trying Gemini for: "${message}"`);
      let gameKnowledge = getGameKnowledgeBase();

      if (gameState) {
        const formattedState = formatGameStateForAI(gameState);
        console.log("🎮 Game Context for AI:\n", formattedState); // Debug log
        gameKnowledge += formattedState;
      }

      const geminiResponse = await getGeminiResponse(message, gameKnowledge);
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

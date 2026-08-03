const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const JWT_SECRET = 'super_secret_jwt_key_12345';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database
let users = {}; 
let pendingTransactions = []; 
let gameHistory = [];

let currentRound = {
  period: new Date().toISOString().slice(0,10).replace(/-/g, "") + "0001",
  timer: 60,
  manualResult: null // Admin preset number (null = Auto Random)
};

// Admin User Initial Setup
users['admin'] = { password: 'adminpassword', balance: 999999, role: 'admin' };

// --- Real-time Game Loop (60-second Timer) ---
setInterval(() => {
  currentRound.timer--;

  if (currentRound.timer <= 0) {
    // Determine Result
    let winningNumber;
    if (currentRound.manualResult !== null) {
      winningNumber = parseInt(currentRound.manualResult);
    } else {
      winningNumber = Math.floor(Math.random() * 10);
    }

    // Determine Colors & Size
    let isBig = winningNumber >= 5;
    let color = 'green';
    if ([0, 5].includes(winningNumber)) color = 'purple';
    else if ([1, 3, 7, 9].includes(winningNumber)) color = 'green';
    else if ([2, 4, 6, 8].includes(winningNumber)) color = 'red';

    const roundResult = {
      period: currentRound.period,
      number: winningNumber,
      size: isBig ? 'အကြီး' : 'အသေး',
      color: color
    };

    gameHistory.unshift(roundResult);
    if (gameHistory.length > 20) gameHistory.pop();

    // Settle Bets
    settleRoundBets(roundResult);

    // Reset Round
    currentRound.period = (parseInt(currentRound.period) + 1).toString();
    currentRound.timer = 60;
    currentRound.manualResult = null; // Reset to random after round ends

    io.emit('round_ended', roundResult);
  }

  io.emit('timer_update', { timer: currentRound.timer, period: currentRound.period });
}, 1000);

function settleRoundBets(result) {
  Object.keys(users).forEach(username => {
    let user = users[username];
    if (user.bets && user.bets[result.period]) {
      let bet = user.bets[result.period];
      let won = false;
      let payout = 0;

      if (bet.type === 'number' && parseInt(bet.value) === result.number) {
        won = true;
        payout = bet.amount * 9;
      } else if (bet.type === 'size' && bet.value === (result.number >= 5 ? 'big' : 'small')) {
        won = true;
        payout = bet.amount * 2;
      }

      if (won) {
        user.balance += payout;
      }

      io.to(username).emit('bet_result', { won, payout, result });
    }
  });
}

// --- API Endpoints ---

// Register / Login
app.post('/api/auth', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'အချက်အလက်ပြည့်စုံစွာဖြည့်ပါ' });

  if (users[username]) {
    // Login
    if (users[username].password !== password) {
      return res.status(400).json({ error: 'စကားဝှက် မှားယွင်းနေပါသည်' });
    }
  } else {
    // Register
    users[username] = { password, balance: 1000, role: 'user', bets: {} };
  }

  const token = jwt.sign({ username, role: users[username].role }, JWT_SECRET);
  res.json({ token, user: { username, balance: users[username].balance, role: users[username].role } });
});

// Admin API: Control Next Round Number
app.post('/api/admin/set-result', (req, res) => {
  const { number } = req.body;
  currentRound.manualResult = number !== '' ? parseInt(number) : null;
  res.json({ success: true, manualResult: currentRound.manualResult });
});

// Admin API: Direct Balance Transfer
app.post('/api/admin/update-balance', (req, res) => {
  const { username, amount } = req.body;
  if (users[username]) {
    users[username].balance += parseFloat(amount);
    io.emit('user_update', { username, balance: users[username].balance });
    return res.json({ success: true, balance: users[username].balance });
  }
  res.status(404).json({ error: 'User ရှာမတွေ့ပါ' });
});

// Admin API: Fetch Users & Bets
app.get('/api/admin/dashboard', (req, res) => {
  const userList = Object.keys(users).map(u => ({
    username: u,
    balance: users[u].balance,
    role: users[u].role,
    currentBet: users[u].bets ? users[u].bets[currentRound.period] : null
  }));
  res.json({ users: userList, currentRound, pendingTransactions });
});

// WebSocket Real-time Authentication
io.on('connection', (socket) => {
  socket.on('join', (username) => {
    socket.join(username);
  });

  socket.on('place_bet', ({ username, type, value, amount }) => {
    let user = users[username];
    if (user && user.balance >= amount) {
      user.balance -= amount;
      if (!user.bets) user.bets = {};
      user.bets[currentRound.period] = { type, value, amount };
      
      socket.emit('balance_updated', user.balance);
      io.emit('admin_bet_update', { username, type, value, amount, period: currentRound.period });
    } else {
      socket.emit('error_msg', 'လက်ကျန်ငွေ မလုံလောက်ပါ');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

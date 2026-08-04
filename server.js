const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Data Persistence (File Storage)
const DATA_FILE = path.join(__dirname, 'game_data.json');

let manualTargetResult = "AUTO"; 
let users = {};         
let currentBets = [];   
let gameSeconds = 60; // 1 မိနစ် (60s)
let gamePeriod = 10001;
let gameHistory = [];
let betHistory = []; // All individual user bets history

// Load data from file if exists
if (fs.existsSync(DATA_FILE)) {
  try {
    const savedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    users = savedData.users || {};
    gameHistory = savedData.gameHistory || [];
    betHistory = savedData.betHistory || [];
    if (gameHistory.length > 0) {
      gamePeriod = parseInt(gameHistory[0].period) + 1;
    }
    console.log("--> Data loaded from game_data.json");
  } catch (e) {
    console.log("--> Error loading stored data");
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users, gameHistory, betHistory }, null, 2));
  } catch(e) {
    console.log("--> Error saving data:", e);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.emit("init_data", {
    history: gameHistory,
    period: String(gamePeriod),
    timer: gameSeconds
  });

  // =========================
  // LOGIN
  // =========================
  socket.on('user_login', (data) => {
    const { phone, pass } = data || {};

    if (!phone || !pass) {
      return socket.emit('auth_response', {
        success: false,
        message: 'အကောင့်အမည်နှင့် စကားဝှက် ဖြည့်ပါ'
      });
    }

    const user = users[phone];

    if (!user) {
      return socket.emit('auth_response', {
        success: false,
        message: 'အကောင့်မတွေ့ပါ။ Register အရင်လုပ်ပါ။'
      });
    }

    if (user.pass !== pass) {
      return socket.emit('auth_response', {
        success: false,
        message: 'စကားဝှက် မှားနေပါတယ်'
      });
    }

    socket.join(phone);

    // User ရဲ့ Personal Bet History ကို ပြန်ထုတ်ပေးခြင်း
    const myBets = betHistory.filter(b => b.phone === phone);

    socket.emit('auth_response', {
      success: true,
      message: 'Login အောင်မြင်ပါတယ်',
      user: {
        phone: user.phone,
        pass: user.pass,
        balance: user.balance || 0
      },
      myBets: myBets
    });
  });

  // =========================
  // REGISTER
  // =========================
  socket.on('user_register', (data) => {
    const { phone, pass } = data || {};

    if (!phone || !pass) {
      return socket.emit('auth_response', {
        success: false,
        message: 'အကောင့်အမည်နှင့် စကားဝှက် ဖြည့်ပါ'
      });
    }

    if (users[phone]) {
      return socket.emit('auth_response', {
        success: false,
        message: 'ဒီအကောင့် ရှိပြီးသားပါ။ Login ဝင်ပါ။'
      });
    }

    users[phone] = { phone: phone, pass: pass, balance: 0 };
    saveData();
    socket.join(phone);

    socket.emit('auth_response', {
      success: true,
      message: 'Register အောင်မြင်ပါတယ်',
      user: { phone: phone, pass: pass, balance: 0 },
      myBets: []
    });

    sendAdminStats();
  });

  // =========================
  // PLACE BET
  // =========================
  socket.on('place_bet', (data) => {
    const { phone, betType, amount } = data || {};
    const user = users[phone];

    if (!user) {
      return socket.emit('bet_response', {
        success: false,
        message: 'ကျေးဇူးပြု၍ လော့ဂ်အင် ပြန်ဝင်ပါ။'
      });
    }

    const betAmount = parseInt(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return socket.emit('bet_response', {
        success: false,
        message: 'မှန်ကန်သော ပမာဏ ဖြည့်ပါ။'
      });
    }

    if (user.balance < betAmount) {
      return socket.emit('bet_response', {
        success: false,
        message: 'လက်ကျန်ငွေ မလုံလောက်ပါ! ကျေးဇူးပြု၍ ငွေထပ်သွင်းပါ။'
      });
    }

    // 10 စက္ကန့် ရောက်တာနဲ့ လောင်းကြေး အကုန်ပိတ်မည်
    if (gameSeconds <= 10) {
      return socket.emit('bet_response', {
        success: false,
        message: 'ပွဲစဉ်ပိတ်ခါနီး (10s အောက်) ဖြစ်၍ လောင်းကြေး ပိတ်ထားပါသည်။'
      });
    }

    user.balance -= betAmount;
    saveData();

    const newBet = {
      phone: phone,
      betType: String(betType).toUpperCase(),
      amount: betAmount,
      period: String(gamePeriod),
      timestamp: new Date().toLocaleTimeString()
    };

    currentBets.push(newBet);

    const myCurrentBets = currentBets.filter(b => b.phone === phone);

    socket.emit('bet_response', {
      success: true,
      message: 'လောင်းကြေး တင်ပြီးပါပြီ!',
      newBalance: user.balance,
      myCurrentBets: myCurrentBets
    });
    
    io.to(phone).emit('balance_sync', user.balance);
    sendAdminStats();
  });

  // =========================
  // ADMIN CONTROLS
  // =========================
  socket.on('admin_init', () => {
    socket.emit('admin_data', {
      onlineUsers: io.engine.clientsCount,
      users: Object.values(users),
      targetResult: manualTargetResult,
      timer: gameSeconds,
      period: String(gamePeriod)
    });
    sendAdminStats();
  });

  // ADMIN SET TARGET RESULT (ဂဏန်း စိုက်ချရန်)
  socket.on('admin_set_target_result', (data) => {
    manualTargetResult = data.target;
    io.emit('admin_toast', `နောက်ပွဲစဉ်အတွက် ဂဏန်း (${data.target}) ဟု သတ်မှတ်လိုက်ပါပြီ။`);
  });

  socket.on('admin_update_balance', (data) => {
    const { phone, amount } = data;
    const addAmt = parseFloat(amount);
    
    if (phone && !isNaN(addAmt)) {
      if (!users[phone]) {
        users[phone] = { phone: phone, pass: '123456', balance: 0 };
      }
      users[phone].balance += addAmt;
      saveData();
      
      io.to(phone).emit('balance_sync', users[phone].balance);
      sendAdminStats();
      socket.emit('admin_toast', `User ${phone} ထံသို့ Unit ${addAmt} ထည့်သွင်း/နှုတ်ယူပြီးပါပြီ။`);
    }
  });

  socket.on('admin_delete_user', (phone) => {
    if (phone && users[phone]) {
      delete users[phone];
      saveData();
      sendAdminStats();
      socket.emit('admin_toast', `User ${phone} အကောင့်အား အပြီးတိုင် ဖျက်လိုက်ပါပြီ။`);
    } else {
      socket.emit('admin_toast', `User ${phone} အကောင့် ရှာမတွေ့ပါ။`);
    }
  });

  socket.on('disconnect', () => {
    sendAdminStats();
  });
});

function sendAdminStats() {
  const onlineCount = io.engine.clientsCount;
  const userList = Object.values(users);

  let betSummary = {};
  currentBets.forEach(b => {
    betSummary[b.betType] = (betSummary[b.betType] || 0) + b.amount;
  });

  let topBetText = currentBets.length > 0 
    ? Object.entries(betSummary).map(([type, amt]) => `${type}: K${amt}`).join(' | ') 
    : "လက်ရှိ ပွဲစဉ်တွင် လောင်းကြေး မရှိသေးပါ";

  io.emit('admin_stats_update', {
    onlineCount: onlineCount,
    topBetInfo: topBetText,
    users: userList,
    timer: gameSeconds,
    period: String(gamePeriod)
  });
}

// ==========================================
// RESULT CALCULATION & PAYOUT LOGIC
// ==========================================
function calculateGameResult() {
  let finalNumber;

  if (manualTargetResult !== "AUTO") {
    finalNumber = parseInt(manualTargetResult);
    manualTargetResult = "AUTO"; 
  } else if (currentBets.length > 0) {
    let possibleResults = [];

    for (let num = 0; num <= 9; num++) {
      let isGreen = [1, 3, 7, 9].includes(num);
      let isRed = [2, 4, 6, 8].includes(num);
      let isViolet = [0, 5].includes(num);
      let size = num >= 5 ? 'BIG' : 'SMALL';
      let totalPayout = 0;

      currentBets.forEach(b => {
        if (String(num) === b.betType) totalPayout += b.amount * 9;
        else if (b.betType === size) totalPayout += b.amount * 2;
        else if (b.betType === 'GREEN' && (isGreen || isViolet)) {
          totalPayout += isGreen ? b.amount * 2 : b.amount * 1.5;
        }
        else if (b.betType === 'RED' && (isRed || isViolet)) {
          totalPayout += isRed ? b.amount * 2 : b.amount * 1.5;
        }
        else if (b.betType === 'VIOLET' && isViolet) {
          totalPayout += b.amount * 4.5;
        }
      });

      possibleResults.push({ number: num, payout: totalPayout });
    }

    possibleResults.sort((a, b) => a.payout - b.payout);

    // 60% House Edge / Lowest Payout Algorithm
    let isHouseWinRate = Math.random() < 0.60;
    if (isHouseWinRate) {
      finalNumber = possibleResults[0].number;
    } else {
      finalNumber = Math.floor(Math.random() * 10);
    }
  } else {
    finalNumber = Math.floor(Math.random() * 10);
  }

  // ရလဒ် အရောင်နှင့် ဆိုဒ် သတ်မှတ်ခြင်း
  let color = 'GREEN';
  if ([2, 4, 6, 8].includes(finalNumber)) color = 'RED';
  else if ([0, 5].includes(finalNumber)) color = 'VIOLET';

  let size = finalNumber >= 5 ? 'BIG' : 'SMALL';

  return { number: finalNumber, color: color, size: size };
}

function processPayouts(result) {
  currentBets.forEach(bet => {
    const user = users[bet.phone];
    if (!user) return;

    let winRatio = 0;
    const num = result.number;

    if (String(num) === bet.betType) {
      winRatio = 9;
    } else if (bet.betType === result.size) {
      winRatio = 2;
    } else if (bet.betType === 'GREEN') {
      if ([1, 3, 7, 9].includes(num)) winRatio = 2;
      else if ([0, 5].includes(num)) winRatio = 1.5;
    } else if (bet.betType === 'RED') {
      if ([2, 4, 6, 8].includes(num)) winRatio = 2;
      else if ([0, 5].includes(num)) winRatio = 1.5;
    } else if (bet.betType === 'VIOLET' && [0, 5].includes(num)) {
      winRatio = 4.5;
    }

    let isWin = winRatio > 0;
    let winAmount = isWin ? bet.amount * winRatio : 0;

    if (isWin) {
      user.balance += winAmount;
    }

    const historyRecord = {
      phone: user.phone,
      period: bet.period,
      betType: bet.betType,
      amount: bet.amount,
      win: isWin,
      winAmount: winAmount,
      resultNumber: result.number,
      resultColor: result.color,
      resultSize: result.size,
      newBalance: user.balance
    };

    betHistory.unshift(historyRecord);

    // Pop-up ပြရန်နှင့် Balance Update အတွက် Data ပို့ခြင်း (အနိုင်/အရှုံး နှစ်ခုလုံး ပို့ပေးပါသည်)
    io.to(user.phone).emit('user_bet_settled', historyRecord);
    io.to(user.phone).emit('balance_sync', user.balance);
  });

  currentBets = [];
  saveData();
}

setInterval(() => {
  gameSeconds--;

  if (gameSeconds <= 0) {
    const result = calculateGameResult();

    const historyItem = {
      period: String(gamePeriod),
      number: result.number,
      color: result.color,
      size: result.size
    };

    processPayouts(result);

    gameHistory.unshift(historyItem);
    if (gameHistory.length > 50) gameHistory.pop();

    saveData();

    // Game Result Broadcast
    io.emit("game_result", historyItem);

    gamePeriod++;
    gameSeconds = 60; // 1min
  }

  io.emit("timer_update", {
    timer: gameSeconds,
    period: String(gamePeriod)
  });

  sendAdminStats();

}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lucky Lottery server running on port ${PORT}`);
});


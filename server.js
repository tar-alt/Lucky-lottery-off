// server.js ၏ အပေါ်ဆုံး သို့မဟုတ် global variable များထဲတွင် ထည့်ပါ
let manualTargetResult = "AUTO"; // ကနဦးတွင် AUTO ထားမည်

io.on('connection', (socket) => {

  // Admin မှ ကျမည့်နံပါတ် သတ်မှတ်ချက် လက်ခံခြင်း
  socket.on('admin_set_target_result', (data) => {
    manualTargetResult = data.target;
    console.log(`[ADMIN CONTROL] Next target result set to: ${manualTargetResult}`);
  });

  // Admin မှ Balance တိုး/လျှော့ ပို့လာခြင်း
  socket.on('admin_update_balance', (data) => {
    // Database / Array ထဲတွင် Balance ပြင်ဆင်သည့် logic ရေးရန်
  });
});

// Timer 0 ဖြစ်၍ ဂဏန်း ထွက်မည့် Function ထဲတွင် အောက်ပါအတိုင်း သုံးပါ:
function calculateGameResult() {
  let finalNumber;

  if (manualTargetResult !== "AUTO") {
    // Admin က နံပါတ် ရွေးထားခဲ့ပါက ထိုနံပါတ်အတိုင်း ထုတ်ပေးမည်
    finalNumber = parseInt(manualTargetResult);
    
    // အသုံးပြုပြီးပါက AUTO ပြန်ပြောင်းချင်ပါက (သို့) ဆက်ထားချင်ပါက လိုသလို ညှိနိုင်သည်
    // manualTargetResult = "AUTO"; 
  } else {
    // ရိုးရိုး Random ဂဏန်း (0 မှ 9) ထုတ်ပေးမည်
    finalNumber = Math.floor(Math.random() * 10);
  }

  // Color / Size ခွဲခြားမှုများ
  let color = (finalNumber === 0 || finalNumber === 5) ? 'violet' : (finalNumber % 2 === 0 ? 'red' : 'green');
  let size = finalNumber >= 5 ? 'BIG' : 'SMALL';

  return { number: finalNumber, color: color, size: size };
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

let usersDB = {};
let currentPeriod = 20260804001;
let timer = 30;
let liveBets = [];

setInterval(() => {
  timer--;
  if (timer < 0) {
    timer = 30;
    currentPeriod++;
    liveBets = [];
    sendAdminUpdates();
  }
  io.emit('timer_update', { timer, period: currentPeriod });
}, 1000);

function getBetsSummary() {
  let summary = {};
  liveBets.forEach(b => {
    let key = `${b.bet.type}: ${b.bet.value}`;
    summary[key] = (summary[key] || 0) + b.totalAmount;
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
  socket.emit('init_data', { period: currentPeriod, history: [] });
  sendAdminUpdates();

  socket.on('user_register', (data) => {
    if (usersDB[data.phone]) {
      socket.emit('auth_response', { success: false, message: 'ဤဖုန်းနံပါတ်ဖြင့် အကောင့်ဖွင့်ပြီးသား ဖြစ်နေပါသည်။' });
    } else {
      usersDB[data.phone] = {
        phone: data.phone,
        pass: data.pass,
        balance: 0
      };
      socket.emit('auth_response', {
        success: true,
        message: 'အကောင့်သစ် အောင်မြင်စွာ ဖွင့်ပြီးပါပြီ!',
        user: usersDB[data.phone]
      });
      sendAdminUpdates();
    }
  });

  socket.on('user_login', (data) => {
    const user = usersDB[data.phone];
    if (!user) {
      socket.emit('auth_response', { success: false, message: 'အကောင့်မရှိသေးပါ။ ကျေးဇူးပြု၍ Register အရင်လုပ်ပါ။' });
    } else if (user.pass !== data.pass) {
      socket.emit('auth_response', { success: false, message: 'စကားဝှက် မှားယွင်းနေပါသည်။' });
    } else {
      socket.emit('auth_response', {
        success: true,
        message: 'လော့ဂ်အင် အောင်မြင်ပါသည်!',
        user: user
      });
    }
  });

  socket.on('place_bet', (data) => {
    if (usersDB[data.phone] && usersDB[data.phone].balance >= data.totalAmount) {
      usersDB[data.phone].balance -= data.totalAmount;
      liveBets.push(data);
      socket.emit('balance_sync', usersDB[data.phone].balance);
      sendAdminUpdates();
    }
  });

  socket.on('admin_update_balance', (data) => {
    if (usersDB[data.phone]) {
      usersDB[data.phone].balance += data.amount;
      socket.emit('admin_action_success', `${data.phone} သို့ Balance K${data.amount} ပြင်ဆင်ပြီးပါပြီ။`);
      io.emit('balance_sync', usersDB[data.phone].balance);
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


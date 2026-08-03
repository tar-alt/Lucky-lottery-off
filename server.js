const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public folder ထဲက HTML/JS ဖိုင်တွေကို Serve လုပ်ရန်
app.use(express.static(__dirname + '/public')); 

// Global Variables
let manualTargetResult = "AUTO"; 
let users = {}; // User စာရင်းနှင့် Balance သိမ်းရန်

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

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
        users[phone] = { phone: phone, balance: 0 };
      }
      users[phone].balance += amount;
      
      // Admin Panel ဆီ Data ပြန်ပို့ပေးရန်
      sendAdminStats();
      console.log(`[BALANCE UPDATE] ${phone} new balance: ${users[phone].balance}`);
    }
  });

  // Admin Dashboard သို့ Live Data များ ပို့ပေးရန် Function
  function sendAdminStats() {
    const onlineCount = io.engine.clientsCount;
    const userList = Object.values(users);
    
    io.emit('admin_stats_update', {
      onlineCount: onlineCount,
      topBetInfo: "လက်ရှိ ပွဲစဉ်တွင် လောင်းကြေး မရှိသေးပါ",
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

// Server စတင် Run မည့် Port သတ်မှတ်ခြင်း (Render / Local)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


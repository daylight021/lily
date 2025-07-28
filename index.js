require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, getContentType, Browsers } = require('lily-baileys');
const Pino = require('pino');
const fs = require("fs");
const path = require("path");
const Collection = require("./lib/CommandCollections");
const readline = require("readline");

// Install: npm install qrcode express
const qrcode = require('qrcode');
const express = require('express');

const store = makeInMemoryStore({ logger: Pino().child({ level: 'silent', stream: 'store' }) });

const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

// HTTP Server untuk QR Display
function startQRServer(qrData) {
  const app = express();
  
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp QR Code</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { display:flex; justify-content:center; align-items:center; height:100vh; margin:0; background:#f0f0f0; font-family: Arial, sans-serif; }
          .container { text-align:center; background:white; padding:30px; border-radius:15px; box-shadow:0 8px 16px rgba(0,0,0,0.1); }
          #qrcode { margin: 20px 0; }
          h2 { color: #25D366; margin-bottom: 10px; }
          p { color: #666; margin: 10px 0; }
          .steps { text-align: left; margin: 20px 0; }
          .step { margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🔗 WhatsApp Bot Connection</h2>
          <div id="qrcode"></div>
          <div class="steps">
            <div class="step">1️⃣ Buka WhatsApp di ponsel</div>
            <div class="step">2️⃣ Masuk ke Settings (⚙️)</div>
            <div class="step">3️⃣ Pilih "Linked Devices"</div>
            <div class="step">4️⃣ Tap "Link a Device"</div>
            <div class="step">5️⃣ Scan QR code di atas</div>
          </div>
          <p style="color: #25D366; font-weight: bold;">✅ Halaman ini akan otomatis tertutup setelah berhasil</p>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
        <script>
          QRCode.toCanvas(document.getElementById('qrcode'), '${qrData}', {
            width: 256,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          
          // Auto refresh setiap 30 detik
          setTimeout(() => {
            window.location.reload();
          }, 30000);
        </script>
      </body>
      </html>
    `);
  });
  
  const server = app.listen(3000, '0.0.0.0', () => {
    console.log('🌐 QR Server aktif!');
    console.log('📱 Buka di browser: http://your-vps-ip:3000');
    console.log('📋 Atau gunakan tunnel: ngrok http 3000');
  });
  
  return server;
}

// Save QR sebagai file PNG
async function saveQRToFile(qrData) {
  try {
    await qrcode.toFile('whatsapp-qr.png', qrData, {
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 400,
      margin: 2
    });
    
    console.log('📷 QR Code saved as: whatsapp-qr.png');
    console.log('📂 Download file ini ke ponsel dan scan dengan WhatsApp');
    
    // Generate base64 untuk copy-paste
    const base64 = await qrcode.toDataURL(qrData);
    console.log('🔗 Base64 QR (untuk online QR reader):');
    console.log(base64.substring(0, 50) + '...[truncated]');
    
    return true;
  } catch (error) {
    console.error('❌ Gagal save QR:', error);
    return false;
  }
}

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`📱 WA v${version.join('.')}, Latest: ${isLatest}`);

    const bot = makeWASocket({
      version,
      logger: Pino({ level: 'silent' }),
      printQRInTerminal: false, // Disabled untuk VPS
      auth: state,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
    });

    if (!bot.commands) {
      bot.commands = new Collection();
    }

    // Load commands
    loadCommands('commands', bot);

    let qrServer = null;

    // Handle pairing/QR
    if (!bot.authState.creds.registered) {
      console.log('🔐 Sesi tidak ditemukan');
      console.log('🤔 Pilih metode koneksi:');
      console.log('1. Pairing Code (kemungkinan tidak bekerja)');
      console.log('2. QR via HTTP Server (recommended)');
      console.log('3. QR ke File PNG');
      console.log('4. Manual Session Transfer');
      
      const choice = await question('Pilihan (1-4): ');
      
      switch(choice) {
        case '1':
          // Coba pairing code
          const phoneNumber = await question('📞 Nomor WhatsApp (628xxx): ');
          try {
            const code = await bot.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
            if (code && code !== 'YOURCODE') {
              console.log(`🎉 Pairing Code: ${code}`);
            } else {
              console.log('❌ Pairing code gagal, switching ke QR server...');
              // Will handle in connection.update
            }
          } catch (error) {
            console.log('❌ Pairing error:', error.message);
          }
          break;
          
        case '2':
          console.log('🌐 Mode HTTP Server dipilih');
          console.log('⏳ Tunggu QR code...');
          break;
          
        case '3':
          console.log('📁 Mode File PNG dipilih');
          console.log('⏳ Tunggu QR code...');
          break;
          
        case '4':
          console.log('📋 MANUAL SESSION TRANSFER:');
          console.log('1. Setup bot di komputer lokal dengan QR');
          console.log('2. Copy folder auth_info_baileys ke VPS ini');
          console.log('3. Restart bot');
          console.log('4. Command: scp -r auth_info_baileys user@vps:/path/to/bot/');
          process.exit(0);
          break;
          
        default:
          console.log('🌐 Default: HTTP Server mode');
      }
    }

    bot.ev.on('creds.update', saveCreds);

    bot.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Handle QR Code
      if (qr) {
        console.log('📱 QR Code received!');
        
        try {
          // Start HTTP Server
          if (!qrServer) {
            qrServer = startQRServer(qr);
          }
          
          // Save QR to file
          await saveQRToFile(qr);
          
          console.log('✨ Multiple QR options available:');
          console.log('1. 🌐 HTTP: http://your-vps-ip:3000');
          console.log('2. 📁 File: whatsapp-qr.png');
          console.log('3. 🔗 Base64: check console output above');
          
        } catch (error) {
          console.error('❌ QR handling error:', error);
        }
      }

      if (connection === 'open') {
        console.log('🚀 Bot connected successfully!');
        console.log(`📱 Connected as: ${bot.user?.name || 'Unknown'}`);
        
        // Close QR server if running
        if (qrServer) {
          qrServer.close();
          qrServer = null;
          console.log('🔒 QR Server closed');
        }
        
        // Delete QR file
        if (fs.existsSync('whatsapp-qr.png')) {
          fs.unlinkSync('whatsapp-qr.png');
          console.log('🗑️ QR file deleted');
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log('🔌 Connection closed:', lastDisconnect?.error);
        
        if (qrServer) {
          qrServer.close();
          qrServer = null;
        }
        
        if (shouldReconnect) {
          console.log('🔄 Reconnecting in 5 seconds...');
          setTimeout(() => startBot().catch(console.error), 5000);
        } else {
          console.log('🚪 Logged out. Delete auth_info_baileys to login again');
        }
      }
    });

    // Message handler
    bot.ev.on("messages.upsert", require("./events/CommandHandler").chatUpdate.bind(bot));

    // Group events
    bot.ev.on("group-participants.update", async (update) => {
      const { id, participants, action } = update;

      try {
        const metadata = await bot.groupMetadata(id);
        
        for (const user of participants) {
          const userJid = user.split('@')[0];

          if (action === "add") {
            const welcomeMessage = `🎉 Selamat Datang di grup *${metadata.subject}*!\n\nHi @${userJid}, semoga betah ya di sini! Jangan lupa baca deskripsi grup.`;
            
            await bot.sendMessage(id, {
              text: welcomeMessage,
              mentions: [user]
            });

          } else if (action === "remove") {
            const goodbyeMessage = `👋 Selamat tinggal @${userJid}. Sampai jumpa lagi di lain waktu!`;
            
            await bot.sendMessage(id, {
              text: goodbyeMessage,
              mentions: [user]
            });
          }
        }
      } catch (error) {
        console.error("❌ Group event error:", error);
      }
    });

  } catch (error) {
    console.error('💥 StartBot error:', error);
    setTimeout(() => startBot().catch(console.error), 10000);
  }
}

function loadCommands(dir, bot) {
  if (!bot.commands) {
    bot.commands = new Collection();
  }
  
  bot.commands.clear();
  const commandsPath = path.join(__dirname, dir);
  
  if (!fs.existsSync(commandsPath)) {
    console.log(`📂 Creating ${dir} folder...`);
    fs.mkdirSync(commandsPath, { recursive: true });
    return;
  }
  
  let totalCommands = 0;
  const folders = fs.readdirSync(commandsPath);
  
  folders.forEach(folder => {
    const folderPath = path.join(commandsPath, folder);
    if (fs.statSync(folderPath).isDirectory()) {
      const files = fs.readdirSync(folderPath).filter(file => file.endsWith(".js"));
      
      files.forEach(file => {
        const filePath = path.join(folderPath, file);
        delete require.cache[require.resolve(filePath)];
        
        try {
          const command = require(filePath);
          if (command.name) {
            command.category = folder;
            bot.commands.set(command.name, command);
            totalCommands++;
            
            if (command.alias && Array.isArray(command.alias)) {
              command.alias.forEach(alias => {
                bot.commands.set(alias, command);
              });
            }
          }
        } catch (error) {
          console.error(`❌ Failed loading ${filePath}:`, error.message);
        }
      });
    }
  });
  
  console.log(`📋 Commands loaded: ${totalCommands}`);
}

// Start the bot
console.log('🤖 Starting WhatsApp Bot...');
console.log('📋 Multiple connection methods available');
console.log('🔧 Choose your preferred method when prompted\n');

startBot().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);
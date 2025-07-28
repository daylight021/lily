require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, getContentType, Browsers } = require('lily-baileys');

const Pino = require('pino');
const { Low, JSONFile } = require("./lib/lowdb");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const Collection = require("./lib/CommandCollections");
const readline = require("readline");

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

// Fungsi untuk menunggu dan retry pairing code
async function waitForValidPairingCode(bot, phoneNumber, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔄 Mencoba mendapatkan pairing code (attempt ${attempt}/${maxAttempts})...`);
    
    try {
      // Tunggu sebentar sebelum mencoba
      if (attempt > 1) {
        console.log('⏳ Menunggu 3 detik sebelum mencoba lagi...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      const code = await bot.requestPairingCode(phoneNumber);
      
      console.log(`[DEBUG] Raw response dari lily-baileys:`, JSON.stringify(code));
      
      // Cek apakah kode valid
      if (code && 
          typeof code === 'string' && 
          code.trim() !== '' &&
          code.toUpperCase() !== 'YOURCODE' &&
          !/undefined|null|error/i.test(code)) {
        
        // Bersihkan kode dari karakter ansi dan whitespace
        const cleanCode = code.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
                              .replace(/['"]/g, '')
                              .trim();
        
        // Validasi format kode (biasanya 6-8 karakter alphanumeric)
        if (cleanCode.length >= 6 && /^[A-Z0-9]+$/.test(cleanCode)) {
          console.log(`✅ Pairing code berhasil didapat: ${cleanCode}`);
          console.log(`📱 Buka WhatsApp > Settings > Linked Devices > Link a Device`);
          console.log(`📝 Masukkan kode: ${cleanCode}`);
          return cleanCode;
        }
      }
      
      console.log(`❌ Attempt ${attempt}: Kode tidak valid (${code})`);
      
    } catch (error) {
      console.log(`❌ Attempt ${attempt}: Error -`, error.message);
    }
    
    if (attempt === maxAttempts) {
      throw new Error('Gagal mendapatkan pairing code setelah beberapa percobaan');
    }
  }
}

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Ambil versi WA terbaru
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📱 Menggunakan WA v${version.join('.')}, Terbaru: ${isLatest}`);

    // Buat koneksi socket
    const bot = makeWASocket({
      version,
      logger: Pino({ level: 'silent' }),
      printQRInTerminal: false, // Disabled untuk VPS
      auth: state,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      // Tambahan opsi untuk stabilitas
      retryRequestDelayMs: 5000,
      maxMsgRetryCount: 3,
      msgRetryCounterCache: new Map(),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Inisialisasi commands collection jika belum ada
    if (!bot.commands) {
      bot.commands = new Collection();
    }

    // Load commands
    loadCommands('commands', bot);

    // Proses pairing code jika belum terdaftar
    if (!bot.authState.creds.registered) {
      console.log('🔐 Tidak ada sesi terdaftar, memulai proses pairing...');
      
      const phoneNumber = await question('📞 Masukkan nomor WhatsApp (format: 628123456789): ');
      
      // Validasi dan bersihkan nomor
      const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
      
      if (!cleanNumber.startsWith('62')) {
        console.error('❌ Nomor harus dimulai dengan 62 (kode negara Indonesia)');
        process.exit(1);
      }
      
      if (cleanNumber.length < 10 || cleanNumber.length > 15) {
        console.error('❌ Format nomor tidak valid');
        process.exit(1);
      }
      
      console.log(`📱 Memproses nomor: ${cleanNumber}`);
      
      // Tunggu bot siap
      console.log('⏳ Menunggu bot siap...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        const pairingCode = await waitForValidPairingCode(bot, cleanNumber);
        console.log(`\n🎉 PAIRING CODE ANDA: ${pairingCode}`);
        console.log('📋 Copy kode di atas dan masukkan ke WhatsApp Anda\n');
        
      } catch (error) {
        console.error('💥 Gagal mendapatkan pairing code:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Pastikan nomor WhatsApp benar dan aktif');
        console.log('2. Pastikan WhatsApp tidak sedang login di device lain');
        console.log('3. Coba restart bot dan ulangi proses');
        console.log('4. Pastikan koneksi internet stabil\n');
        process.exit(1);
      }
      
    } else {
      console.log('✅ Sesi ditemukan, bot akan terhubung otomatis');
    }

    // Event: Update credentials
    bot.ev.on('creds.update', saveCreds);

    // Event: Connection update
    bot.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log('🔌 Koneksi terputus:', lastDisconnect?.error?.message || 'Unknown error');
        console.log('🔄 Akan reconnect:', shouldReconnect);
        
        if (shouldReconnect) {
          console.log('⏳ Reconnecting dalam 5 detik...');
          setTimeout(() => {
            startBot().catch(console.error);
          }, 5000);
        } else {
          console.log('🚪 Bot logout, hapus auth_info_baileys untuk login ulang');
        }
      } else if (connection === 'open') {
        console.log('🚀 Bot berhasil terhubung!');
        console.log(`📱 Terhubung sebagai: ${bot.user?.name || 'Unknown'}`);
        console.log(`📞 Nomor: ${bot.user?.id?.split(':')[0] || 'Unknown'}`);
      } else if (connection === 'connecting') {
        console.log('🔄 Sedang menghubungkan...');
      }
    });

    // Event: Messages
    bot.ev.on("messages.upsert", require("./events/CommandHandler").chatUpdate.bind(bot));

    // Event: Group participants update
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
        console.error("❌ Error pada group participants update:", error);
      }
    });

    return bot;

  } catch (error) {
    console.error('💥 Error pada startBot:', error);
    throw error;
  }
}

function loadCommands(dir, bot) {
  if (!bot.commands) {
    bot.commands = new Collection();
  }
  
  bot.commands.clear();
  const commandsPath = path.join(__dirname, dir);
  
  if (!fs.existsSync(commandsPath)) {
    console.log(`📂 Folder ${dir} tidak ditemukan, membuat folder...`);
    fs.mkdirSync(commandsPath, { recursive: true });
    return;
  }
  
  const folders = fs.readdirSync(commandsPath);
  let totalCommands = 0;
  
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
                totalCommands++;
              });
            }
          }
        } catch (error) {
          console.error(`❌ Gagal memuat perintah dari ${filePath}:`, error.message);
        }
      });
    }
  });
  
  console.log(`📋 [COMMANDS] Berhasil dimuat: ${totalCommands} perintah dari ${folders.length} kategori.`);
}

// Jalankan bot
console.log('🤖 Memulai WhatsApp Bot...');
startBot().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error('💥 Uncaught Exception:', error);
});

process.on("unhandledRejection", (error) => {
  console.error('💥 Unhandled Rejection:', error);
});
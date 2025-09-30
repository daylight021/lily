require("dotenv").config();

// Override stdout SEBELUM require library apapun
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
let allowQRCode = false; // Flag untuk mengizinkan QR code

process.stdout.write = (chunk, encoding, callback) => {
  const str = chunk.toString();

  // Izinkan QR code saat flag aktif
  if (allowQRCode) {
    return originalStdoutWrite(chunk, encoding, callback);
  }

  // Blokir output yang mirip ASCII art dari Baileys
  // Deteksi pattern: banyak karakter #, █, ▓, ▒, ░ atau line penuh dengan karakter sama
  const isBaileysArt = (
    (str.match(/#/g) || []).length > 50 || // Lebih dari 50 karakter #
    str.includes('▓▓▓') || // Pattern blok berturut
    /^[█▓▒░\s]+$/m.test(str) // Hanya karakter blok dan spasi
  );
  if (isBaileysArt) {
    if (typeof callback === 'function') callback();
    return true;
  }

  return originalStdoutWrite(chunk, encoding, callback);
};

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  proto
} = require('lily-baileys');

const Pino = require('pino');
const { Low, JSONFile } = require("./lib/lowdb");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const qrcode = require('qrcode-terminal');
const Collection = require("./lib/CommandCollections");

// Set logger dengan level fatal untuk meminimalkan output
const store = makeInMemoryStore({
  logger: Pino({ level: 'fatal' }).child({ level: 'fatal', stream: 'store' })
});

// Fungsi utama untuk menjalankan bot
async function startBot() {
  console.log('[LOG] Memulai bot...');

  const { state, saveCreds } = await useMultiFileAuthState("sessions");

  const bot = makeWASocket({
    // Ubah ke level 'fatal' untuk mematikan semua log dari baileys
    logger: Pino({ level: "fatal" }),
    printQRInTerminal: false,
    browser: ['My-WhatsApp-Bot', 'Chrome', '1.0.0'],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "fatal" })),
    },
    getMessage: async (key) => store.loadMessage(key.remoteJid, key.id),
    // Opsi tambahan untuk mematikan print default
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Mengikat store ke event bot
  store.bind(bot.ev);
  bot.store = store;

  // Memuat Database
  const dbPath = path.join(__dirname, 'database.json');
  bot.db = new Low(new JSONFile(dbPath));
  await bot.db.read();
  bot.db.data = bot.db.data || { users: {}, groups: {} };
  setInterval(() => {
    bot.db.write().catch(console.error);
  }, 30 * 1000);

  // Memuat Perintah
  bot.commands = new Collection();
  loadCommands("commands", bot);
  chokidar.watch(path.join(__dirname, "commands"), { persistent: true, ignoreInitial: true })
    .on("all", () => loadCommands("commands", bot));

  // --- Event Handler yang Disesuaikan ---
  bot.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('------------------------------------------------');
      console.log('📱 Pindai QR Code di bawah ini:');

      // Aktifkan flag untuk mengizinkan QR code
      allowQRCode = true;
      qrcode.generate(qr, { small: true });
      // Matikan flag setelah QR code selesai ditampilkan
      setTimeout(() => { allowQRCode = false; }, 100);
    }

    if (connection === "close") {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[CONNECTION] Terputus karena: ${lastDisconnect.error}, menyambung ulang: ${shouldReconnect}`);
      if (shouldReconnect) {
        startBot();
      } else {
        console.log('[CONNECTION] Terputus permanen. Hapus folder "sessions" dan mulai ulang.');
      }
    } else if (connection === "open") {
      console.log(`✅ Koneksi berhasil tersambung sebagai ${bot.user.name || 'Bot'}`);
    }
  });

  // Menangani Event Lainnya
  bot.ev.on("creds.update", saveCreds);
  bot.ev.on("messages.upsert", require("./events/CommandHandler").chatUpdate.bind(bot));
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

  bot.game = {
    tebakkata: {}
  };
}

// Fungsi untuk memuat file perintah
function loadCommands(dir, bot) {
  bot.commands.clear();
  const commandsPath = path.join(__dirname, dir);
  fs.readdirSync(commandsPath).forEach(folder => {
    const folderPath = path.join(commandsPath, folder);
    if (fs.statSync(folderPath).isDirectory()) {
      fs.readdirSync(folderPath).filter(file => file.endsWith(".js")).forEach(file => {
        const filePath = path.join(folderPath, file);
        delete require.cache[require.resolve(filePath)];
        try {
          const command = require(filePath);
          command.category = folder;
          bot.commands.set(command.name, command);
          if (command.alias) {
            command.alias.forEach(alias => bot.commands.set(alias, command));
          }
        } catch (error) {
          console.error(`Gagal memuat perintah dari ${filePath}:`, error);
        }
      });
    }
  });
  console.log(`[COMMANDS] Berhasil dimuat: ${bot.commands.size} perintah.`);
}

// Menjalankan bot
startBot().catch(console.error);

// Menangani error yang tidak tertangkap
process.on("uncaughtException", console.error);
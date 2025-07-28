require("dotenv").config();
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

// --- Inisialisasi Store ---
const store = makeInMemoryStore({ logger: Pino().child({ level: 'silent', stream: 'store' }) });

// Fungsi utama untuk menjalankan bot
async function startBot() {
  console.log('[LOG] Memulai bot...');

  // --- Manajemen Sesi (Auth State) untuk lily-baileys ---
  const { state, saveCreds } = await useMultiFileAuthState("sessions");

  const bot = makeWASocket({
    logger: Pino({ level: "silent" }),
    printQRInTerminal: true, // Kita akan menangani QR secara manual
    browser: ['Chrome', '1.0.0'],
    auth: {
      creds: state.creds,
      // Menyimpan kunci sinyal di memori cache untuk kecepatan
      keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" }).child({ level: 'silent' })),
    },
    // Memberi tahu bot cara mengambil pesan yang tersimpan
    getMessage: async (key) => store.loadMessage(key.remoteJid, key.id)
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

  // --- Event Handler ---
  bot.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('------------------------------------------------');
      console.log('📱 Pindai QR Code di bawah ini:');
      qrcode.generate(qr, { small: true });
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

    // Mengambil metadata grup untuk mendapatkan nama grup
    let metadata;
    try {
      metadata = await bot.groupMetadata(id);
    } catch (e) {
      console.error("Gagal mengambil metadata grup:", e);
      return; // Hentikan jika gagal
    }

    // Loop melalui setiap partisipan yang terpengaruh
    for (const user of participants) {
      const userJid = user.split('@')[0];

      if (action === "add") {
        // Ketika ada anggota baru yang ditambahkan atau bergabung
        const welcomeMessage = `🎉 Selamat Datang di grup *${metadata.subject}*!\n\nHi @${userJid}, semoga betah ya di sini! Jangan lupa baca deskripsi grup.`;

        // Kirim pesan sambutan ke grup dengan mention
        bot.sendMessage(id, {
          text: welcomeMessage,
          mentions: [user]
        });

      } else if (action === "remove") {
        // Ketika ada anggota yang keluar atau dikeluarkan
        const goodbyeMessage = `👋 Selamat tinggal @${userJid}. Sampai jumpa lagi di lain waktu!`;

        // Kirim pesan perpisahan ke grup dengan mention
        bot.sendMessage(id, {
          text: goodbyeMessage,
          mentions: [user]
        });
      }
    }
  });
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
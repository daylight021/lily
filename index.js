require("dotenv").config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
} = require('lily-baileys');

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

async function startBot() {
  console.log('[LOG] Memulai bot...');
  const { state, saveCreds } = await useMultiFileAuthState("sessions");

  const bot = makeWASocket({
    logger: Pino({ level: "silent" }),
    printQRInTerminal: false, // Penting: Matikan QR code bawaan
    browser: ['Chrome (Linux)', '', ''],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: 'silent' }).child({ level: 'silent' })),
    },
    getMessage: async (key) => store.loadMessage(key.remoteJid, key.id)
  });

  store.bind(bot.ev);
  bot.store = store;

  // --- PERBAIKAN UTAMA: LOGIKA PAIRING CODE YANG BENAR ---
  // Cek apakah bot belum pernah terhubung/registrasi
  if (!bot.authState.creds.registered) {
    let phoneNumber = process.env.BOT_NUMBER;
    if (!phoneNumber) {
      phoneNumber = await question("Masukkan nomor WhatsApp Anda (format 62xxxxxxxx): ");
    }
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    // Meminta kode pairing. Kode akan diterima di event 'connection.update'
    setTimeout(async () => {
      await bot.requestPairingCode(phoneNumber);
    }, 3000); // Jeda untuk memastikan socket siap
  }
  // --- AKHIR PERBAIKAN ---

  const dbPath = path.join(__dirname, 'database.json');
  bot.db = new Low(new JSONFile(dbPath));
  await bot.db.read();
  bot.db.data = bot.db.data || { users: {}, groups: {} };
  setInterval(() => { bot.db.write().catch(console.error); }, 30 * 1000);

  bot.commands = new Collection();
  loadCommands("commands", bot);
  chokidar.watch(path.join(__dirname, "commands"), { persistent: true, ignoreInitial: true })
    .on("all", () => loadCommands("commands", bot));

  bot.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // --- PERBAIKAN UTAMA: Menangkap Pairing Code dari event ---
    // Properti 'qr' sekarang berisi pairing code, bukan data gambar
    if (qr) {
      const code = qr.match(/.{1,4}/g)?.join("-") || qr;
      console.log(`✅ Kode Pairing Anda: ${code}`);
      console.log("Buka WhatsApp > Perangkat Tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.");
    }
    // --- AKHIR PERBAIKAN ---

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

startBot().catch(console.error);
process.on("uncaughtException", console.error);
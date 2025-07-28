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

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // Langkah 1: Mengambil versi WA terbaru
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Menggunakan WA v${version.join('.')}, Terbaru: ${isLatest}`);

  // Langkah 2: Membuat koneksi dengan konfigurasi yang BENAR
  const bot = makeWASocket({
    version, // <-- Kunci #1: Menyuntikkan versi
    logger: Pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS('Desktop'), // <-- Kunci #2: Mengidentifikasi sebagai browser
  });

  // Langkah 3: Logika pairing code (hanya jika belum ada sesi)
  if (!bot.authState.creds.registered) {
    console.log('Tidak ada sesi terdaftar, memulai pairing code...');
    const phoneNumber = await question('Masukan Nomor Whatsapp Anda (contoh: 628123xxxx): ');
    try {
      const code = await bot.requestPairingCode(phoneNumber);
      console.log(`Kode Pairing Anda: ${code.replace(/["\u001b[0-9;]*m]/g, '')}`);
    } catch (error) {
      console.error('Gagal meminta pairing code:', error);
    }
  } else {
    console.log('Sesi ditemukan, bot terhubung.');
  }

  bot.ev.on('creds.update', saveCreds);

  bot.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus karena:', lastDisconnect.error, ', menyambungkan kembali:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('Bot berhasil tersambung!');
    }
  });

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

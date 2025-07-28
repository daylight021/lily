const { Game, Value, Color } = require('uno-engine');
const fs = require('fs');
const path = require('path');

// Variabel global untuk menyimpan semua sesi game yang aktif
const unoGames = {};

// --- FUNGSI PENTING UNTUK MENCEGAH SPAM ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Fungsi Helper untuk menerjemahkan input dan data kartu ---
const Terjemahan = {
    warna: {
        'merah': 'RED', 'red': 'RED',
        'kuning': 'YELLOW', 'yellow': 'YELLOW',
        'hijau': 'GREEN', 'green': 'GREEN',
        'biru': 'BLUE', 'blue': 'BLUE',
        'hitam': 'BLACK', 'black': 'BLACK'
    },
    nilai: {
        '0': 'ZERO', 'nol': 'ZERO', 'zero': 'ZERO',
        '1': 'ONE', 'satu': 'ONE', 'one': 'ONE',
        '2': 'TWO', 'dua': 'TWO', 'two': 'TWO',
        '3': 'THREE', 'tiga': 'THREE', 'three': 'THREE',
        '4': 'FOUR', 'empat': 'FOUR', 'four': 'FOUR',
        '5': 'FIVE', 'lima': 'FIVE', 'five': 'FIVE',
        '6': 'SIX', 'enam': 'SIX', 'six': 'SIX',
        '7': 'SEVEN', 'tujuh': 'SEVEN', 'seven': 'SEVEN',
        '8': 'EIGHT', 'delapan': 'EIGHT', 'eight': 'EIGHT',
        '9': 'NINE', 'sembilan': 'NINE', 'nine': 'NINE',
        'skip': 'SKIP', 'lewati': 'SKIP',
        'reverse': 'REVERSE', 'putar-balik': 'REVERSE',
        'draw-two': 'DRAW_TWO', 'tambah-2': 'DRAW_TWO', 'tambah_2': 'DRAW_TWO', '+2': 'DRAW_TWO',
        'wild': 'WILD', 'hitam': 'WILD',
        'wild-draw-four': 'WILD_DRAW_FOUR', 'tambah-4': 'WILD_DRAW_FOUR', 'tambah_4': 'WILD_DRAW_FOUR', 'wild_draw-4': 'WILD_DRAW_FOUR', 'wild-draw_4': 'WILD_DRAW_FOUR', '+4': 'WILD_DRAW_FOUR',
    }
};

function valueToString(value) {
    const key = Object.keys(Value).find(k => Value[k] === value);
    return key ? key.toLowerCase().replace(/_/g, '-') : 'unknown';
}

function colorToString(color) {
    if (!color) return null;
    const key = Object.keys(Color).find(k => Color[k] === color);
    return key ? key.toLowerCase() : null;
}

function cardToFileName(card) {
    const valueStr = valueToString(card.value);
    const colorStr = colorToString(card.color);
    if (valueStr === 'wild' || valueStr === 'wild-draw-four') {
        return `${valueStr}.png`;
    }
    return `${colorStr}_${valueStr}.png`;
}

function generateAllCommands(card, usedPrefix) {
    const engineCardValue = card.value;

    // Memeriksa wild card dengan membandingkan nilainya, bukan dengan fungsi isWildcard()
    if (engineCardValue === Value.WILD || engineCardValue === Value.WILD_DRAW_FOUR) {
        const wildAliases = Object.keys(Terjemahan.nilai).filter(k => Value[Terjemahan.nilai[k]] === engineCardValue);
        let text = `*Cara Mainkan Kartu Wild:*\n`;
        text += `Gunakan salah satu dari: \`${wildAliases.join('`, `')}\`\n`;
        text += `diikuti warna pilihan (merah/kuning/hijau/biru).\n\n`;
        text += `*Contoh:*\n\`${usedPrefix}uno ${wildAliases[0]} merah\``;
        return text;
    }

    const engineCardColor = card.color;
    const colorAliases = Object.keys(Terjemahan.warna).filter(k => Color[Terjemahan.warna[k]] === engineCardColor);
    const valueAliases = Object.keys(Terjemahan.nilai).filter(k => Value[Terjemahan.nilai[k]] === engineCardValue);

    let commands = [];
    for (const c of colorAliases) {
        for (const v of valueAliases) {
            commands.push(`\`${usedPrefix}uno ${c} ${v}\``);
        }
    }
    return `*Ketik di grup salah satu perintah ini:*\n\n${commands.join('\n')}`;
}


// --- FUNGSI-FUNGSI LAINNYA ---
async function sendPlayerHand(bot, player, hand, usedPrefix) {
    try {
        await bot.sendMessage(player.id, { text: "====================\n\n🃏 *Kartu Anda saat ini:* \n\n====================" });
        await sleep(500);

        for (const card of hand) {
            const fileName = cardToFileName(card);
            const filePath = path.join(__dirname, '../../lib/cards/', fileName);

            const caption = generateAllCommands(card, usedPrefix);

            if (fs.existsSync(filePath)) {
                await bot.sendMessage(player.id, { image: fs.readFileSync(filePath), caption });
            } else {
                const color = colorToString(card.color) || 'hitam';
                const value = valueToString(card.value).toUpperCase();
                await bot.sendMessage(player.id, { text: `Kartu: ${color.toUpperCase()} ${value}\n\n${caption}` });
                console.warn(`File kartu tidak ditemukan: ${fileName}`);
            }
            await sleep(Math.floor(Math.random() * 500) + 400);
        }
    } catch (e) {
        console.error(`Gagal mengirim kartu ke ${player.name}:`, e);
    }
}

async function announceGameState(bot, msg, session) {
    await sleep(1000);
    const game = session.game;
    const activePlayers = session.players.filter(p => p.isActive !== false);

    // Cek jika hanya ada 1 pemain aktif tersisa setelah giliran
    if (activePlayers.length <= 1) return;

    // Cari pemain saat ini dari daftar pemain yang masih aktif
    const currentPlayer = activePlayers.find(p => p.id === game.currentPlayer.name);

    // Jika currentPlayer tidak ditemukan (artinya dia baru saja menang),
    // biarkan uno-engine secara otomatis menentukan giliran berikutnya dan panggil lagi.
    if (!currentPlayer) {
        console.log("Pemain saat ini sudah menang, mencari giliran selanjutnya...");
        return;
    }

    const topCard = game.discardedCard;
    const topCardPath = path.join(__dirname, '../../lib/cards/', cardToFileName(topCard));
    if (!fs.existsSync(topCardPath)) return msg.reply("Error: Gagal menemukan gambar kartu teratas.");

    const playerMension = `${currentPlayer.name} (@${currentPlayer.id.split('@')[0]})`;
    let message = `*Giliran: ${playerMension}*\nJumlah kartu: ${game.getPlayer(currentPlayer.id).hand.length}`;

    await bot.sendMessage(msg.from, {
        image: fs.readFileSync(topCardPath),
        caption: `🃏 Kartu teratas: *${(colorToString(topCard.color) || 'WILD').toUpperCase()} ${valueToString(topCard.value).toUpperCase().replace(/-/g, ' ')}*\n\n${message}`,
        mentions: [currentPlayer.id]
    });
}

async function notifyPlayersOfEnd(bot, players, winner, endMessage) {
    for (const player of players) {
        try {
            // Cek apakah pesan khusus untuk pemenang atau pesan umum
            const messageToSend = (winner && player.id === winner.id) ? "Selamat, Anda memenangkan permainan! 🥳" : endMessage;
            await bot.sendMessage(player.id, { text: messageToSend });
            await sleep(500); // Jeda antar notifikasi
        } catch (e) {
            console.error(`Gagal mengirim notifikasi akhir ke ${player.name}:`, e);
        }
    }
}

// --- Logika Utama Perintah UNO ---
module.exports = {
    name: "uno",
    alias: ["unocreate", "unojoin", "unostart", "unoend", "unocards", "unodraw"],
    description: "Memainkan game UNO.",
    execute: async (msg, { bot, args, command, usedPrefix }) => {
        const groupId = msg.from;
        const senderId = msg.sender;
        const senderName = msg.pushName || "Pemain";

        if (command === "uno" && args.length === 0) {
            const helpMessage = `🃏 *Game UNO Bot* 🃏\n\nPerintah yang tersedia:\n\n*Lobi Permainan:*\n- \`${usedPrefix}unocreate\`: Membuat lobi baru.\n- \`${usedPrefix}unojoin\`: Bergabung ke lobi.\n- \`${usedPrefix}unostart\`: Memulai permainan (host).\n- \`${usedPrefix}unoend\`: Menghentikan permainan (host).\n\n*Saat Bermain:*\n- \`${usedPrefix}uno <warna> <nilai>\`: Memainkan kartu.\n- \`${usedPrefix}uno <wild> <warna>\`: Memainkan kartu wild.\n- \`${usedPrefix}unocards\`: Meminta kartu dikirim ulang.\n- \`${usedPrefix}unodraw\`: Mengambil kartu.`;
            return msg.reply(helpMessage.trim());
        }

        if (command === "unocreate") {
            if (unoGames[groupId]) return msg.reply("⚠️ Sudah ada sesi game UNO yang aktif di grup ini.");
            // Inisialisasi array 'winners' untuk sistem peringkat
            unoGames[groupId] = { host: senderId, players: [{ id: senderId, name: senderName }], status: 'waiting', winners: [] };
            return msg.reply(`✅ Lobi UNO dibuat oleh ${senderName} (@${senderId.split('@')[0]})!\nKetik \`${usedPrefix}unojoin\` untuk bergabung.`, { mentions: [senderId] });
        }

        if (command === "unojoin") {
            const session = unoGames[groupId];
            if (!session || session.status !== 'waiting') return msg.reply("⚠️ Tidak ada lobi untuk bergabung.");
            if (session.players.some(p => p.id === senderId)) return msg.reply("⚠️ Anda sudah bergabung.");
            session.players.push({ id: senderId, name: senderName });
            let playerList = session.players.map((p, i) => `${i + 1}. ${p.name} (@${p.id.split('@')[0]})`).join('\n');
            return msg.reply(`✅ ${senderName} (@${senderId.split('@')[0]}) berhasil bergabung!\n\n👥 *Pemain saat ini:*\n${playerList}`, { mentions: session.players.map(p => p.id) });
        }

        if (command === "unoend") {
            const session = unoGames[groupId];
            if (!session) return msg.reply("⚠️ Tidak ada game yang berjalan.");
            if (session.host !== senderId) return msg.reply("⚠️ Hanya host yang bisa menghentikan game.");

            await msg.react("🛑");

            // 1. Ambil metadata grup untuk mendapatkan nama grup
            let groupName = 'grup ini';
            try {
                const metadata = await bot.groupMetadata(groupId);
                groupName = metadata.subject;
            } catch (e) {
                console.error("Gagal mengambil metadata grup untuk pesan .unoend:", e);
            }

            // 2. Cari objek pemain host untuk mendapatkan nama & nomornya
            const hostPlayer = session.players.find(p => p.id === session.host);
            const hostName = hostPlayer ? hostPlayer.name : "Host";
            const hostNumber = session.host.split('@')[0];

            // 3. Buat pesan yang akan dikirim ke PM
            const endMessageForPM = `ℹ️ Game UNO di grup *${groupName}* telah dihentikan oleh host *${hostName}* (${hostNumber}).`;

            // 4. Kirim notifikasi ke semua pemain
            if (session.players.length > 0) {
                await notifyPlayersOfEnd(bot, session.players, null, endMessageForPM);
            }

            // 5. Buat pesan yang akan dikirim ke grup
            const endMessageForGroup = `ℹ️ Game UNO telah dihentikan oleh host ${hostName} (@${hostNumber}).`;

            delete unoGames[groupId]; // Hapus sesi game

            return msg.reply(endMessageForGroup, { mentions: [session.host] });
        }

        if (command === "unostart") {
            const session = unoGames[groupId];
            if (!session || session.host !== senderId) return msg.reply("⚠️ Hanya host yang bisa memulai game.");
            if (session.players.length < 2) return msg.reply("⚠️ Butuh minimal 2 pemain.");
            if (session.status === 'playing') return msg.reply("⚠️ Game sudah dimulai.");

            // --- MENGACAK URUTAN PEMAIN ---
            session.players.sort(() => Math.random() - 0.5);

            session.status = 'playing';
            session.game = new Game(session.players.map(p => p.id));

            await msg.reply(`✅ Urutan pemain telah diacak! Game dimulai! Mengirim kartu...`);
            await sleep(1500);
            for (const p of session.players) {
                await sendPlayerHand(bot, p, session.game.getPlayer(p.id).hand, usedPrefix);
            }
            await announceGameState(bot, msg, session);
            return;
        }

        const session = unoGames[groupId];
        if (!session || session.status !== 'playing') return;

        const game = session.game;
        const player = game.getPlayer(senderId);

        if (command === "unocards") {
            if (!player) return msg.reply("⚠️ Anda bukan bagian dari game ini.");
            await msg.react("👍");
            return await sendPlayerHand(bot, { id: senderId, name: senderName }, player.hand, usedPrefix);
        }

        if (command === "unodraw") {
            if (game.currentPlayer.name !== senderId) return msg.reply("⚠️ Belum giliran Anda!");
            try {
                game.draw();
                await msg.reply(`${senderName} (@${senderId.split('@')[0]}) mengambil sebuah kartu.`, { mentions: [senderId] });
                game.pass();
                await sleep(500);
                await sendPlayerHand(bot, { id: senderId, name: senderName }, player.hand, usedPrefix);
                await announceGameState(bot, msg, session);
            } catch (e) {
                return msg.reply(`⚠️ Gagal mengambil kartu: ${e.message}`);
            }
            return;
        }

        if (command === "uno") {
            if (game.currentPlayer.name !== senderId) return msg.reply("⚠️ Belum giliran Anda!");

            const player = game.getPlayer(senderId);
            const input1 = args[0]?.toLowerCase();
            const input2 = args[1]?.toLowerCase();
            let cardToPlay;

            try {
                // Logika untuk memilih kartu yang akan dimainkan
                const isWild = Terjemahan.nilai[input1] === 'WILD' || Terjemahan.nilai[input1] === 'WILD_DRAW_FOUR';
                if (isWild) {
                    const valueToFind = Value[Terjemahan.nilai[input1]];
                    cardToPlay = player.hand.find(c => c.value === valueToFind);
                    if (!cardToPlay) return msg.reply("⚠️ Anda tidak memiliki kartu wild tersebut!");
                    const chosenColorKey = Terjemahan.warna[input2];
                    if (!chosenColorKey) return msg.reply(`⚠️ Anda harus memilih warna setelah kartu wild! Contoh: \`${usedPrefix}uno ${input1} merah\``);
                    cardToPlay.color = Color[chosenColorKey];
                } else {
                    const colorKey = Terjemahan.warna[input1];
                    const valueKey = Terjemahan.nilai[input2];
                    if (!colorKey || !valueKey) return msg.reply("⚠️ Input kartu tidak valid. (Contoh: .uno merah 7)");
                    cardToPlay = player.hand.find(c => c.color === Color[colorKey] && c.value === Value[valueKey]);
                }
                if (!cardToPlay) return msg.reply("⚠️ Anda tidak memiliki kartu tersebut atau kartu tidak cocok!");

                // Mainkan kartu
                game.play(cardToPlay);

                // --- LOGIKA MULTI-WINNER TANPA RESET ---
                if (player.hand.length === 0) {
                    const winnerRank = session.winners.length + 1;
                    const winnerPlayer = session.players.find(p => p.id === senderId);

                    // Tandai pemain sebagai tidak aktif agar dilewati di giliran berikutnya
                    winnerPlayer.isActive = false;
                    session.winners.push({ rank: winnerRank, name: winnerPlayer.name, id: winnerPlayer.id });

                    await msg.reply(`🎉 *LUAR BIASA!* 🎉\n\n${winnerPlayer.name} (@${winnerPlayer.id.split('@')[0]}) berhasil menjadi *Juara ${winnerRank}*!`, { mentions: [winnerPlayer.id] });

                    const remainingPlayers = session.players.filter(p => p.isActive !== false);

                    // Periksa jika permainan sudah selesai
                    if (remainingPlayers.length <= 1) {
                        if (remainingPlayers.length === 1) {
                            const lastPlayer = remainingPlayers[0];
                            session.winners.push({ rank: winnerRank + 1, name: lastPlayer.name, id: lastPlayer.id });
                        }

                        let finalScoreboard = session.winners
                            .map(w => `Juara ${w.rank}: ${w.name} (@${w.id.split('@')[0]})`)
                            .join('\n');

                        await sleep(1500);
                        await msg.reply(`🏆 *PERMAINAN SELESAI* 🏆\n\nBerikut adalah papan peringkat akhir:\n\n${finalScoreboard}`, { mentions: session.winners.map(w => w.id) });

                        delete unoGames[groupId]; // Hapus sesi game
                        return;
                    }

                    // Jika permainan belum selesai, lanjutkan
                    await sleep(1500);
                    await msg.reply(`Permainan berlanjut dengan ${remainingPlayers.length} pemain tersisa...`);

                    // Langsung panggil announceGameState untuk melanjutkan ke giliran pemain aktif berikutnya
                    await announceGameState(bot, msg, session);

                } else {
                    // Jika belum menang, lanjutkan seperti biasa
                    await msg.react("🃏");
                    await sleep(1000);
                    await announceGameState(bot, msg, session);
                    await sendPlayerHand(bot, { id: senderId, name: senderName }, player.hand, usedPrefix);
                }

            } catch (e) {
                console.error("Error saat memainkan kartu UNO:", e);
                return msg.reply(`❌ Gagal memainkan kartu: ${e.message}`);
            }
        }
    },
};
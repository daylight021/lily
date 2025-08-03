const fs = require('fs');
const path = require('path');

// Path ke file soal, pastikan lokasinya benar (sejajar dengan database.json)
const soalPath = path.join(__dirname, '..', '..', 'lib', 'tebakkata-soal.json');
const allSoal = JSON.parse(fs.readFileSync(soalPath));

// Fungsi untuk membuat soal hangman
function generateHangman(word) {
    let letters = word.split('');
    let lettersToRemove = Math.floor(letters.length * (Math.random() * 0.2 + 0.4));
    if (lettersToRemove === 0) lettersToRemove = 2; // Pastikan minimal 2 huruf hilang

    for (let i = 0; i < lettersToRemove; i++) {
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * letters.length);
        } while (letters[randomIndex] === '_');
        letters[randomIndex] = '_';
    }
    return letters.join(' ');
}

// Fungsi untuk mengirim soal
async function sendQuestion(bot, groupId) {
    const gameSession = bot.game.tebakkata[groupId];
    if (!gameSession) return;

    const levels = ['mudah', 'menengah', 'sulit'];
    const randomLevel = levels[Math.floor(Math.random() * levels.length)];
    const soalPool = allSoal[randomLevel];
    const currentSoal = soalPool[Math.floor(Math.random() * soalPool.length)];

    const questionText = generateHangman(currentSoal.soal);
    const points = randomLevel === 'mudah' ? 1000 : randomLevel === 'menengah' ? 3000 : 5000;

    // Tambahkan counter soal
    if (!gameSession.questionCount) gameSession.questionCount = 0;
    gameSession.questionCount++;

    const message = await bot.sendMessage(groupId, {
        text: `🧩 *Tebak Kata* 🧩\n\n` +
              `📊 Soal ke-${gameSession.questionCount}\n` +
              `🎯 Level: *${randomLevel.toUpperCase()}*\n` +
              `💡 Clue: *${currentSoal.clue}*\n` +
              `🔤 Soal: \`\`\`${questionText}\`\`\`\n\n` +
              `💰 Poin: *${points}*\n` +
              `⏰ Timeout: 60 detik\n\n` +
              `📝 *Reply pesan ini untuk menjawab!*`
    });

    gameSession.answer = currentSoal.soal;
    gameSession.points = points;
    gameSession.questionMsgId = message.key.id;
    gameSession.level = randomLevel;

    console.log(`[GAME_QUESTION] Sent question #${gameSession.questionCount}, ID: ${message.key.id}, Answer: ${currentSoal.soal}`);

    // Clear timeout lama jika ada
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
    }

    gameSession.timeout = setTimeout(() => {
        timeoutQuestion(bot, groupId);
    }, 60000);
}

// Fungsi untuk handle timeout per soal (bukan end game)
async function timeoutQuestion(bot, groupId) {
    const gameSession = bot.game.tebakkata[groupId];
    if (!gameSession) return;

    await bot.sendMessage(groupId, { 
        text: `⏰ *Waktu Habis!*\n\n` +
              `Jawaban yang benar adalah: *${gameSession.answer}*\n` +
              `Level: ${gameSession.level}\n\n` +
              `🔄 Bersiap untuk soal berikutnya...`
    });

    // Lanjut ke soal berikutnya setelah 3 detik
    setTimeout(() => {
        if (bot.game.tebakkata[groupId]) {
            sendQuestion(bot, groupId);
        }
    }, 3000);
}

// Fungsi untuk mengakhiri game
async function endGame(bot, groupId) {
    const gameSession = bot.game.tebakkata[groupId];
    if (!gameSession) return;

    // Clear timeout jika ada
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
    }

    let sessionLeaderboardText = '-- LEADERBOARD SESI INI --\n';
    const sessionScores = gameSession.sessionScores;
    const sortedSession = Object.entries(sessionScores).sort(([, a], [, b]) => b - a);

    if (sortedSession.length > 0) {
        sortedSession.forEach(([userId, score], index) => {
            const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
            sessionLeaderboardText += `${medal} @${userId.split('@')[0]} - *${score}* Poin\n`;
        });

        const db = bot.db;
        if (!db.data.tebakKataLeaderboard) {
            db.data.tebakKataLeaderboard = {};
        }
        for (const [userId, score] of sortedSession) {
            db.data.tebakKataLeaderboard[userId] = (db.data.tebakKataLeaderboard[userId] || 0) + score;
        }
        await db.write();
    } else {
        sessionLeaderboardText += '_Tidak ada yang berhasil menjawab di sesi ini._\n';
    }

    const globalLeaderboard = bot.db.data.tebakKataLeaderboard || {};
    const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
    let globalLeaderboardText = '\n-- LEADERBOARD GLOBAL --\n';
    if (sortedGlobal.length > 0) {
         sortedGlobal.forEach(([userId, score], index) => {
            const medal = ['🏆', '🏅', '🏅'][index] || '🏅';
            globalLeaderboardText += `${medal} ${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
        });
    } else {
        globalLeaderboardText += '_Leaderboard global masih kosong._'
    }

    const mentions = sortedSession.map(([userId]) => userId).concat(sortedGlobal.map(([userId]) => userId));
    await bot.sendMessage(groupId, { 
        text: `🎮 *GAME TEBAK KATA BERAKHIR!*\n\n` +
              `📊 Total soal dimainkan: ${gameSession.questionCount || 0}\n\n` +
              `${sessionLeaderboardText}${globalLeaderboardText}\n\n` +
              `Terima kasih telah bermain! 🎉`,
        mentions: [...new Set(mentions)]
    });
    
    delete bot.game.tebakkata[groupId];
}

module.exports = {
    name: 'tebakkata',
    category: 'game',
    aliases: ['tkata'],
    description: 'Mini-game tebak kata seru!',
    group: true, // Tambahkan ini agar hanya bisa dimainkan di grup
    async execute(msg, extra) {
        const { from } = msg;
        const { bot, args } = extra;
        const subCommand = args[0]?.toLowerCase();

        // Inisialisasi game object jika belum ada
        if (!bot.game) {
            bot.game = {};
        }
        if (!bot.game.tebakkata) {
            bot.game.tebakkata = {};
        }

        if (subCommand === 'start') {
            if (bot.game.tebakkata?.[from]) {
                return bot.sendMessage(from, { 
                    text: '⚠️ Sesi "Tebak Kata" sudah berjalan di grup ini!\n\n' +
                          'Gunakan `.tebakkata stop` untuk menghentikan sesi yang sedang berjalan.' 
                });
            }
            
            bot.game.tebakkata[from] = {
                sessionScores: {},
                answer: null,
                points: 0,
                questionMsgId: null,
                timeout: null,
                questionCount: 0,
                level: null
            };

            await bot.sendMessage(from, { 
                text: '🎉 *SESI TEBAK KATA DIMULAI!*\n\n' +
                      '🎯 Bersiaplah untuk tantangan kata-kata seru!\n' +
                      '💡 Baca clue dengan teliti\n' +
                      '📝 Reply pesan soal untuk menjawab\n' +
                      '⏰ Setiap soal ada batas waktu 60 detik\n\n' +
                      '🚀 *Soal pertama akan segera muncul...*'
            });
            
            // Delay 2 detik sebelum soal pertama
            setTimeout(() => {
                if (bot.game.tebakkata[from]) {
                    sendQuestion(bot, from);
                }
            }, 2000);

        } else if (subCommand === 'stop') {
            if (!bot.game.tebakkata?.[from]) {
                return bot.sendMessage(from, { text: '❌ Tidak ada sesi "Tebak Kata" yang berjalan di grup ini.' });
            }
            
            await endGame(bot, from);

        } else if (subCommand === 'leaderboard' || subCommand === 'lb') {
            const globalLeaderboard = bot.db.data.tebakKataLeaderboard || {};
            const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
            
            if (sortedGlobal.length === 0) {
                return bot.sendMessage(from, { text: '🏆 Leaderboard "Tebak Kata" masih kosong.\n\nMulai bermain dengan `.tebakkata start`!' });
            }

            let text = '🏆 *LEADERBOARD GLOBAL TEBAK KATA*\n\n';
            const mentions = [];
            sortedGlobal.forEach(([userId, score], index) => {
                 const medal = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
                 text += `${medal} ${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
                 mentions.push(userId);
            });
            
            text += '\n💡 *Tip:* Semakin sulit level soal, semakin besar poin yang didapat!';
            await bot.sendMessage(from, { text, mentions });

        } else if (subCommand === 'status') {
            const gameSession = bot.game.tebakkata?.[from];
            if (!gameSession) {
                return bot.sendMessage(from, { 
                    text: '❌ Tidak ada sesi game yang aktif.\n\nMulai dengan `.tebakkata start`!' 
                });
            }

            const sessionScores = Object.entries(gameSession.sessionScores).sort(([, a], [, b]) => b - a);
            let statusText = `🎮 *STATUS GAME TEBAK KATA*\n\n`;
            statusText += `📊 Soal ke: ${gameSession.questionCount || 0}\n`;
            statusText += `🎯 Level saat ini: ${gameSession.level || 'Belum dimulai'}\n\n`;
            
            if (sessionScores.length > 0) {
                statusText += `🏆 *Skor Sementara:*\n`;
                sessionScores.forEach(([userId, score], index) => {
                    const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
                    statusText += `${medal} @${userId.split('@')[0]} - ${score} poin\n`;
                });
            } else {
                statusText += `🏆 *Skor Sementara:*\n_Belum ada yang menjawab benar_`;
            }

            const mentions = sessionScores.map(([userId]) => userId);
            await bot.sendMessage(from, { text: statusText, mentions });

        } else {
            const helpText = `🎯 *BANTUAN GAME TEBAK KATA* 🧩\n\n` +
                           `📋 *Perintah yang tersedia:*\n\n` +
                           `1️⃣ \`.tebakkata start\`\n   🚀 Memulai sesi permainan baru\n\n` +
                           `2️⃣ \`.tebakkata stop\`\n   🛑 Menghentikan sesi yang sedang berjalan\n\n` +
                           `3️⃣ \`.tebakkata leaderboard\`\n   🏆 Melihat peringkat poin global\n\n` +
                           `4️⃣ \`.tebakkata status\`\n   📊 Melihat status game saat ini\n\n` +
                           `🎮 *Cara Bermain:*\n` +
                           `• Bot akan mengirimkan soal hangman\n` +
                           `• Reply/balas pesan soal dengan jawabanmu\n` +
                           `• Setiap soal punya batas waktu 60 detik\n` +
                           `• Poin berbeda untuk setiap level:\n` +
                           `  - Mudah: 1000 poin\n` +
                           `  - Menengah: 3000 poin\n` +
                           `  - Sulit: 5000 poin\n\n` +
                           `💡 *Tips:* Baca clue dengan teliti untuk bantuan!`;
            await bot.sendMessage(from, { text: helpText });
        }
    },
    sendQuestion,
    endGame,
    timeoutQuestion
};
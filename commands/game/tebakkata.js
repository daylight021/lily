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

    const message = await bot.sendMessage(groupId, {
        text: `🧩 *Tebak Kata* 🧩\n\nClue: *${currentSoal.clue}*\nSoal: \`\`\`${questionText}\`\`\`\n\nPoin: *${points}*\nTimeout: 60 detik\n\nReply pesan ini untuk menjawab!`
    });

    gameSession.answer = currentSoal.soal;
    gameSession.points = points;
    gameSession.questionMsgId = message.key.id;

    gameSession.timeout = setTimeout(() => {
        endGame(bot, groupId);
    }, 60000);
}

// Fungsi untuk mengakhiri game
async function endGame(bot, groupId) {
    const gameSession = bot.game.tebakkata[groupId];
    if (!gameSession) return;

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
        text: `Waktu Habis! 🕔 Jawaban yang benar adalah: *${gameSession.answer}*\n\nSesi permainan telah berakhir!\n\n${sessionLeaderboardText}${globalLeaderboardText}`,
        mentions: [...new Set(mentions)]
    });
    
    delete bot.game.tebakkata[groupId];
}


module.exports = {
    name: 'tebakkata',
    category: 'game',
    aliases: ['tkata'],
    description: 'Mini-game tebak kata seru!',
    // Perbaiki parameter fungsi execute
    async execute(msg, extra) {
        const { from } = msg;
        const { bot, args } = extra; // Ambil bot dan args dari extra
        const subCommand = args[0]?.toLowerCase();

        if (subCommand === 'start') {
            if (bot.game.tebakkata?.[from]) {
                return bot.sendMessage(from, { text: 'Sesi "Tebak Kata" sudah berjalan di grup ini. Selesaikan dulu sesi yang ada!' });
            }
            
            bot.game.tebakkata[from] = {
                sessionScores: {},
                answer: null,
                points: 0,
                questionMsgId: null,
                timeout: null
            };

            await bot.sendMessage(from, { text: '🎉 Sesi "Tebak Kata" dimulai! Siapkan jarimu!' });
            sendQuestion(bot, from);

        } else if (subCommand === 'leaderboard') {
            const globalLeaderboard = bot.db.data.tebakKataLeaderboard || {};
            const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
            
            if (sortedGlobal.length === 0) {
                return bot.sendMessage(from, { text: '🏆 Leaderboard "Tebak Kata" masih kosong.' });
            }

            let text = '🏆 *LEADERBOARD GLOBAL TEBAK KATA*\n\n';
            const mentions = [];
            sortedGlobal.forEach(([userId, score], index) => {
                 text += `${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
                 mentions.push(userId);
            });
            await bot.sendMessage(from, { text, mentions });

        } else {
            const helpText = `*Bantuan Game Tebak Kata* 🎲\n\nBerikut adalah perintah yang tersedia:\n\n1. \`.tebakkata start\`\n   Untuk memulai sesi permainan baru.\n\n2. \`.tebakkata leaderboard\`\n   Untuk melihat peringkat poin global.\n\n*Cara Bermain:*\n- Bot akan mengirimkan soal.\n- Reply/balas pesan soal tersebut dengan jawabanmu.\n- Sesi berakhir jika tidak ada yang menjawab dalam 60 detik.`;
            await bot.sendMessage(from, { text: helpText });
        }
    },
    sendQuestion
};
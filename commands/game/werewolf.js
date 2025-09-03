const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const games = {}; // Menyimpan semua sesi game yang aktif

const donationMessage = "Jika anda suka dengan bot ini, kamu bisa mensupport pengembang agar mereka lebih semangat lagi dan juga agar bot tetap online, Berapa pun yang kalian berikan akan sangat berarti bagi kami😊❤️\n\n💰 *Donasi:* [Saweria](https://saweria.co/daylight021)";

// --- KONFIGURASI DAN DATA GAME ---
const Roles = { WEREWOLF: 'WEREWOLF', VILLAGER: 'VILLAGER', SEER: 'SEER', HUNTER: 'HUNTER', CUPID: 'CUPID' };
const RoleInfo = {
    [Roles.WEREWOLF]: { name: "Werewolf 🐺", team: "Werewolf", description: "Setiap malam, bersama werewolf lain, pilih satu warga untuk dimangsa. Balas pesan ini dengan me-mention targetmu.", image: 'werewolf.jpg' },
    [Roles.VILLAGER]: { name: "Villager 👨‍🌾", team: "Villagers", description: "Kamu adalah warga biasa. Gunakan intuisimu untuk menemukan siapa werewolf dan gantung mereka di siang hari.", image: 'villager.jpg' },
    [Roles.SEER]: { name: "Seer 🔮", team: "Villagers", description: "Setiap malam, kamu bisa memilih satu pemain untuk diselidiki. Balas pesan ini dengan me-mention targetmu.", image: 'seer.jpg' },
    [Roles.HUNTER]: { name: "Hunter 🏹", team: "Villagers", description: "Jika kamu terbunuh, kamu bisa membalas dendam dengan menembak dan membunuh satu pemain lain.", image: 'hunter.jpg' },
    [Roles.CUPID]: { name: "Cupid 💘", team: "Villagers", description: "Pada malam pertama, pilih dua pemain untuk menjadi sepasang kekasih. Balas pesan ini dengan me-mention DUA pemain.", image: 'cupid.jpg' }
};
const GameState = { WAITING: 'waiting', PLAYING: 'playing', ENDED: 'ended' };
const GamePhase = { NIGHT_CUPID: 'cupid', NIGHT_WEREWOLF: 'werewolf', NIGHT_SEER: 'seer', DAY_DISCUSSION: 'discussion', DAY_VOTING: 'voting', HUNTER_REVENGE: 'hunter', EXECUTION: 'execution' };
const TIMEOUTS = { DISCUSSION: 60000, VOTING: 45000, NIGHT_ACTION: 40000 };

// --- FUNGSI-FUNGSI GAME ---

function assignRoles(players) {
    let rolesToAssign = [];
    const pCount = players.length;
    if (pCount >= 5) rolesToAssign.push(Roles.WEREWOLF, Roles.SEER, Roles.CUPID, Roles.HUNTER);
    if (pCount >= 7) rolesToAssign.push(Roles.WEREWOLF);
    while (rolesToAssign.length < pCount) rolesToAssign.push(Roles.VILLAGER);
    rolesToAssign = rolesToAssign.sort(() => Math.random() - 0.5);
    players.forEach((p, i) => { p.role = rolesToAssign[i]; p.isAlive = true; p.vote = null; p.lover = null; });
}

async function sendRoleInfo(bot, player, game) {
    const roleData = RoleInfo[player.role];
    const imagePath = path.join(__dirname, `../../lib/werewolf/${roleData.image}`);
    let text = `Selamat malam, ${player.name}!\n\nDi desa ini, kamu berperan sebagai *${roleData.name}*.\n\n*Tim:* ${roleData.team}\n*Tugasmu:*\n${roleData.description}`;
    if (player.role === Roles.WEREWOLF) {
        const otherWerewolves = game.players.filter(p => p.role === Roles.WEREWOLF && p.id !== player.id);
        if (otherWerewolves.length > 0) {
            const teammateNames = otherWerewolves.map(w => w.name).join(', ');
            text += `\n\nTeman werewolf-mu malam ini adalah: *${teammateNames}*. Berdiskusilah dengan mereka untuk memilih target!`;
        } else {
            text += `\n\nKamu adalah satu-satunya werewolf. Pilihlah mangsamu dengan bijak.`;
        }
    }
    try {
        if (fs.existsSync(imagePath)) {
            await bot.sendMessage(player.id, { image: fs.readFileSync(imagePath), caption: text });
        } else {
            await bot.sendMessage(player.id, { text: text });
        }
    } catch (e) {
        console.error(`Gagal kirim peran ke ${player.name}:`, e);
        await bot.sendMessage(game.id, { text: `Gagal mengirim peran ke ${player.name}. Pastikan bot tidak diblokir.` });
    }
}

function getPlayerList(players, showRole = false) {
    return players.map((p, i) => `${i + 1}. ${p.name} ${p.isAlive ? '❤️' : '💀'}${showRole ? ` (${RoleInfo[p.role].name})` : ''}`).join('\n');
}

function checkWinCondition(game) {
    const alivePlayers = game.players.filter(p => p.isAlive);
    const aliveWerewolves = alivePlayers.filter(p => p.isAlive && p.role === Roles.WEREWOLF);
    const aliveVillagers = alivePlayers.filter(p => p.isAlive && p.role !== Roles.WEREWOLF);
    if (aliveWerewolves.length === 0) return 'VILLAGERS';
    if (aliveWerewolves.length >= aliveVillagers.length) return 'WEREWOLF';
    const lovers = game.players.filter(p => p.lover);
    if (lovers.length === 2 && lovers.every(p => p.isAlive) && alivePlayers.length === 2) return 'LOVERS';
    return null;
}

async function notifyPlayersOfEnd(bot, players, endMessage) {
    for (const player of players) {
        try {
            await bot.sendMessage(player.id, { text: endMessage });
            await sleep(500); // Jeda antar notifikasi agar tidak spam
        } catch (e) {
            console.error(`Gagal mengirim notifikasi akhir ww ke ${player.name}:`, e);
        }
    }
}

async function handlePlayerDeath(bot, game, killedPlayer, cause) {
    if (!killedPlayer || !killedPlayer.isAlive) return [];
    killedPlayer.isAlive = false;
    let deathAnnouncements = [cause.replace('{player}', `*${killedPlayer.name}*`)];
    if (killedPlayer.lover) {
        const lover = game.players.find(p => p.id === killedPlayer.lover);
        if (lover && lover.isAlive) {
            lover.isAlive = false;
            deathAnnouncements.push(`Dalam kesedihan mendalam, *${lover.name}* ditemukan tak bernyawa di samping kekasihnya, mati karena patah hati. 💔`);
            if (lover.role === Roles.HUNTER) game.hunterTrigger = lover;
        }
    }
    if (killedPlayer.role === Roles.HUNTER) game.hunterTrigger = killedPlayer;
    return deathAnnouncements;
}

async function progressGame(bot, groupId) {
    const game = games[groupId];
    if (!game || game.status !== GameState.PLAYING) return;
    if (game.timeout) clearTimeout(game.timeout);

    const winner = checkWinCondition(game);
    if (winner) {
        game.status = GameState.ENDED;
        let endMessage = `🎉 *PERMAINAN BERAKHIR!* 🎉\n\nTim *${winner}* telah memenangkan permainan!\n\n*Daftar Peran Terakhir:*\n` + getPlayerList(game.players, true);
        await bot.sendMessage(groupId, { text: endMessage });
        await bot.sendMessage(groupId, { text: donationMessage });
        delete games[groupId];
        return;
    }

    switch (game.phase) {
        case GameState.WAITING:
            game.day += 1;
            game.actions = [];
            game.hunterTrigger = null;
            game.phase = GamePhase.NIGHT_CUPID;
            await bot.sendMessage(groupId, { text: `*NARASI:*\nSaat senja tiba, kabut tebal kembali menyelimuti desa...\n\n*Malam ${game.day} telah tiba.* 🌙` });
            await progressGame(bot, groupId);
            break;

        case GamePhase.NIGHT_CUPID:
            game.phase = GamePhase.NIGHT_WEREWOLF;
            const cupid = game.players.find(p => p.role === Roles.CUPID && p.isAlive);
            if (cupid && game.day === 1) {
                await bot.sendMessage(groupId, { text: `*Cupid*, bangunlah dan pilih dua orang untuk kau jadikan sepasang kekasih...` });
                const playerList = "Pilih dua pemain dengan membalas pesan ini (mention keduanya):\n" + getPlayerList(game.players.filter(p => p.isAlive));
                await bot.sendMessage(cupid.id, { text: playerList });
                game.timeout = setTimeout(() => progressGame(bot, groupId), TIMEOUTS.NIGHT_ACTION);
            } else {
                await progressGame(bot, groupId);
            }
            break;

        case GamePhase.NIGHT_WEREWOLF:
            game.phase = GamePhase.NIGHT_SEER;
            await bot.sendMessage(groupId, { text: `Para *Werewolf*... bangunlah dan pilih mangsa kalian...` });
            const werewolves = game.players.filter(p => p.role === Roles.WEREWOLF && p.isAlive);
            const victimList = "Pilih satu mangsa dengan membalas pesan ini (mention target):\n" + getPlayerList(game.players.filter(p => p.isAlive && p.role !== Roles.WEREWOLF));
            for (const ww of werewolves) await bot.sendMessage(ww.id, { text: victimList });
            game.timeout = setTimeout(() => progressGame(bot, groupId), TIMEOUTS.NIGHT_ACTION);
            break;

        case GamePhase.NIGHT_SEER:
            game.phase = GamePhase.DAY_DISCUSSION;
            const seer = game.players.find(p => p.role === Roles.SEER && p.isAlive);
            if (seer) {
                await bot.sendMessage(groupId, { text: `*Seer*, bangunlah. Siapakah yang ingin kamu selidiki?` });
                const investigationList = "Pilih satu orang untuk diselidiki (balas dengan mention):\n" + getPlayerList(game.players.filter(p => p.isAlive && p.id !== seer.id));
                await bot.sendMessage(seer.id, { text: investigationList });
                game.timeout = setTimeout(() => progressGame(bot, groupId), TIMEOUTS.NIGHT_ACTION);
            } else {
                await progressGame(bot, groupId);
            }
            break;

        case GamePhase.DAY_DISCUSSION:
            let deathAnnouncements = [];
            let killedPlayerId = null;
            const werewolfVotes = game.actions.filter(a => a.type === 'kill' && a.day === game.day);
            if (werewolfVotes.length > 0) {
                const voteCounts = werewolfVotes.reduce((acc, vote) => { acc[vote.to] = (acc[vote.to] || 0) + 1; return acc; }, {});
                let maxVotes = 0, tied = false;
                for (const targetId in voteCounts) {
                    if (voteCounts[targetId] > maxVotes) { maxVotes = voteCounts[targetId]; killedPlayerId = targetId; tied = false; }
                    else if (voteCounts[targetId] === maxVotes) { tied = true; }
                }
                if (tied) killedPlayerId = null;
            }

            if (killedPlayerId) {
                const killedPlayer = game.players.find(p => p.id === killedPlayerId);
                const announcements = await handlePlayerDeath(bot, game, killedPlayer, `Saat fajar menyingsing, warga menemukan mayat {player} dengan luka cakaran! 😱`);
                deathAnnouncements.push(...announcements);
            } else {
                deathAnnouncements.push("Pagi ini terasa damai. Ajaibnya, tidak ada korban jiwa semalam.");
            }

            await bot.sendMessage(groupId, { text: "*NARASI:*\n" + deathAnnouncements.join('\n') });
            await sleep(2000);

            if (game.hunterTrigger) {
                game.phase = GamePhase.HUNTER_REVENGE;
                const hunter = game.hunterTrigger;
                const alivePlayersList = getPlayerList(game.players.filter(p => p.isAlive && p.id !== hunter.id));
                await bot.sendMessage(groupId, { text: `Dengan nafas terakhirnya, *${hunter.name}* sang Hunter mengangkat busurnya untuk satu tembakan terakhir!` });
                await bot.sendMessage(hunter.id, { text: `Kamu telah terbunuh, tapi misimu belum selesai. Pilih satu orang untuk kau bawa mati bersamamu. Balas pesan ini dengan me-mention targetmu.\n\nDaftar target:\n${alivePlayersList}` });
                game.timeout = setTimeout(() => { bot.sendMessage(groupId, { text: `*${hunter.name}* kehabisan waktu dan tidak sempat melepaskan tembakan balasannya.` }); game.phase = GamePhase.DAY_DISCUSSION; progressGame(bot, groupId); }, TIMEOUTS.NIGHT_ACTION);
                return;
            }

            const earlyWinner = checkWinCondition(game);
            if (earlyWinner) return await progressGame(bot, groupId);

            await bot.sendMessage(groupId, { text: `Warga desa yang tersisa:\n${getPlayerList(game.players.filter(p => p.isAlive))}\n\nKalian punya *${TIMEOUTS.DISCUSSION / 1000} detik* untuk berdiskusi!` });
            game.phase = GamePhase.DAY_VOTING;
            game.timeout = setTimeout(() => progressGame(bot, groupId), TIMEOUTS.DISCUSSION);
            break;

        case GamePhase.DAY_VOTING:
            game.players.forEach(p => p.vote = null);
            await bot.sendMessage(groupId, { text: `Waktu diskusi habis! Saatnya voting.\nKalian punya *${TIMEOUTS.VOTING / 1000} detik*.\n\nGunakan \`${usedPrefix}vote @pemain\`.` });
            game.phase = GamePhase.EXECUTION;
            game.timeout = setTimeout(() => progressGame(bot, groupId), TIMEOUTS.VOTING);
            break;

        case GamePhase.EXECUTION:
            const votes = {};
            game.players.filter(p => p.isAlive && p.vote).forEach(p => { votes[p.vote] = (votes[p.vote] || 0) + 1; });
            let maxVotes = 0, lynchedPlayerId = null, tie = false;
            for (const targetId in votes) {
                if (votes[targetId] > maxVotes) { maxVotes = votes[targetId]; lynchedPlayerId = targetId; tie = false; }
                else if (votes[targetId] === maxVotes) { tie = true; }
            }
            if (tie) lynchedPlayerId = null;

            if (lynchedPlayerId) {
                const lynchedPlayer = game.players.find(p => p.id === lynchedPlayerId);
                const announcements = await handlePlayerDeath(bot, game, lynchedPlayer, `Warga desa sepakat! {player} digantung di alun-alun. Dia adalah seorang *${RoleInfo[lynchedPlayer.role].name}*!`);
                await bot.sendMessage(groupId, { text: announcements.join('\n') });
                if (game.hunterTrigger) {
                    game.phase = GamePhase.HUNTER_REVENGE; // Ulangi logika hunter
                    return await progressGame(bot, groupId);
                }
            } else {
                await bot.sendMessage(groupId, { text: "Voting berakhir seri. Tidak ada yang digantung hari ini." });
            }

            game.phase = GameState.WAITING;
            await progressGame(bot, groupId);
            break;
    }
}

async function handlePrivateMessage(bot, msg) {
    const senderId = msg.sender;
    const game = Object.values(games).find(g => g.players.some(p => p.id === senderId));
    if (!game || game.status !== GameState.PLAYING) return;
    const player = game.players.find(p => p.id === senderId);
    if (!player.isAlive) return;
    const mentioned = msg.mentionedJid || [];

    if (player.role === Roles.CUPID && game.phase === GamePhase.NIGHT_CUPID && game.day === 1) {
        if (mentioned.length !== 2) return msg.reply("⚠️ Kamu harus memilih DUA pemain.");
        const p1 = game.players.find(p => p.id === mentioned[0]);
        const p2 = game.players.find(p => p.id === mentioned[1]);
        if (!p1 || !p2) return msg.reply("⚠️ Salah satu pemain tidak valid.");
        p1.lover = p2.id; p2.lover = p1.id;
        await bot.sendMessage(senderId, { text: `✅ Kamu telah menjodohkan ${p1.name} dan ${p2.name}.` });
        await bot.sendMessage(p1.id, { text: `💘 Kamu telah jatuh cinta dengan ${p2.name}! Jaga dia baik-baik.` });
        await bot.sendMessage(p2.id, { text: `💘 Kamu telah jatuh cinta dengan ${p1.name}! Jaga dia baik-baik.` });
        clearTimeout(game.timeout);
        await progressGame(bot, game.id);
    }
    
    else if (player.role === Roles.WEREWOLF && game.phase === GamePhase.NIGHT_WEREWOLF) {
        if (mentioned.length !== 1) return msg.reply("⚠️ Kamu hanya bisa memilih SATU target.");
        const target = game.players.find(p => p.id === mentioned[0]);
        if (!target || !target.isAlive || target.role === Roles.WEREWOLF) return msg.reply("⚠️ Target tidak valid.");
        game.actions.push({ type: 'kill', from: senderId, to: target.id, day: game.day });
        await msg.reply(`✅ Pilihanmu untuk memangsa *${target.name}* telah dicatat.`);
        const otherWerewolves = game.players.filter(p => p.role === Roles.WEREWOLF && p.isAlive && p.id !== senderId);
        const notification = `🐺 *Info Tim:* Rekanmu, *${player.name}*, telah memberikan suaranya untuk memangsa *${target.name}*.`;
        for (const ww of otherWerewolves) await bot.sendMessage(ww.id, { text: notification });
    }

    else if (player.role === Roles.SEER && game.phase === GamePhase.NIGHT_SEER) {
        if (mentioned.length !== 1) return msg.reply("⚠️ Kamu hanya bisa menyelidiki SATU orang.");
        const target = game.players.find(p => p.id === mentioned[0]);
        if (!target || target.id === senderId) return msg.reply("⚠️ Target tidak valid.");
        const isWerewolf = target.role === Roles.WEREWOLF;
        await bot.sendMessage(senderId, { text: `Hasil penyelidikan: *${target.name}* ${isWerewolf ? 'ADALAH' : 'BUKAN'} seorang Werewolf.` });
        clearTimeout(game.timeout);
        await progressGame(bot, game.id);
    }

    else if (player.role === Roles.HUNTER && game.phase === GamePhase.HUNTER_REVENGE) {
        if (mentioned.length !== 1) return msg.reply("⚠️ Kamu hanya bisa menembak SATU orang.");
        const target = game.players.find(p => p.id === mentioned[0]);
        if (!target || !target.isAlive) return msg.reply("⚠️ Target tidak valid.");
        const announcements = await handlePlayerDeath(bot, game, target, `{player} tewas seketika setelah terkena tembakan panah dari Hunter!`);
        await bot.sendMessage(game.id, { text: announcements.join('\n') });
        clearTimeout(game.timeout);
        game.phase = GameState.WAITING;
        await progressGame(bot, game.id);
    }
}

// --- LOGIKA UTAMA PERINTAH ---
module.exports = {
    name: "ww",
    alias: ["werewolf", "wwcreate", "wwjoin", "wwstart", "wwend", "vote"],
    description: "Memainkan game Werewolf.",
    category: "game",
    execute: async (msg, { bot, args, command, usedPrefix }) => {
        if (msg.isPrivate) {
            return await handlePrivateMessage(bot, msg);
        }

        const from = msg.from;
        const senderId = msg.sender;
        const senderName = msg.pushName || "Pemain";

        if (command === "ww" && !args.length) {
            const helpText = `🐺 *Game Werewolf Bot* 🐺\n\n*Perintah Lobi:*\n- \`${usedPrefix}wwcreate\`: Membuat lobi.\n- \`${usedPrefix}wwjoin\`: Bergabung ke lobi.\n- \`${usedPrefix}wwstart\`: Memulai game (host).\n- \`${usedPrefix}wwend\`: Menghentikan game (host).\n\n*Perintah Saat Bermain:*\n- \`${usedPrefix}vote @pemain\`: Vote pemain di siang hari.`;
            return msg.reply(helpText);
        }
        
        if (command === "wwcreate") {
            if (games[from]) return msg.reply("⚠️ Lobi game Werewolf sudah ada di grup ini.");
            games[from] = { id: from, host: senderId, players: [{ id: senderId, name: senderName }], status: GameState.WAITING, day: 0, actions: [] };
            return msg.reply(`✅ Lobi Werewolf dibuat oleh ${senderName}!\nKetik \`${usedPrefix}wwjoin\` untuk bergabung.`, { mentions: [senderId] });
        }

        if (command === "wwjoin") {
            const game = games[from];
            if (!game || game.status !== GameState.WAITING) return msg.reply("⚠️ Tidak ada lobi yang sedang menunggu pemain.");
            if (game.players.some(p => p.id === senderId)) return msg.reply("⚠️ Kamu sudah berada di dalam lobi.");
            game.players.push({ id: senderId, name: senderName });
            const playerList = game.players.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
            return msg.reply(`✅ ${senderName} berhasil bergabung!\n\n*Daftar Pemain:*\n${playerList}`, { mentions: [senderId] });
        }

        if (command === "wwend") {
            const game = games[from];
            if (!game) return msg.reply("⚠️ Tidak ada game yang sedang berjalan.");

            // Cek apakah yang memerintah adalah host
            if (game.host !== senderId) return msg.reply("⚠️ Hanya host yang bisa menghentikan permainan.");

            // Ambil nama grup dari metadata
            let groupName = 'grup ini';
            try {
                const metadata = await bot.groupMetadata(from);
                groupName = metadata.subject;
            } catch (e) {
                console.error("Gagal mengambil metadata grup untuk .wwend:", e);
            }

            // Ambil nama dan nomor host
            const hostPlayer = game.players.find(p => p.id === game.host);
            const hostName = hostPlayer ? hostPlayer.name : "Host";
            const hostNumber = game.host.split('@')[0];

            // Buat pesan yang akan dikirim ke PM setiap pemain
            const endMessageForPM = `ℹ️ Game Werewolf di grup *${groupName}* telah dihentikan oleh host *${hostName}* (${hostNumber}).`;

            // Kirim notifikasi ke semua pemain
            await notifyPlayersOfEnd(bot, game.players, endMessageForPM);

            // Hentikan semua timer yang mungkin berjalan
            if (game.timeout) clearTimeout(game.timeout);



            // Hapus sesi game dari memori
            delete games[from];

            await bot.sendMessage(from, { text: donationMessage });

            return msg.reply(`🛑 Permainan Werewolf telah dihentikan oleh host.`);
        }

        if (command === "wwstart") {
            const game = games[from];
            if (!game || game.host !== senderId) return msg.reply("⚠️ Hanya host yang bisa memulai game.");
            if (game.status === GameState.PLAYING) return msg.reply("⚠️ Game sudah berjalan.");
            if (game.players.length < 5) return msg.reply("⚠️ Butuh minimal 5 pemain.");
            await msg.reply("Baiklah, permainan dimulai...");
            game.status = GameState.PLAYING;
            assignRoles(game.players);
            await msg.reply("Peran rahasia sedang dibagikan... Silakan periksa chat pribadi (PM).");
            for (const player of game.players) {
                await sendRoleInfo(bot, player, game);
                await sleep(1200);
            }
            await sleep(3000);
            game.phase = GameState.WAITING;
            await progressGame(bot, from);
        }

        if (command === "vote" && !msg.isPrivate) {
            const game = games[from];
            if (!game || game.phase !== GamePhase.DAY_VOTING) return msg.reply("⚠️ Sekarang bukan waktunya untuk voting.");
            const player = game.players.find(p => p.id === senderId && p.isAlive);
            if (!player) return msg.reply("⚠️ Kamu tidak bisa vote.");
            const targetId = msg.mentionedJid?.[0];
            const target = game.players.find(p => p.id === targetId && p.isAlive);
            if (!target) return msg.reply("⚠️ Target vote tidak valid atau sudah mati.");
            player.vote = targetId;
            return msg.reply(`✅ ${player.name} telah memberikan suaranya untuk menggantung ${target.name}.`);
        }
    },
};
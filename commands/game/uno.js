const { proto, generateWAMessageFromContent, prepareWAMessageMedia } = require('lily-baileys');
const fs = require('fs');
const path = require('path');

// --- Fungsi Helper ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fungsi untuk mengirim kartu ke PM pemain
async function sendPlayerCards(bot, player, game) {
    const playerName = player.name || player.id.split('@')[0];
    await bot.sendMessage(player.id, { text: ` giliranmu! Kartu teratas adalah *${game.getTopCard().color} ${game.getTopCard().value}*. Ini dek kartumu:` });

    for (const card of player.hand) {
        // Mengatasi nama file untuk kartu spesial
        const cardValueForFile = card.value.replace(' ', '_').toLowerCase();
        const cardName = `${card.color.toLowerCase()}_${cardValueForFile}`;
        const imagePath = `./lib/cards/${cardName}.png`;

        if (fs.existsSync(imagePath)) {
            let buttons;
            const cardIdentifier = `${card.color} ${card.value}`; // e.g., "Red 7" or "Wild Wild_Draw_Four"
            
            // Tombol untuk kartu biasa dan kartu spesial non-wild
            if (!card.isWild) {
                buttons = [{
                    buttonId: `.uno card ${cardIdentifier}`,
                    buttonText: { displayText: 'Mainkan Kartu Ini 🃏' },
                    type: 1
                }];
            } else {
                // Tombol khusus untuk kartu Wild
                buttons = ['Red', 'Green', 'Blue', 'Yellow'].map(color => ({
                    buttonId: `.uno wild ${cardIdentifier}|${color}`, // Format: .uno wild <CardIdentifier>|<ChosenColor>
                    buttonText: { displayText: `Pilih Warna ${color}` },
                    type: 1
                }));
            }

            await bot.sendMessage(player.id, {
                document: fs.readFileSync(imagePath),
                mimetype: 'image/png',
                fileName: `UNO - ${card.color} ${card.value}.png`,
                jpegThumbnail: fs.readFileSync(imagePath),
                caption: `Kartu Anda: *${card.color} ${card.value}*`,
                footer: "UNO Game by Lily",
                buttons: buttons,
                headerType: 5
            });
            await sleep(250); // Jeda antar pesan
        }
    }
}


// --- Class Game dan Card (Logika Inti) ---
class Card {
    constructor(color, value) {
        this.color = color;
        this.value = value;
    }
    get isSpecial() { return ['Draw Two', 'Skip', 'Reverse', 'Wild', 'Wild Draw Four'].includes(this.value); }
    get isWild() { return ['Wild', 'Wild Draw Four'].includes(this.value); }
}

class Game {
    constructor(chatId, creatorId) {
        this.chatId = chatId;
        this.creatorId = creatorId;
        this.players = [];
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;
        this.isGameRunning = false;
        this.unoCalled = {};
    }

    addPlayer(player) {
        if (!this.isGameRunning && this.players.length < 10) {
            this.players.push({ id: player.id, name: player.name, hand: [] });
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length < 2) return false;
        this.isGameRunning = true;
        this.createDeck();
        this.shuffleDeck();
        this.dealCards();
        
        let firstCard = this.deck.pop();
        while (firstCard.isWild) {
            this.deck.push(firstCard);
            this.shuffleDeck();
            firstCard = this.deck.pop();
        }
        this.discardPile.push(firstCard);
        return true;
    }

    createDeck() {
        const colors = ['Red', 'Green', 'Blue', 'Yellow'];
        const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Draw Two', 'Skip', 'Reverse'];
        const wildValues = ['Wild', 'Wild Draw Four'];
        colors.forEach(color => values.forEach(value => {
            this.deck.push(new Card(color, value));
            if (value !== '0') this.deck.push(new Card(color, value));
        }));
        wildValues.forEach(value => {
            for (let i = 0; i < 4; i++) this.deck.push(new Card('Wild', value));
        });
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealCards() {
        this.players.forEach(player => {
            for (let i = 0; i < 7; i++) player.hand.push(this.deck.pop());
        });
    }

    getCurrentPlayer() { return this.players[this.currentPlayerIndex]; }
    getTopCard() { return this.discardPile[this.discardPile.length - 1]; }
    
    getNextPlayer() {
        const nextIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
        return this.players[nextIndex];
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    }

    drawCards(playerId, amount) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;
        for (let i = 0; i < amount; i++) {
            if (this.deck.length === 0) this.resetDeck();
            player.hand.push(this.deck.pop());
        }
    }
    
    resetDeck() {
        this.deck = this.discardPile.slice(0, -1);
        this.shuffleDeck();
        this.discardPile = [this.discardPile.pop()];
    }
}

// --- Module Export dan Logika Perintah ---
module.exports = {
    name: 'uno',
    alias: ['uno'],
    description: 'Mainkan game UNO dengan teman-temanmu!',
    category: 'game',
    execute: async (msg, { bot, args, usedPrefix }) => {
        const { from, sender, senderName } = msg;
        bot.uno = bot.uno || {};
        const command = args[0]?.toLowerCase();
        let game = bot.uno[from];

        switch (command) {
            case 'create':
                if (game) return msg.reply('Sudah ada sesi UNO di grup ini.');
                bot.uno[from] = new Game(from, sender);
                game = bot.uno[from]; // Update reference
                
                // FIX 1: Pembuat lobi langsung menjadi pemain pertama.
                game.addPlayer({ id: sender, name: senderName });
                msg.reply(`Sesi UNO berhasil dibuat oleh @${sender.split('@')[0]}! Pemain lain bisa bergabung dengan mengetik \`.uno join\`.`, { mentions: [sender] });
                break;

            case 'join': {
                if (!game) return msg.reply('Tidak ada sesi UNO. Ketik `.uno create` untuk memulai.');
                if (game.isGameRunning) return msg.reply('Game sudah dimulai, tidak bisa bergabung.');
                if (game.players.find(p => p.id === sender)) return msg.reply('Kamu sudah bergabung.');

                if (game.addPlayer({ id: sender, name: senderName })) {
                    // FIX 2: Menampilkan daftar pemain setiap ada yang join.
                    const playerNames = game.players.map(p => `@${p.id.split('@')[0]}`).join('\n');
                    msg.reply(`Kamu berhasil bergabung!\n\n*Pemain di Lobi (${game.players.length}/10):*\n${playerNames}`, { mentions: game.players.map(p => p.id) });
                } else {
                    msg.reply('Gagal bergabung. Lobi sudah penuh.');
                }
                break;
            }

            case 'start': {
                if (!game) return msg.reply('Tidak ada sesi UNO. Buat dulu dengan `.uno create`.');
                if (game.creatorId !== sender) return msg.reply('Hanya pembuat sesi yang bisa memulai game.');
                if (game.players.length < 2) return msg.reply('Minimal butuh 2 pemain untuk memulai!');

                if (game.startGame()) {
                    await msg.reply('Permainan UNO dimulai! Mengirim kartu ke setiap pemain...');
                    
                    // FIX 3: Mengirim kartu ke semua pemain di awal permainan
                    for (const player of game.players) {
                        await sendPlayerCards(bot, player, game);
                    }
                    
                    const currentPlayer = game.getCurrentPlayer();
                    const topCard = game.getTopCard();
                    const imagePath = `./lib/cards/${topCard.color.toLowerCase()}_${topCard.value.toLowerCase().replace(' ', '_')}.png`;

                    // Mengirim gambar kartu pertama di grup
                    if(fs.existsSync(imagePath)){
                        await bot.sendMessage(from, {
                            image: fs.readFileSync(imagePath),
                            caption: `Kartu pertama adalah *${topCard.color} ${topCard.value}*.\n\nGiliran pertama adalah @${currentPlayer.id.split('@')[0]}!`,
                            mentions: [currentPlayer.id]
                        });
                    } else {
                         await bot.sendMessage(from, { text: `Kartu pertama adalah *${topCard.color} ${topCard.value}*.\n\nGiliran pertama adalah @${currentPlayer.id.split('@')[0]}!`, mentions: [currentPlayer.id] });
                    }
                } else {
                    msg.reply('Gagal memulai game.');
                }
                break;
            }
                
            case 'card':
            case 'wild': {
                if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                if (msg.isGroup) return msg.reply('Mainkan kartu melalui tombol di chat pribadi (PM)!');
                
                const currentPlayer = game.getCurrentPlayer();
                if (currentPlayer.id !== sender) return msg.reply('Bukan giliranmu!');
                
                // Parsing input dari buttonId
                const parts = msg.body.split(' '); // .uno card Red 7  atau .uno wild Wild_Draw_Four|Red
                const cardType = parts[1]; // card atau wild
                const cardIdentifier = parts.slice(2).join(' '); // "Red 7" atau "Wild_Draw_Four|Red"

                let color, value, chosenColor;

                if (cardType === 'card') {
                    const valueParts = cardIdentifier.split(' ');
                    color = valueParts[0];
                    value = valueParts.slice(1).join(' ');
                } else { // wild
                    const [wildIdentifier, wildColor] = cardIdentifier.split('|');
                    color = "Wild";
                    value = wildIdentifier.replace('_', ' ');
                    chosenColor = wildColor;
                }
                
                const cardIndex = currentPlayer.hand.findIndex(c => c.color === color && c.value === value);
                if (cardIndex === -1) return msg.reply('Kamu tidak punya kartu itu!');

                const playedCard = currentPlayer.hand[cardIndex];
                const topCard = game.getTopCard();
                
                if (!playedCard.isWild && playedCard.color !== topCard.color && playedCard.value !== topCard.value) {
                    return msg.reply('Kartu tidak cocok dengan kartu teratas!');
                }

                if (playedCard.isWild) playedCard.color = chosenColor;

                // Mainkan kartu
                currentPlayer.hand.splice(cardIndex, 1);
                game.discardPile.push(playedCard);

                let announcement = `@${sender.split('@')[0]} memainkan kartu *${playedCard.color} ${playedCard.value}*.`;
                if(playedCard.isWild) announcement = `@${sender.split('@')[0]} memainkan *${value}* dan memilih warna *${chosenColor}*.`;

                bot.sendMessage(from, { text: announcement, mentions: [sender] });
                
                // Cek UNO
                if (currentPlayer.hand.length === 1) {
                    game.unoCalled[sender] = true;
                    await bot.sendMessage(from, { text: `UNO! @${sender.split('@')[0]} sisa 1 kartu!`, mentions: [sender] });
                }

                // Cek kemenangan
                if (currentPlayer.hand.length === 0) {
                    await bot.sendMessage(from, { text: `🎉 @${sender.split('@')[0]} MENANG! Permainan selesai. Terima kasih sudah bermain!`, mentions: [sender] });
                    delete bot.uno[from];
                    return;
                }
                
                // Logika kartu spesial
                if (playedCard.value === 'Reverse') game.direction *= -1;
                if (playedCard.value === 'Skip') game.nextTurn();
                if (playedCard.value === 'Draw Two') {
                    const nextPlayer = game.getNextPlayer();
                    game.drawCards(nextPlayer.id, 2);
                    await bot.sendMessage(from, { text: `Kartu Draw Two! @${nextPlayer.id.split('@')[0]} harus mengambil 2 kartu.`, mentions: [nextPlayer.id] });
                    game.nextTurn();
                }
                if (playedCard.value === 'Wild Draw Four') {
                    const nextPlayer = game.getNextPlayer();
                    game.drawCards(nextPlayer.id, 4);
                     await bot.sendMessage(from, { text: `Kartu Wild Draw Four! @${nextPlayer.id.split('@')[0]} harus mengambil 4 kartu.`, mentions: [nextPlayer.id] });
                    game.nextTurn();
                }

                game.nextTurn();
                const nextPlayer = game.getCurrentPlayer();

                await bot.sendMessage(from, { text: `Sekarang giliran @${nextPlayer.id.split('@')[0]}! Cek PM untuk melihat kartumu.`, mentions: [nextPlayer.id] });
                await sendPlayerCards(bot, nextPlayer, game);
                break;
            }
                
            case 'draw': {
                 if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                 const currentPlayer = game.getCurrentPlayer();
                 if (currentPlayer.id !== sender) return msg.reply('Bukan giliranmu!');
                 
                 game.drawCards(sender, 1);
                 msg.reply('Kamu mengambil 1 kartu. Kartu baru telah dikirim ke PM.');
                 
                 game.nextTurn();
                 const nextPlayer = game.getCurrentPlayer();
                 
                 await bot.sendMessage(from, { text: `@${sender.split('@')[0]} telah mengambil kartu. Sekarang giliran @${nextPlayer.id.split('@')[0]}!`, mentions: [sender, nextPlayer.id] });
                 await sendPlayerCards(bot, currentPlayer, game);
                 await sendPlayerCards(bot, nextPlayer, game);
                 break;
            }

            case 'cards':
            case 'kartu': {
                if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                const player = game.players.find(p => p.id === sender);
                if (!player) return msg.reply('Kamu tidak ada dalam game ini.');
                await sendPlayerCards(bot, player, game);
                msg.reply('Kartu terbarumu sudah dikirim ulang ke PM.');
                break;
            }
                
            case 'end':
                if (!game) return msg.reply('Tidak ada sesi UNO.');
                if (game.creatorId !== sender) return msg.reply('Hanya pembuat sesi yang bisa mengakhiri game.');
                
                // FIX 4: Memberitahu semua pemain bahwa game dihentikan
                const playersToEnd = game.players.map(p => p.id);
                for(const player of playersToEnd) {
                    bot.sendMessage(player, { text: 'Permainan telah dihentikan oleh host.' });
                }
                
                delete bot.uno[from];
                msg.reply('Sesi UNO telah dihentikan.');
                break;
                
            default:
                msg.reply('🃏 *Perintah Game UNO* 🃏\n\n`.uno create` - Membuat lobi permainan\n`.uno join` - Bergabung ke lobi\n`.uno start` - Memulai permainan\n`.uno cards` - Meminta kartu dikirim ulang ke PM\n`.uno draw` - Mengambil satu kartu dari dek\n`.uno end` - Menghentikan permainan (hanya host)');
                break;
        }
    }
};
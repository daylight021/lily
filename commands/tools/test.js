module.exports = {
    name: "test",
    alias: ["ts"],
    description: "Membaca dan menampilkan media dari pesan sekali lihat.",
    execute: async (msg, { bot, args }) => {
        await bot.sendMessage(
            msg.from,
            {
                image: {
                    url: '././lib/chars/acheron.jpg'
                },
                viewOnce: true, //works with video, audio too
                caption: 'hello word'
            }
        )
    }
}
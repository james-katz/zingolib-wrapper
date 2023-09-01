const Litewallet = require('../litewallet');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/", "main");

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 0.0005
    const bal = await client.fetchTotalBalance();
    if(bal.spendable_orchard_balance > amount || bal.spendable_sapling_balance > amount || bal.transparent_balance > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("u12263wg70fvfenrmlyu79tf6zrmvl7dez8spava74v6glwkkzkgkwvjs5pzh7sf0nv0xy26juuc7gqd3d444vwvn64768vhj8lystumugrd54lx8a0y5rsudpgau7gmfwfvpuqx07t6as98lqt4xtfgnpzrat29m8qq6x3h2mg44enqztd2mmyvlqr500dyua8270v94hykuk5jhhcey")
            .setAmount(amount)
            .setMemo("Hello World");

        // Get the sendjson
        const sendJson = tx.getSendJSON();
        
        client.sendTransaction(sendJson).then((txid) => {
            console.log(txid);
            // Deinitialize the client
            client.deinitialize();
        });
    }
});

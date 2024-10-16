const Litewallet = require('../zingo_litewallet');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://sa.lightwalletd.com:443/", "main", false);

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 0.0005;
    const bal = await client.fetchTotalBalance();
    console.log(bal);
    if(bal.spendableOrchard > amount || bal.spendablePrivate > amount || bal.transparentBal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("u1h0dhm6mqf2dylrtczhcwxaw84qh0n47u63grz7mwtjfkw73eh0mjpsx3fm8sv2j2amnghgu3s5g0fyk6zc8r7fd93rrf0y48d4ms4je2glw6v6suwvt0qygvp8hfwua8mc44ughqswuy5gte62z8x93nzzfzlk5fjd8g0wuvpzvze445mlq8l305kudlnsw6cpdqpt2zcy3xkks2llr")
            .setAmount(amount)
            .setMemo("Hello World");

        // Get the sendjson
        const sendJson = tx.getSendJSON();
        console.log(sendJson);
        const uri = tx.getPaymentURI();
        console.log(uri)
        
        client.sendTransaction(sendJson).then((txid) => {
            console.log(txid);
            // Deinitialize the client
            client.deinitialize();
        });
    }
    else {
        console.log("Not enough bals");
        client.deinitialize();
    }
});

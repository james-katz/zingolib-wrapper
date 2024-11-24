const Litewallet = require('../zingolib');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://zcashd.zec.rocks:443/", "main", false);

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 0.0005;
    const bal = await client.fetchTotalBalance();
    console.log(bal);
    if(bal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("zs1jm0qzftul35xucsenr79rpgusrln58mv5f475wt4e4qmvgzd8u2vmct3rruy8g4xexsfz2g2mmf")
            .setAmount(amount)
            .setMemo("Hello World, James Katz rules");

        // Get the sendjson
        const sendJson = tx.getSendJSON();
        console.log(sendJson);
        const uri = tx.getPaymentURI();
        console.log(uri)
        
        client.sendTransaction(sendJson).then((txid) => {
            console.log(txid);
            client.deinitialize();    
        }).catch((err) => { console.log(err) });
    }
    else {
        console.log("Not enough bals");
        client.deinitialize();
    }

    // client.deinitialize();
});

const Litewallet = require('../zingolib');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://zec.rocks:443/", "main");

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 9;
    const bal = await client.fetchTotalBalance();
    console.log(bal);
    if(bal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("u1a30la83zvnzm0j08xhlrls6t8zsr6k23lz98ceq705xm8js822nsm4ptjh6x3ly43cu2f4rqp5n93f79p25gf89rxtdpvwz3a55kx7kv")
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

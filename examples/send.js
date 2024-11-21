const Litewallet = require('../zingolib');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://zec.rocks:443/", "main", false);

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 0.18;
    const bal = await client.fetchTotalBalance();
    console.log(bal);
    if(bal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("u1v0tyc0pcv4uzmttsg3k6tr43pclz83sx6guf65nrjc0ynek8yyylpesv9t4a44dflkg7qmvrkmsgld0vxc7v9q3zye7cxu9epa2grmqdas84eynj5eczm6y7jazcgdmsh0tus0ck6w0juku2j9gltt7cv3wnqahm55t4v472435zcp3t04nzdzrtys32tm2l6x65e5qgz4jwglsdz7m")
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

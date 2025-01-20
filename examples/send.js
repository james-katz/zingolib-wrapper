const Litewallet = require('../zingolib');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://zcashd.zec.rocks:443/", "test", false);

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 0.321;
    const bal = await client.fetchTotalBalance();
    console.log(bal);
    if(bal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("utest1hc7nfnu8h00wrnnxx3g0ff8fgl3a9eaelv6uw8f8l8pz7epr2xglahhwtycv3w36qgj4x4snkfv4xcpye2wz26e5xkjum9ylynwhh4p7ldp40zs8jwhze68pdlfnecxq6ghfenwzpluy4fwh0ef3y9k67efcmpc6j3xfc9w3rtaxue9hw7n33hnpsdmlxzw63gxx2gd6hqkuyd05w2q")
            .setAmount(amount)
            .setMemo("Hello testnet World");

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

const Litewallet = require('../zingolib');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://testnet.zec.rocks:443", "test");

client.init().then(()=> {
    // Check if wallet has spend
    const amount = 25;
    const bal = client.fetchTotalSpendableBalance();
    console.log(bal);
    if(bal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("utest1hc7nfnu8h00wrnnxx3g0ff8fgl3a9eaelv6uw8f8l8pz7epr2xglahhwtycv3w36qgj4x4snkfv4xcpye2wz26e5xkjum9ylynwhh4p7ldp40zs8jwhze68pdlfnecxq6ghfenwzpluy4fwh0ef3y9k67efcmpc6j3xfc9w3rtaxue9hw7n33hnpsdmlxzw63gxx2gd6hqkuyd05w2q")
            .setAmount(amount)
            .setMemo("Testing from zingolib 2.0.2");

        // Get the sendjson
        const sendJson = tx.getSendJSON();
        console.log(sendJson);
        // const uri = tx.getPaymentURI();
        // console.log(uri)
        
        const sendJsonStr = JSON.stringify(sendJson);

        client.sendTransaction(sendJsonStr).then((txid) => {
            console.log(txid);
            client.deinitialize();    
        }).catch((err) => { console.log(err) });
    }
    else {
        console.log("Not enough bals");
        client.deinitialize();
    }
});

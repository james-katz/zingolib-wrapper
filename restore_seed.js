const ZingoLib = require('./zingolib');

const client = new ZingoLib("https://testnet.zec.rocks:443", "test");

client.restore("abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware", 2719000).then(async (res) => {
    console.log(res);
    client.doSaveWallet();
})
.catch((err) => { console.log(err) });

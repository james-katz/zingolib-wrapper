const ZingoLib = require('./zingolib');

const client = new ZingoLib("https://zec.rocks:443", "main", false);

client.restore("abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware", 2719000).then(res => {
    console.log(res);
})
.catch((err) => { console.log(err) });

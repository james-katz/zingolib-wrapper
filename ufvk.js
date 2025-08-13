const ZingoLib = require('./zingolib');

const client = new ZingoLib("https://zec.rocks:443", "main");

client.from_ufvk("uview180jcys6lw4c30h5p88yuetgqj63fs40s00zf64lkgg8252nc786r2zmru7qgk6seavea4j5jse3yy3466ffz87d9deymzkegfmczacdx7hzvmqt7tslmd7xu48r7m66386et3lhvqtkkgt25vcc7zsc4cwyfm6chfae67wr4zwlxzc7pzrr6dcv7xzka22k9u04690pv8rmn3hatf6suxpjk69n35lca0tmw5zcplnr3dxhz93gjdgvp92qu8yt6mzssc9mpwlzj04d5jkwmjrgt8kp32sxg5639hf5rr05lq2kan80drt5t8vqjf0jxmn0h6mcy4ktej0s2s7wxktg6ayn3j95dttv83zdfd0f2fkh95kee4n593pmn92zdwq367tfyaxhf0ekrvdkn3ucmfvmt2d0qq0he6gp7s0d235c2wcea9f2l2nu83x90q5d49m8eg8y50k8n9ww78zq7w6lzglkerf94pzlhdveavjfrw5645vvm", 2172000).then(async (res) => {
    console.log(res);
    await client.doSaveWallet();
}).catch((err) => { console.log(err) });

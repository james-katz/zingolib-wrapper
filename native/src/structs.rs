use neon::{prelude::{FunctionContext, Context, Object}, result::JsResult, types::JsObject};
use zingolib::wallet::balance::AccountBalance;

pub struct NeonAccountBalance {
    /// Sum of unspent orchard note values in confirmed blocks excluding dust.
    pub confirmed_orchard_balance: u64,
    /// Sum of unspent orchard note values in unconfirmed blocks excluding dust.
    pub unconfirmed_orchard_balance: u64,
    /// Sum of confirmed and unconfirmed orchard balances.
    pub total_orchard_balance: u64,

    /// Sum of unspent sapling note values in confirmed blocks excluding dust.
    pub confirmed_sapling_balance: u64,
    /// Sum of unspent sapling note values in unconfirmed blocks excluding dust.
    pub unconfirmed_sapling_balance: u64,
    /// Sum of confirmed and unconfirmed sapling balances.
    pub total_sapling_balance: u64,

    /// Sum of unspent transparent coin values in confirmed blocks excluding dust.
    pub confirmed_transparent_balance: u64,
    /// Sum of unspent transparent coin values in unconfirmed blocks excluding dust.
    pub unconfirmed_transparent_balance: u64,
    /// Sum of confirmed and unconfirmed transparent balances.
    pub total_transparent_balance: u64,
}

impl NeonAccountBalance {
    pub fn new(balance: AccountBalance) -> Result<Self, String> {

        Ok(
            Self { 
                confirmed_orchard_balance: balance.confirmed_orchard_balance.expect("Unable to get value").into_u64(), 
                unconfirmed_orchard_balance: balance.unconfirmed_orchard_balance.expect("Unable to get value").into_u64(), 
                total_orchard_balance: balance.total_orchard_balance.expect("Unable to get value").into_u64(), 
                confirmed_sapling_balance: balance.confirmed_sapling_balance.expect("Unable to get value").into_u64(), 
                unconfirmed_sapling_balance: balance.unconfirmed_sapling_balance.expect("Unable to get value").into_u64(), 
                total_sapling_balance: balance.total_sapling_balance.expect("Unable to get value").into_u64(), 
                confirmed_transparent_balance: balance.confirmed_transparent_balance.expect("Unable to get value").into_u64(), 
                unconfirmed_transparent_balance: balance.unconfirmed_transparent_balance.expect("Unable to get value").into_u64(), 
                total_transparent_balance: balance.total_transparent_balance.expect("Unable to get value").into_u64() 
            }
        )
    }

    pub fn to_object<'a>(&self, cx: &mut FunctionContext<'a>) -> JsResult<'a, JsObject> {
        let obj = cx.empty_object();
        
        let confirmed_orchard_balance = cx.number(self.confirmed_orchard_balance as f64);
        obj.set(cx, "confirmed_orchard_balance", confirmed_orchard_balance)?;

        let unconfirmed_orchard_balance = cx.number(self.unconfirmed_orchard_balance as f64);
        obj.set(cx, "unconfirmed_orchard_balance", unconfirmed_orchard_balance)?;

        let total_orchard_balance = cx.number(self.total_orchard_balance as f64);
        obj.set(cx, "total_orchard_balance", total_orchard_balance)?;

        let confirmed_sapling_balance = cx.number(self.confirmed_sapling_balance as f64);
        obj.set(cx, "confirmed_sapling_balance", confirmed_sapling_balance)?;

        let unconfirmed_sapling_balance = cx.number(self.unconfirmed_sapling_balance as f64);
        obj.set(cx, "unconfirmed_sapling_balance", unconfirmed_sapling_balance)?;

        let total_sapling_balance = cx.number(self.total_sapling_balance as f64);
        obj.set(cx, "total_sapling_balance", total_sapling_balance)?;

        let confirmed_transparent_balance = cx.number(self.confirmed_transparent_balance as f64);
        obj.set(cx, "confirmed_transparent_balance", confirmed_transparent_balance)?;

        let unconfirmed_transparent_balance = cx.number(self.unconfirmed_transparent_balance as f64);
        obj.set(cx, "unconfirmed_transparent_balance", unconfirmed_transparent_balance)?;

        let total_transparent_balance = cx.number(self.total_transparent_balance as f64);
        obj.set(cx, "total_transparent_balance", total_transparent_balance)?;

       
        
        Ok(obj)
    }
}
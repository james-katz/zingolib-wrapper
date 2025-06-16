#[macro_use]
extern crate lazy_static;

use neon::prelude::*;

use tokio::runtime::Runtime;

use rustls::crypto::ring::default_provider;
use rustls::crypto::CryptoProvider;
use zcash_client_backend::address::UnifiedAddress;
use zcash_client_backend::encoding::{AddressCodec, encode_payment_address};
use zcash_primitives::consensus::MainNetwork;
use zcash_primitives::constants::mainnet::HRP_SAPLING_PAYMENT_ADDRESS;

use std::thread;

use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use zingolib::config::{construct_lightwalletd_uri, ChainType, RegtestNetwork, ZingoConfig};
use zingolib::{commands, lightclient::LightClient, wallet::WalletBase};

// We'll use a MUTEX to store a global lightclient instance,
// so we don't have to keep creating it. We need to store it here, in rust
// because we can't return such a complex structure back to JS
lazy_static! {
    static ref LIGHTCLIENT: Mutex<RefCell<Option<Arc<LightClient>>>> =
        Mutex::new(RefCell::new(None));
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("zingolib_wallet_exists", zingolib_wallet_exists)?;
    cx.export_function("zingolib_init_new", zingolib_init_new)?;
    cx.export_function("zingolib_init_from_b64", zingolib_init_from_b64)?;
    cx.export_function(
        "zingolib_init_from_seed",
        zingolib_init_from_seed,
    )?;
    cx.export_function(
        "zingolib_init_from_ufvk",
        zingolib_init_from_ufvk,
    )?;
    cx.export_function("zingolib_deinitialize", zingolib_deinitialize)?;
    cx.export_function("zingolib_execute_spawn", zingolib_execute_spawn)?;
    cx.export_function("zingolib_execute_async", zingolib_execute_async)?;
    cx.export_function("zingolib_get_latest_block_server", zingolib_get_latest_block_server)?;
    cx.export_function("zingolib_get_transaction_summaries", zingolib_get_transaction_summaries)?;
    cx.export_function("zingolib_get_value_transfers", zingolib_get_value_transfers)?;
    cx.export_function("zingolib_set_crypto_default_provider_to_ring", zingolib_set_crypto_default_provider_to_ring)?;
    cx.export_function("zingolib_decode_ua", decode_ua)?;

    Ok(())
}

fn lock_client(lightclient: LightClient) {
    let lc = Arc::new(lightclient);
    let _ = LightClient::start_mempool_monitor(lc.clone());

    LIGHTCLIENT.lock().unwrap().replace(Some(lc));
}

fn construct_uri_load_config(
    uri: String,
    chain_hint: String,
    monitor_mempool: bool,
) -> Result<(ZingoConfig, http::Uri), String> {
    let lightwalletd_uri = construct_lightwalletd_uri(Some(uri));

    let chaintype = match chain_hint.as_str() {
        "main" => ChainType::Mainnet,
        "test" => ChainType::Testnet,
        "regtest" => ChainType::Regtest(RegtestNetwork::all_upgrades_active()),
        _ => return Err("Error: Not a valid chain hint!".to_string()),
    };
    let config = match zingolib::config::load_clientconfig(
        lightwalletd_uri.clone(),
        None,
        chaintype,
        monitor_mempool,
    ) {
        Ok(c) => c,
        Err(e) => {
            return Err(format!("Error: Config load: {}", e));
        }
    };
    
    Ok((config, lightwalletd_uri))
}

// check the latency of a server
fn zingolib_get_latest_block_server(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);

    let promise = cx
        .task(move || {
            let lightwalletd_uri: http::Uri = server_uri.parse().expect("To be able to represent a Uri.");
            match zingolib::get_latest_block_height(lightwalletd_uri).map_err(|e| format! {"Error: {e}"}) {
                Ok(height) => height.to_string(),
                Err(e) => format!("{}", e),
            }
        })
        .promise(move |mut cx, resp| {
            Ok(cx.string(resp))
        });

    // Return the promise back to JavaScript
    Ok(promise)
}

// Check if there is an existing wallet
fn zingolib_wallet_exists(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(1)?.value(&mut cx);
    
    let (config, _lightwalletd_uri);
    match construct_uri_load_config(server_uri, chain_hint, true) {
        Ok((c, h)) => (config, _lightwalletd_uri) = (c, h),
        Err(_) => return Ok(cx.boolean(false)),
    };
   
    Ok(cx.boolean(config.wallet_path_exists()))
}

// Create a new wallet and return the seed for the newly created wallet.
fn zingolib_init_new(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(1)?.value(&mut cx);
    let monitor_mempool = cx.argument::<JsBoolean>(2)?.value(&mut cx);

    let resp = || {
        let (config, lightwalletd_uri);
        match construct_uri_load_config(server_uri, chain_hint, monitor_mempool) {
            Ok((c, h)) => (config, lightwalletd_uri) = (c, h),
            Err(s) => return s,
        }
        let latest_block_height = match zingolib::get_latest_block_height(lightwalletd_uri)
            .map_err(|e| format! {"Error: {e}"})
        {
            Ok(height) => height,
            Err(e) => return e,
        };
        let lightclient = match LightClient::new(&config, latest_block_height.saturating_sub(100)) {
            Ok(l) => l,
            Err(e) => {
                return format!("Error: {}", e);
            }
        };
        lock_client(lightclient);

        format!("OK")
    };
    Ok(cx.string(resp()))
}

// Restore a wallet from the seed phrase
fn zingolib_init_from_seed(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let seed = cx.argument::<JsString>(1)?.value(&mut cx);
    let birthday = cx.argument::<JsNumber>(2)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(3)?.value(&mut cx);
    let monitor_mempool = cx.argument::<JsBoolean>(4)?.value(&mut cx);

    let birthday_u64: u64 = birthday as u64;

    let resp = || {
        let (config, _lightwalletd_uri);
        match construct_uri_load_config(server_uri, chain_hint, monitor_mempool) {
            Ok((c, h)) => (config, _lightwalletd_uri) = (c, h),
            Err(s) => return s,
        }
        let lightclient = match LightClient::create_from_wallet_base(
            WalletBase::MnemonicPhrase(seed),
            &config,
            birthday_u64,
            false,
        ) {
            Ok(l) => l,
            Err(e) => {
                return format!("Error: {}", e);
            }
        };
        lock_client(lightclient);

        format!("OK")
    };
    Ok(cx.string(resp()))
}

fn zingolib_init_from_ufvk(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let ufvk = cx.argument::<JsString>(1)?.value(&mut cx);
    let birthday = cx.argument::<JsNumber>(2)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(3)?.value(&mut cx);
    let monitor_mempool = cx.argument::<JsBoolean>(4)?.value(&mut cx);

    let birthday_u64: u64 = birthday as u64;

    let resp = || {
        let (config, _lightwalletd_uri);
        match construct_uri_load_config(server_uri, chain_hint, monitor_mempool) {
            Ok((c, h)) => (config, _lightwalletd_uri) = (c, h),
            Err(s) => return s,
        }
        let lightclient = match LightClient::create_from_wallet_base(
            WalletBase::Ufvk(ufvk),
            &config,
            birthday_u64,
            false,
        ) {
            Ok(l) => l,
            Err(e) => {
                return format!("Error: {}", e);
            }
        };
        lock_client(lightclient);

        format!("OK")
    };
    Ok(cx.string(resp()))
}

// Initialize a new lightclient and store its value
fn zingolib_init_from_b64(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(1)?.value(&mut cx);
    let monitor_mempool = cx.argument::<JsBoolean>(2)?.value(&mut cx);

    let resp = || {
        let (config, _lightwalletd_uri);
        match construct_uri_load_config(server_uri, chain_hint, monitor_mempool) {
            Ok((c, h)) => (config, _lightwalletd_uri) = (c, h),
            Err(s) => return s,
        }
        let lightclient = match LightClient::read_wallet_from_disk(&config) {
            Ok(l) => l,
            Err(e) => {
                return format!("Error: {}", e);
            }
        };
        lock_client(lightclient);

        format!("OK")
    };
    Ok(cx.string(resp()))
}

fn zingolib_deinitialize(mut cx: FunctionContext) -> JsResult<JsString> {
    *LIGHTCLIENT.lock().unwrap().borrow_mut() = None;

    Ok(cx.string(format!("OK")))
}

fn zingolib_execute_spawn(mut cx: FunctionContext) -> JsResult<JsString> {
    let cmd = cx.argument::<JsString>(0)?.value(&mut cx);
    let args_list = cx.argument::<JsString>(1)?.value(&mut cx);

    let resp = || {
        {
            let lightclient: Arc<LightClient>;
            {
                let lc = LIGHTCLIENT.lock().unwrap();

                if lc.borrow().is_none() {
                    return format!("Error: Lightclient is not initialized");
                }

                lightclient = lc.borrow().as_ref().unwrap().clone();
            };
            // sync, rescan and import commands.
            thread::spawn(move || {
                let args = if args_list.is_empty() {
                    vec![]
                } else {
                    vec![&args_list[..]]
                };
                commands::do_user_command(&cmd, &args, lightclient.as_ref());
            });

            format!("OK")
        }
    };

    Ok(cx.string(resp()))
}

fn zingolib_execute_async(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let cmd = cx.argument::<JsString>(0)?.value(&mut cx);
    let args_list = cx.argument::<JsString>(1)?.value(&mut cx);

    let promise = cx
        .task(move || {
            let lc = LIGHTCLIENT.lock().unwrap();
            if lc.borrow().is_none() {
                format!("Error: Light Client is not initialized")
            } else {
                let lightclient: Arc<LightClient> = lc.borrow().as_ref().unwrap().clone();
                let args = if args_list.is_empty() {
                    vec![]
                } else {
                    vec![&args_list[..]]
                };
                commands::do_user_command(&cmd, &args, lightclient.as_ref()).clone()
            }
        })
        .promise(move |mut cx, resp| {
            Ok(cx.string(resp))
        });

    // Return the promise back to JavaScript
    Ok(promise)
}

fn zingolib_get_transaction_summaries(mut cx: FunctionContext) -> JsResult<JsString> {
    let resp: String;
    {
        let lightclient: Arc<LightClient>;
        {
            let lc = LIGHTCLIENT.lock().unwrap();

            if lc.borrow().is_none() {
                return Ok(cx.string(format!("Error: Light Client is not initialized")));
            }

            lightclient = lc.borrow().as_ref().unwrap().clone();
        };

        let rt = Runtime::new().unwrap();
        resp = rt.block_on(async {
            lightclient.transaction_summaries_json_string().await
        })
    };

    Ok(cx.string(resp))
}

fn zingolib_get_value_transfers(mut cx: FunctionContext) -> JsResult<JsString> {
    let vts = cx.argument::<JsNumber>(0)?.value(&mut cx);
    let resp: String;
    {
        let lightclient: Arc<LightClient>;
        {
            let lc = LIGHTCLIENT.lock().unwrap();

            if lc.borrow().is_none() {
                return Ok(cx.string(format!("Error: Light Client is not initialized")));
            }

            lightclient = lc.borrow().as_ref().unwrap().clone();
        };

        let rt = Runtime::new().unwrap();
        resp = rt.block_on(async {
            lightclient.value_transfers_json_string(vts as usize).await
        })
    };

    Ok(cx.string(resp))
}

pub fn zingolib_set_crypto_default_provider_to_ring(mut cx: FunctionContext) -> JsResult<JsString> {
    let resp: String;
    {
        if CryptoProvider::get_default().is_none() {
            resp = match default_provider()
                .install_default()
                .map_err(|_| "Error: Failed to install crypto provider".to_string())
            {
                Ok(_) => "true".to_string(),
                Err(e) => e,
            };
        } else {
            resp = "true".to_string();
        };
    }

    Ok(cx.string(resp))
}

fn decode_ua(mut cx: FunctionContext) -> JsResult<JsObject> {
    // Retrieve the Unified Address from the first argument
    let ua = cx.argument::<JsString>(0)?.value(&mut cx);

    // Attempt to decode the Unified Address
    let ua_full = match UnifiedAddress::decode(&MainNetwork, &ua) {
        Ok(u) => u,
        Err(err) => return cx.throw_error(format!("Failed to decode Unified Address: {}", err)),
    };

    // Extract Sapling address, if it exists
    let sapling_str: Option<String> = ua_full
        .sapling()
        .map(|addr| encode_payment_address(HRP_SAPLING_PAYMENT_ADDRESS, &addr));

    // Create Neon strings for the output
    let ua_neon = cx.string(&ua);
    let sapling_neon = cx.string(sapling_str.unwrap_or_else(|| "null".to_string()));

    // Construct the result object
    let obj = cx.empty_object();
    obj.set(&mut cx, "ua", ua_neon)?;
    obj.set(&mut cx, "sapling", sapling_neon)?;

    Ok(obj)
}


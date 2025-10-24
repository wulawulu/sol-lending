mod admin;
mod borrow;
mod deposit;
mod reply;
mod withdraw;

pub use admin::*;
pub use borrow::*;
pub use deposit::*;
pub use reply::*;
pub use withdraw::*;

use anchor_lang::prelude::*;
use std::f32::consts::E;

fn calculate_accrued_interest(deposited: u64, interest_rate: u64, last_update: i64) -> Result<u64> {
    let current_time = Clock::get()?.unix_timestamp;
    let time_elapsed = current_time - last_update;
    let interest = deposited as f64 * E.powf(interest_rate as f32 * time_elapsed as f32) as f64;
    Ok(interest as u64)
}

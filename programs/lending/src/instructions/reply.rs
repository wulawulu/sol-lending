use std::f32::consts::E;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::error::ErrorCode;
use crate::state::{Bank, User};

#[derive(Accounts)]
pub struct Reply<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [mint.key().as_ref()],
        bump,
    )]
    pub bank: Account<'info, Bank>,
    #[account(
        mut,
        seeds = [b"treasury",mint.key().as_ref()],
        bump
    )]
    pub bank_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [signer.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, User>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn process_reply(ctx: Context<Reply>, amount: u64) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    let borrow_value = if ctx.accounts.mint.to_account_info().key() == user.usdc_address {
        user.borrowed_usdc
    } else {
        user.borrowed_sol
    };

    let time_diff = user.last_update - Clock::get()?.unix_timestamp;

    let bank = &mut ctx.accounts.bank;
    bank.total_deposits -= (bank.total_deposits as f64
        * E.powf(bank.interest_rate as f32 * time_diff as f32) as f64)
        as u64;

    let value_per_share = if bank.total_deposit_shares == 0 {
        1.0
    } else {
        bank.total_deposits as f64 / bank.total_deposit_shares as f64
    };

    require!(value_per_share.is_normal(), ErrorCode::InsufficientFunds);

    let user_value = (borrow_value as f64 / value_per_share) as u64;

    if amount > user_value {
        return Err(ErrorCode::OverReply.into());
    }

    let transfer_cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.bank_token_account.to_account_info(),
        authority: ctx.accounts.signer.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts);
    let decimals = ctx.accounts.mint.decimals;

    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    let bank = &mut ctx.accounts.bank;
    let borrowed_ratio = amount.checked_div(bank.total_borrowed).unwrap();
    let user_shares = bank
        .total_borrowed_shares
        .checked_mul(borrowed_ratio)
        .unwrap();

    let user = &mut ctx.accounts.user_account;

    if ctx.accounts.mint.to_account_info().key() == user.usdc_address {
        user.borrowed_usdc -= amount;
        user.borrowed_usdc_shares -= user_shares;
    } else {
        user.borrowed_sol -= amount;
        user.borrowed_sol_shares -= user_shares;
    }

    bank.total_borrowed -= amount;
    bank.total_borrowed_shares -= user_shares;

    Ok(())
}

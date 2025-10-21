use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient funds for withdrawal.")]
    InsufficientFunds,
    #[msg("Requested amount exceeds borrowable limit.")]
    OverBorrowableAmount,
}

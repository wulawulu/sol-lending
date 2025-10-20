use anchor_lang::prelude::*;

declare_id!("4PDgPdBGf4abyh5jkwcCgYqjr7J5oJe2sKnK5skAudSF");

#[program]
pub mod lending {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

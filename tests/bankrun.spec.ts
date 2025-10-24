import "./setup-rpc-websockets";

import { describe, it } from "node:test";
// @ts-ignore
import IDL from "../target/idl/lending.json";
import { Lending } from "../target/types/lending";

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BanksClient, ProgramTestContext, startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { AccountInfo, Connection, PublicKey, Keypair } from "@solana/web3.js";
import { BankrunContextWrapper } from "../bankrun-utils/bankrunConnection";
import {
  DEFAULT_RECEIVER_PROGRAM_ID,
  PythSolanaReceiver,
} from "@pythnetwork/pyth-solana-receiver";
import { createAccount, createMint, mintTo } from "spl-token-bankrun";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";

type PriceUpdateAccountConfig = {
  authority: PublicKey;
  feedIdHex: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  postedSlot: bigint;
};

const ACCOUNT_DISCRIMINATOR_SIZE = 8;
const PUBKEY_LENGTH = 32;

const PRICE_MESSAGE_SIZE =
  32 + // feed id
  8 + // price
  8 + // conf
  4 + // exponent
  8 + // publish time
  8 + // prev publish time
  8 + // ema price
  8; // ema conf

const PRICE_UPDATE_DATA_LENGTH =
  ACCOUNT_DISCRIMINATOR_SIZE +
  PUBKEY_LENGTH + // authority
  1 + // verification enum
  PRICE_MESSAGE_SIZE +
  8; // posted slot

const PRICE_EXPONENT = -8;
const DEFAULT_PRICE = BigInt(120 * 10 ** 8); // $120.00 with exponent -8
const DEFAULT_CONF = BigInt(10 ** 6); // small confidence interval

function accountDiscriminator(name: string): Buffer {
  const namespace = `account:${name}`;
  const hash = sha256(Buffer.from(namespace));
  return Buffer.from(hash).subarray(0, ACCOUNT_DISCRIMINATOR_SIZE);
}

function normalizeFeedIdHex(feedIdHex: string): Buffer {
  const cleaned = feedIdHex.startsWith("0x")
    ? feedIdHex.slice(2)
    : feedIdHex;
  const buffer = Buffer.from(cleaned, "hex");
  if (buffer.length !== 32) {
    throw new Error(
      `Feed id must be 32 bytes, received ${buffer.length} bytes instead`
    );
  }
  return buffer;
}

function encodePriceUpdateAccountData({
  authority,
  feedIdHex,
  price,
  conf,
  exponent,
  publishTime,
  postedSlot,
}: PriceUpdateAccountConfig): Buffer {
  const data = Buffer.alloc(PRICE_UPDATE_DATA_LENGTH);
  let offset = 0;

  accountDiscriminator("PriceUpdateV2").copy(data, offset);
  offset += ACCOUNT_DISCRIMINATOR_SIZE;

  authority.toBuffer().copy(data, offset);
  offset += PUBKEY_LENGTH;

  // VerificationLevel::Full (variant index 1)
  data.writeUInt8(1, offset);
  offset += 1;

  normalizeFeedIdHex(feedIdHex).copy(data, offset);
  offset += 32;

  data.writeBigInt64LE(price, offset);
  offset += 8;

  data.writeBigUInt64LE(conf, offset);
  offset += 8;

  data.writeInt32LE(exponent, offset);
  offset += 4;

  data.writeBigInt64LE(publishTime, offset);
  offset += 8;

  data.writeBigInt64LE(publishTime - 1n, offset);
  offset += 8;

  data.writeBigInt64LE(price, offset);
  offset += 8;

  data.writeBigUInt64LE(conf, offset);
  offset += 8;

  data.writeBigUInt64LE(postedSlot, offset);

  return data;
}

function createPriceUpdateAccountInfo(
  config: PriceUpdateAccountConfig
): AccountInfo<Buffer> {
  const data = encodePriceUpdateAccountData(config);
  return {
    executable: false,
    lamports: 1_000_000,
    owner: DEFAULT_RECEIVER_PROGRAM_ID,
    rentEpoch: 0,
    data,
  };
}

describe("Lending Smart Contract", async () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let bankrunContextWrapper: BankrunContextWrapper;
  let program: Program<Lending>;
  let bankClient: BanksClient;
  let signer: Keypair;

  let usdcBankAccount: PublicKey;
  let solBankAccount: PublicKey;
  let solTokenAccount: PublicKey;

  context = await startAnchor(
    "",
    [{ name: "lending", programId: new PublicKey(IDL.address) }],
    []
  );
  provider = new BankrunProvider(context);

  const SOL_PRICE_FEED_ID =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

  bankrunContextWrapper = new BankrunContextWrapper(context);

  const connection = bankrunContextWrapper.connection.toConnection();

  const pythSolanaReceiver = new PythSolanaReceiver({
    connection,
    wallet: provider.wallet,
  });

  const solUsdPriceFeedAccount = pythSolanaReceiver.getPriceFeedAccountAddress(
    0,
    SOL_PRICE_FEED_ID
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  const priceUpdateAccountInfo = createPriceUpdateAccountInfo({
    authority: provider.wallet.publicKey,
    feedIdHex: SOL_PRICE_FEED_ID,
    price: DEFAULT_PRICE,
    conf: DEFAULT_CONF,
    exponent: PRICE_EXPONENT,
    publishTime: now,
    postedSlot: 0n,
  });

  context.setAccount(
    solUsdPriceFeedAccount,
    priceUpdateAccountInfo
  );

  program = new Program<Lending>(IDL as Lending, provider);

  bankClient = context.banksClient;

  signer = provider.wallet.payer;

  const mintUSDC = await createMint(
    bankClient,
    signer,
    signer.publicKey,
    null,
    2
  );

  const mintSOL = await createMint(
    bankClient,
    signer,
    signer.publicKey,
    null,
    2
  );

  [usdcBankAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mintUSDC.toBuffer()],
    program.programId
  );

  [solBankAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mintSOL.toBuffer()],
    program.programId
  );

  [solTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mintSOL.toBuffer()],
    program.programId
  );

  console.log("USDC Bank Account:", usdcBankAccount.toBase58());
  console.log("SOL Bank Account:", solBankAccount.toBase58());

  it("Test Init User", async () => {
    const initUserTx = await program.methods
      .initUser(mintUSDC)
      .accounts({
        signer: signer.publicKey,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Create User Account:", initUserTx);
  });

  it("Test Init and Fund USDC Bank", async () => {
    const initUSDCBankTx = await program.methods
      .initBank(new anchor.BN(1), new anchor.BN(1))
      .accounts({
        signer: signer.publicKey,
        mint: mintUSDC,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Create USDC Bank Account", initUSDCBankTx);

    const amount = 10_000 * 10 ** 9;
    const mintTx = await mintTo(
      bankClient,
      signer,
      mintUSDC,
      usdcBankAccount,
      signer,
      amount
    );

    console.log("Mint to USDC Bank Signature:", mintTx);
  });

  it("Test Init and Fund SOL Bank", async () => {
    const initSOLBankTx = await program.methods
      .initBank(new anchor.BN(1), new anchor.BN(1))
      .accounts({
        signer: signer.publicKey,
        mint: mintSOL,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Create SOL Bank Account", initSOLBankTx);

    const amount = 10_000 * 10 ** 9;
    const mintTx = await mintTo(
      bankClient,
      signer,
      mintSOL,
      solBankAccount,
      signer,
      amount
    );

    console.log("Mint to SOL Bank Signature:", mintTx);
  });

  it("Create and Fund Token Account", async () => {
    const USDCTokenAccount = await createAccount(
      bankClient,
      signer,
      mintUSDC,
      signer.publicKey
    );

    console.log(
      "User USDC Token Account Created:",
      USDCTokenAccount.toBase58()
    );

    const amount = 1_000 * 10 ** 9;
    const mintTx = await mintTo(
      bankClient,
      signer,
      mintUSDC,
      USDCTokenAccount,
      signer,
      amount
    );

    console.log("Mint to User USDC Token Account Signature:", mintTx);
  });

  it("Test Deposit USDC", async () => {
    const depositUSDC = await program.methods
      .deposit(new anchor.BN(1000_000_000))
      .accounts({
        signer: signer.publicKey,
        mint: mintUSDC,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Deposit USDC Tx:", depositUSDC);
  });

  it("Test Borrow SOL", async () => {
    const borrowSOL = await program.methods
      .borrow(new anchor.BN(10))
      .accounts({
        signer: signer.publicKey,
        mint: mintSOL,
        priceUpdate: solUsdPriceFeedAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Borrow SOL Tx:", borrowSOL);
  });

  it("Test Repay SOL", async () => {
    const repaySOL = await program.methods
      .reply(new anchor.BN(10))
      .accounts({
        signer: signer.publicKey,
        mint: mintSOL,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
      
    console.log("Repay SOL Tx:", repaySOL);
  });

  it("Test Withdraw USDC", async () => {
    const withdrawUSDC = await program.methods
      .withdraw(new anchor.BN(1_000))
      .accounts({
        signer: signer.publicKey,
        mint: mintUSDC,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Withdraw USDC Tx:", withdrawUSDC);
  });
});

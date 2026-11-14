// Turns contract/wallet errors into short, kind messages for the player.
// Panic strings are the contract's own (contract/NOTES.md "Panic messages").

const FRIENDLY: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
  [/Bayad muna: the borrower has an overdue loan/, "Bayad muna: this neighbour has an overdue loan and must repay first."],
  [/Bayad muna: you have an overdue loan/, "Bayad muna: repay your overdue loan first. You can still receive coins and repay."],
  [/Leaving the neighbourhood is not supported/, "Once you join, you stay in the neighbourhood. Leaving isn't supported."],
  [/You are not registered: call storage_deposit first/, "Join the neighbourhood first (0.01 NEAR)."],
  [/The lender is not registered/, "That neighbour hasn't joined yet."],
  [/You cannot borrow from yourself/, "You can't borrow from your own store."],
  [/Amount must be between/, "Loans are between 1.00 and 1,000.00 $UTANG."],
  [/Days must be between/, "Pick a term between 1 and 30 days."],
  [/Too many open loans/, "You already have 5 open loans or requests. Close one first."],
  [/First loan between neighbours is at most/, "First loan with this neighbour: max 10.00. After one counted repayment, bigger loans open up."],
  [
    /Credit between you two is at most ([\d.,]+)/,
    (m) => `Credit between you two is up to ${m[1]} right now. Each counted repayment between you adds 10.00 more.`,
  ],
  [/ask takes no deposit/, "Asking is free: no NEAR deposit needed."],
  [/Loan not found/, "That loan isn't in the listahan."],
  [/Unknown barangay/, "That isn't one of Mandaluyong's 27 barangays."],
  [/Only the lender can do this/, "Only the lender can do that."],
  [/Only the borrower can do this/, "Only the borrower can do that."],
  [/Loan is not in Requested status/, "That request was already answered."],
  [/Loan is not Active or Overdue/, "That loan is already closed."],
  [/Loan is not Active/, "That loan is no longer active (someone may have marked it already)."],
  [/Loan is not past its due date yet/, "It's not past the due date yet."],
  [/Over your lending limit/, "That's over your lending limit right now."],
  [/Not enough UTANG to repay this loan/, "Not enough $UTANG to repay. A neighbour can send you coins."],
  [/The join deposit is 0\.01 NEAR/, "Joining needs a 0.01 NEAR storage deposit."],
  [/doesn't have enough balance/, "Not enough $UTANG for that."],
  [/The account (\S+) is not registered/, "That account hasn't joined the neighbourhood."],
  [/Requires attached deposit of exactly 1 yoctoNEAR/, "The wallet must attach exactly 1 yoctoNEAR for transfers."],
  [/User (closed|rejected|cancelled)|rejected by user|User denied|Wallet closed/i, "You cancelled in the wallet."],
];

export function friendlyError(e: unknown): string {
  let msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e ?? "Something went wrong");
  for (const [re, text] of FRIENDLY) {
    const m = re.exec(msg);
    if (m) return typeof text === "string" ? text : text(m);
  }
  const panic = /Smart contract panicked: ([^"\\\n]+)/.exec(msg);
  if (panic) msg = panic[1];
  msg = msg.replace(/^ExecutionError:\s*/, "").trim();
  if (msg.length > 180) msg = msg.slice(0, 177) + "…";
  return msg || "Something went wrong";
}

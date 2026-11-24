// Test data written into the browser BEFORE the app starts (context.addInitScript). It is the same shape the app stores, mixing old UTC-midnight
// and new local-noon dates, so every page has something to show. Dates are relative to "today", so the data never goes stale.
export type Theme = "dark" | "light";

export const SEED_IDS = { account: "acc1", connection: "c1", fund: "f1", vehicle: "v1", loan: "l1" } as const;

const DATA = `
    set('settings', { cycleResetDay: 1, currencySymbol: '₨', theme: THEME, overallBudget: 50000, categoryBudgets: {} });
    set('expenses', [
      { id: 'e1', date: noon(1), amount: 900, categoryId: 'cat-food', note: 'Groceries', source: 'manual', createdAt: noon(1), accountId: 'acc1' },
      { id: 'e2', date: noon(2), amount: 120, categoryId: 'cat-food', note: 'Lunch', source: 'manual', createdAt: noon(2) },
      { id: 'e3', date: noon(40), amount: 300, categoryId: 'cat-food', note: 'Old', source: 'manual', createdAt: noon(40) } ]);
    set('income', [{ id: 'i1', date: noon(3), amount: 5000, sourceType: 'salary', note: 'Salary', createdAt: noon(3), accountId: 'acc1' }]);
    set('accounts', { accounts: [{ id: 'acc1', name: 'Meezan', type: 'bank', openingBalance: 10000, openingDate: key(45), archived: false, notes: '', order: 0, createdAt: noon(50) }], transfers: [], adjustments: [] });
    set('goals', [{ id: 'g1', name: 'Holiday', targetAmount: 1000, targetDate: key(-30), startDay: key(20), savings: [{ id: 's1', date: key(3), amount: 150, note: '', createdAt: noon(3) }], note: '', createdAt: noon(20) }]);
    set('bills', { connections: [{ id: 'c1', connectionName: 'Home power', provider: '', billType: 'electricity', consumerNumber: '', referenceNumber: '', accountNumber: '', meterNumber: '', active: true, createdAt: noon(9) }],
      bills: [{ id: 'b1', internalBillId: 'B-1', providerBillNumber: '', connectionId: 'c1', billingMonth: '2026-10', issueDate: null, dueDate: noon(3), amount: 2000, arrears: 0, status: 'unpaid', paidDate: null, paidBy: '', paymentMethod: null, transactionReference: '', linkedExpenseId: null, previousReading: null, currentReading: null, unitsUsed: null, meterNumber: '', attachments: [], notes: '', createdAt: noon(9) }] });
    set('meterReadings', [{ id: 'm1', connectionId: 'c1', date: noon(5), reading: 120, notes: '', source: 'manual', billId: null, createdAt: noon(5) }]);
    set('assets', [{ id: 'as1', name: 'Laptop', category: 'electronics', purchaseDate: utcMid(40), purchasePrice: 70000, currentValue: 60000, warrantyExpiry: null, serialNumber: '', notes: '', createdAt: noon(40) }]);
    set('investments', [{ id: 'f1', name: 'Index fund', provider: 'Broker', notes: '', createdAt: noon(60), contributions: [{ id: 'c1', date: utcMid(60), amount: 1000, notes: '', createdAt: noon(60) }], valueEntries: [{ id: 'v1', date: utcMid(30), value: 1500, notes: '', createdAt: noon(30) }], withdrawals: [{ id: 'w1', date: utcMid(5), amount: 400, notes: '', createdAt: noon(5) }] }]);
    set('lending', [{ id: 'l1', direction: 'lent', personName: 'Ali', amount: 500, date: noon(20), dueDate: null, notes: '', repayments: [], createdAt: noon(20) }]);
    set('vehicles', [{ id: 'v1', name: 'Bike', type: 'bike', make: 'Honda', model: '70', year: '2020', registrationNumber: 'ABC-123', purchaseDate: null, currentOdometer: 12000, fuelType: 'petrol', notes: '', active: true, createdAt: noon(100) }]);
    set('fuelLogs', [{ id: 'fl1', vehicleId: 'v1', date: noon(7), odometer: 11900, liters: 5, cost: 1500, fullTank: true, stationName: '', notes: '', createdAt: noon(7) }]);
    set('recurring', [{ id: 'r1', name: 'Rent', categoryId: 'cat-home', amountMode: 'fixed', amount: 3000, dueDay: 1, leadDays: 0, endDate: null, active: true, lastConfirmedCycle: null, createdAt: noon(30) }]);
`;

/**
 * The init script. `meta: null` writes no data version (a user from before versioning existed); `data: false` seeds nothing (a fresh install);
 * `unlocked: false` leaves the app lock showing. Extra `script` runs after the seed (for example to add a record or a newer data version).
 */
export function seedScript(opts: { theme?: Theme; meta?: unknown; data?: boolean; unlocked?: boolean; script?: string } = {}): string {
  const { theme = "dark", meta = { version: 3 }, data = true, unlocked = true, script = "" } = opts;
  return `(() => {
  try {
    ${unlocked ? "sessionStorage.setItem('hisaab:session-unlocked', 'true');" : ""}
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    const z = (n) => String(n).padStart(2, '0');
    const key = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.getFullYear() + '-' + z(x.getMonth() + 1) + '-' + z(x.getDate()); };
    const noon = (n) => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(12, 0, 0, 0); return x.toISOString(); };
    const utcMid = (n) => new Date(key(n)).toISOString();
    const set = (k, v) => localStorage.setItem('hisaab:' + k, JSON.stringify(v));
    ${meta === null ? "" : `set('meta', ${JSON.stringify(meta)});`}
    ${data ? DATA.replace("THEME", JSON.stringify(theme)) : ""}
    ${script}
  } catch (e) {}
})();`;
}

/** The 21 app pages with the title the header shows. */
export const PAGES: Array<[path: string, title: string]> = [
  ["/dashboard", "Dashboard"],
  ["/expenses", "Expenses"],
  ["/income", "Income"],
  ["/accounts", "Accounts"],
  ["/accounts/acc1", "Account"],
  ["/net-worth", "Net worth"],
  ["/goals", "Goals"],
  ["/bills", "Bills"],
  ["/bills/meters/c1", "Meter Reading"],
  ["/recurring", "Recurring"],
  ["/categories", "Categories"],
  ["/budget", "Budget"],
  ["/vault", "Vault"],
  ["/assets", "Assets"],
  ["/investments", "Investments"],
  ["/investments/f1", "Fund"],
  ["/vehicles", "Vehicles"],
  ["/vehicles/v1", "Vehicle"],
  ["/lending", "Lending"],
  ["/lending/l1", "Loan"],
  ["/settings", "Settings"],
];

// Realistic stored values for every synced key (the shapes the app writes today), for the sync tests.
export type Storage = Record<string, unknown>;

export function sampleStorage(): Storage {
  return {
    settings: { profileName: "You", currencySymbol: "Rs", cycleResetDay: 1, theme: "dark", overallBudget: 50000, categoryBudgets: { "cat-food": 20000 }, rollover: false, lastCategoryId: "cat-food", defaultAccountId: "acc1", lastAccountId: "acc1" },
    categories: [
      { id: "cat-food", name: "Food", icon: "F", color: "#5FAE86", isDefault: false, order: 0, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "cat-other", name: "Other", icon: "O", color: "#8FA0AC", isDefault: true, order: 1, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    expenses: [
      { id: "e1", date: "2026-11-19T07:00:00.000Z", amount: 900, categoryId: "cat-food", note: "Groceries", source: "manual", createdAt: "2026-11-19T07:00:00.000Z", accountId: "acc1", receipts: [{ id: "r1", name: "bill.jpg", size: 1000 }] },
      { id: "e2", date: "2026-11-18T07:00:00.000Z", amount: 120.5, categoryId: "cat-food", note: "Lunch", source: "manual", createdAt: "2026-11-18T07:00:00.000Z" },
      { id: "e3", date: "2026-11-17T07:00:00.000Z", amount: 300, categoryId: "cat-other", note: "Refund", source: "manual", kind: "refund", createdAt: "2026-11-17T07:00:00.000Z" },
    ],
    income: [{ id: "i1", date: "2026-11-03T07:00:00.000Z", amount: 5000, sourceType: "salary", note: "Salary", createdAt: "2026-11-03T07:00:00.000Z", accountId: "acc1" }],
    recurring: [{ id: "rec1", name: "Rent", categoryId: "cat-bills", amountMode: "fixed", amount: 3000, dueDay: 1, leadDays: 0, endDate: null, active: true, lastConfirmedCycle: null, createdAt: "2026-10-01T00:00:00.000Z" }],
    bills: {
      connections: [{ id: "c1", connectionName: "Home power", provider: "", billType: "electricity", consumerNumber: "123", active: true, createdAt: "2026-10-01T00:00:00.000Z" }],
      bills: [{ id: "b1", connectionId: "c1", billingMonth: "2026-10", dueDate: "2026-11-25T07:00:00.000Z", amount: 2000, status: "unpaid", paidDate: null, attachments: [{ id: "a1", kind: "bill", filename: "bill.pdf", size: 5 }], notes: "", createdAt: "2026-10-01T00:00:00.000Z" }],
    },
    meterReadings: [{ id: "m1", connectionId: "c1", date: "2026-11-05T07:00:00.000Z", reading: 120, notes: "", source: "manual", createdAt: "2026-11-05T07:00:00.000Z" }],
    assets: [{ id: "as1", name: "Laptop", category: "electronics", purchaseDate: "2026-09-01T00:00:00.000Z", purchasePrice: 70000, currentValue: 60000, notes: "", createdAt: "2026-09-01T00:00:00.000Z" }],
    lending: [{ id: "l1", direction: "lent", personName: "Ali", amount: 500, date: "2026-10-20T07:00:00.000Z", dueDate: null, notes: "", repayments: [{ id: "rp1", date: "2026-11-01T07:00:00.000Z", amount: 100, notes: "", createdAt: "2026-11-01T07:00:00.000Z" }], createdAt: "2026-10-20T07:00:00.000Z" }],
    investments: [
      {
        id: "f1",
        name: "Index fund",
        provider: "Broker",
        notes: "",
        createdAt: "2026-09-01T00:00:00.000Z",
        contributions: [{ id: "fc1", date: "2026-09-02T00:00:00.000Z", amount: 1000, notes: "", createdAt: "2026-09-02T00:00:00.000Z" }],
        valueEntries: [{ id: "fv1", date: "2026-10-20T00:00:00.000Z", value: 1500, notes: "", createdAt: "2026-10-20T00:00:00.000Z" }],
        withdrawals: [{ id: "fw1", date: "2026-11-15T00:00:00.000Z", amount: 400, notes: "", createdAt: "2026-11-15T00:00:00.000Z" }],
      },
    ],
    accounts: {
      accounts: [{ id: "acc1", name: "Meezan", type: "bank", openingBalance: 10000, openingDate: "2026-10-01", archived: false, notes: "", order: 0, createdAt: "2026-09-30T00:00:00.000Z" }],
      transfers: [{ id: "t1", date: "2026-11-10T07:00:00.000Z", amount: 500, fromAccountId: "acc1", toAccountId: "acc2", note: "", createdAt: "2026-11-10T07:00:00.000Z" }],
      adjustments: [{ id: "adj1", accountId: "acc1", date: "2026-11-12T07:00:00.000Z", amount: -20, reconciledTo: 9980, note: "", createdAt: "2026-11-12T07:00:00.000Z" }],
    },
    vehicles: [{ id: "v1", name: "Bike", type: "bike", make: "Honda", model: "70", year: "2020", registrationNumber: "ABC-123", currentOdometer: 12000, fuelType: "petrol", notes: "", active: true, createdAt: "2026-08-01T00:00:00.000Z" }],
    vehicleLogs: [{ id: "vl1", vehicleId: "v1", tagId: null, date: "2026-11-02T07:00:00.000Z", odometer: 11000, cost: 800, title: "Oil", vendor: "", nextDueOdometer: null, nextDueDate: null, notes: "", createdAt: "2026-11-02T07:00:00.000Z" }],
    fuelLogs: [{ id: "fl1", vehicleId: "v1", date: "2026-11-13T07:00:00.000Z", odometer: 11900, liters: 5, cost: 1500, fullTank: true, stationName: "", notes: "", createdAt: "2026-11-13T07:00:00.000Z" }],
    vehicleTags: [{ id: "tag-maintenance", name: "Maintenance", icon: "M", color: "#4A9498", createdAt: "2026-08-01T00:00:00.000Z" }],
    goals: [{ id: "g1", name: "Holiday", targetAmount: 1000, targetDate: "2027-01-01", startDay: "2026-11-01", savings: [{ id: "s1", date: "2026-11-17", amount: 150, note: "", createdAt: "2026-11-17T07:00:00.000Z" }], note: "", createdAt: "2026-11-01T07:00:00.000Z" }],
    vault: { v: 1, salt: "c2FsdA==", iv: "aXY=", ciphertext: "Y2lwaGVydGV4dA==" },
  };
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

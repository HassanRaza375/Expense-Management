// The app's route table (docs/DECISIONS.md D3). It is the same table the Vite app had in src/router/index.js: same names, same paths, same titles.
// nuxt.config.ts turns each entry into a Nuxt page through the `pages:extend` hook, so the view files keep their own folder (app/views) and their
// relative imports. Unknown paths redirect to the dashboard, as before.

export interface AppRoute {
  name: string;
  path: string;
  /** a file in app/views; omitted for a redirect */
  view?: string;
  title?: string;
  redirect?: string;
  /** false = no layout (the layout imports the composables; the blocked screen must not) */
  layout?: false;
}

export const ROUTES: AppRoute[] = [
  { name: "root", path: "/", redirect: "/dashboard" },
  { name: "dashboard", path: "/dashboard", view: "DashboardView.vue", title: "Dashboard" },
  { name: "expenses", path: "/expenses", view: "ExpensesView.vue", title: "Expenses" },
  { name: "income", path: "/income", view: "IncomeView.vue", title: "Income" },
  { name: "accounts", path: "/accounts", view: "AccountsView.vue", title: "Accounts" },
  { name: "accountDetail", path: "/accounts/:id", view: "AccountDetailView.vue", title: "Account" },
  { name: "netWorth", path: "/net-worth", view: "NetWorthView.vue", title: "Net worth" },
  { name: "goals", path: "/goals", view: "GoalsView.vue", title: "Goals" },
  { name: "bills", path: "/bills", view: "BillsView.vue", title: "Bills" },
  { name: "meterReading", path: "/bills/meters/:connectionId", view: "MeterReadingView.vue", title: "Meter Reading" },
  { name: "recurring", path: "/recurring", view: "RecurringView.vue", title: "Recurring" },
  { name: "categories", path: "/categories", view: "CategoriesView.vue", title: "Categories" },
  { name: "budget", path: "/budget", view: "BudgetView.vue", title: "Budget" },
  { name: "vault", path: "/vault", view: "VaultView.vue", title: "Vault" },
  { name: "assets", path: "/assets", view: "AssetsView.vue", title: "Assets" },
  { name: "investments", path: "/investments", view: "InvestmentsView.vue", title: "Investments" },
  { name: "fundDetail", path: "/investments/:id", view: "FundDetailView.vue", title: "Fund" },
  { name: "vehicles", path: "/vehicles", view: "VehiclesView.vue", title: "Vehicles" },
  { name: "vehicleDetail", path: "/vehicles/:id", view: "VehicleDetailView.vue", title: "Vehicle" },
  { name: "lending", path: "/lending", view: "LendingView.vue", title: "Lending" },
  { name: "loanDetail", path: "/lending/:id", view: "LoanDetailView.vue", title: "Loan" },
  { name: "settings", path: "/settings", view: "SettingsView.vue", title: "Settings" },
  // the "Hisaab did not start" screen: no layout, no composable (app/lib/startup.ts)
  { name: "startupBlocked", path: "/startup-blocked", view: "StartupBlockedView.vue", title: "Hisaab", layout: false },
  // anything else goes to the dashboard (the old catch-all). Server routes (/api/*) never reach the page router.
  { name: "notFound", path: "/:pathMatch(.*)*", redirect: "/dashboard" },
];

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
  // the optional account (sign in, photo, delete). Only exists while accounts are turned on: with the flag off the page sends you to Settings.
  { name: "account", path: "/account", view: "AccountView.vue", title: "Account" },
  // the super-admin panel. Not for ordinary users: the pages and /api/admin/* answer as an unknown address would (the page sends you to the dashboard).
  { name: "adminOverview", path: "/admin", view: "AdminOverviewView.vue", title: "Admin" },
  { name: "adminUsers", path: "/admin/users", view: "AdminUsersView.vue", title: "Admin: users" },
  { name: "adminUser", path: "/admin/users/:id", view: "AdminUserView.vue", title: "Admin: user" },
  { name: "adminExpenses", path: "/admin/expenses", view: "AdminExpensesView.vue", title: "Admin: expenses" },
  { name: "adminInvestments", path: "/admin/investments", view: "AdminInvestmentsView.vue", title: "Admin: investments" },
  { name: "adminIncome", path: "/admin/income", view: "AdminIncomeView.vue", title: "Admin: income" },
  { name: "adminStorage", path: "/admin/storage", view: "AdminStorageView.vue", title: "Admin: storage" },
  { name: "adminAudit", path: "/admin/audit", view: "AdminAuditView.vue", title: "Admin: audit log" },
  // the "Hisaab did not start" screen: no layout, no composable (app/lib/startup.ts)
  { name: "startupBlocked", path: "/startup-blocked", view: "StartupBlockedView.vue", title: "Hisaab", layout: false },
  // anything else goes to the dashboard (the old catch-all). Server routes (/api/*) never reach the page router.
  { name: "notFound", path: "/:pathMatch(.*)*", redirect: "/dashboard" },
];

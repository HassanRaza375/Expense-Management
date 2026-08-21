import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: 'Dashboard' } },
  { path: '/expenses', name: 'expenses', component: () => import('../views/ExpensesView.vue'), meta: { title: 'Expenses' } },
  { path: '/income', name: 'income', component: () => import('../views/IncomeView.vue'), meta: { title: 'Income' } },
  { path: '/bills', name: 'bills', component: () => import('../views/BillsView.vue'), meta: { title: 'Bills' } },
  { path: '/bills/meters/:connectionId', name: 'meterReading', component: () => import('../views/MeterReadingView.vue'), meta: { title: 'Meter Reading' } },
  { path: '/recurring', name: 'recurring', component: () => import('../views/RecurringView.vue'), meta: { title: 'Recurring' } },
  { path: '/categories', name: 'categories', component: () => import('../views/CategoriesView.vue'), meta: { title: 'Categories' } },
  { path: '/budget', name: 'budget', component: () => import('../views/BudgetView.vue'), meta: { title: 'Budget' } },
  { path: '/vault', name: 'vault', component: () => import('../views/VaultView.vue'), meta: { title: 'Vault' } },
  { path: '/assets', name: 'assets', component: () => import('../views/AssetsView.vue'), meta: { title: 'Assets' } },
  { path: '/investments', name: 'investments', component: () => import('../views/InvestmentsView.vue'), meta: { title: 'Investments' } },
  { path: '/investments/:id', name: 'fundDetail', component: () => import('../views/FundDetailView.vue'), meta: { title: 'Fund' } },
  { path: '/vehicles', name: 'vehicles', component: () => import('../views/VehiclesView.vue'), meta: { title: 'Vehicles' } },
  { path: '/vehicles/:id', name: 'vehicleDetail', component: () => import('../views/VehicleDetailView.vue'), meta: { title: 'Vehicle' } },
  { path: '/lending', name: 'lending', component: () => import('../views/LendingView.vue'), meta: { title: 'Lending' } },
  { path: '/lending/:id', name: 'loanDetail', component: () => import('../views/LoanDetailView.vue'), meta: { title: 'Loan' } },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: 'Settings' } },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

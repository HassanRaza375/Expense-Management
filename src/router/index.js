import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: 'Dashboard' } },
  { path: '/expenses', name: 'expenses', component: () => import('../views/ExpensesView.vue'), meta: { title: 'Expenses' } },
  { path: '/bills', name: 'bills', component: () => import('../views/BillsView.vue'), meta: { title: 'Bills' } },
  { path: '/recurring', name: 'recurring', component: () => import('../views/RecurringView.vue'), meta: { title: 'Recurring' } },
  { path: '/categories', name: 'categories', component: () => import('../views/CategoriesView.vue'), meta: { title: 'Categories' } },
  { path: '/budget', name: 'budget', component: () => import('../views/BudgetView.vue'), meta: { title: 'Budget' } },
  { path: '/vault', name: 'vault', component: () => import('../views/VaultView.vue'), meta: { title: 'Vault' } },
  { path: '/assets', name: 'assets', component: () => import('../views/AssetsView.vue'), meta: { title: 'Assets' } },
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
